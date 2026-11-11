/** Stripe billing: configuration, webhook verification, event mapping, and checkout creation. */
import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createCheckoutLink,
  parseStripeEvent,
  stripeConfig,
  summarizeStripeEvent,
  StripeRequestError,
  verifyStripeSignature,
} from '../src/stripe.ts'
import type { StripeEvent } from '../src/stripe.ts'

const ENV_KEYS = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_ID'] as const
const ORIGINAL_ENV = new Map<string, string | undefined>(ENV_KEYS.map(key => [key, process.env[key]]))

afterEach(() => {
  for (const key of ENV_KEYS) {
    const original = ORIGINAL_ENV.get(key)
    if (original === undefined) delete process.env[key]
    else process.env[key] = original
  }
  vi.restoreAllMocks()
})

/** Replace the Stripe environment variables for one test. */
function setStripeEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>): void {
  for (const key of ENV_KEYS) {
    const value = values[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

describe('stripeConfig', () => {
  it('reports missing settings as null and not configured', () => {
    setStripeEnv({})
    expect(stripeConfig()).toEqual({ secretKey: null, webhookSecret: null, priceId: null, configured: false })
  })

  it('trims settings and requires all three', () => {
    setStripeEnv({ STRIPE_SECRET_KEY: ' sk_test_1 ', STRIPE_WEBHOOK_SECRET: 'whsec_1', STRIPE_PRICE_ID: 'price_1' })
    expect(stripeConfig()).toEqual({ secretKey: 'sk_test_1', webhookSecret: 'whsec_1', priceId: 'price_1', configured: true })
  })

  it('treats whitespace-only and partial settings as unset', () => {
    setStripeEnv({ STRIPE_SECRET_KEY: '   ', STRIPE_WEBHOOK_SECRET: 'whsec_1' })
    expect(stripeConfig()).toEqual({ secretKey: null, webhookSecret: 'whsec_1', priceId: null, configured: false })
  })
})

const SECRET = 'whsec_test_secret'
const NOW = 1_700_000_000

/** Produce the hex HMAC Stripe signs with. */
function signatureFor(payload: string | Uint8Array, secret: string, timestamp: number): string {
  const body = typeof payload === 'string' ? Buffer.from(payload) : Buffer.from(payload)
  return createHmac('sha256', secret).update(Buffer.concat([Buffer.from(`${timestamp}.`), body])).digest('hex')
}

/** Build a complete Stripe-Signature header. */
function headerFor(payload: string | Uint8Array, secret: string, timestamp: number): string {
  return `t=${timestamp},v1=${signatureFor(payload, secret, timestamp)}`
}

describe('verifyStripeSignature', () => {
  it('accepts a valid signature over a string payload', () => {
    const payload = '{"id":"evt_1"}'
    expect(verifyStripeSignature({ payload, signatureHeader: headerFor(payload, SECRET, NOW), secret: SECRET, nowSeconds: NOW })).toBe(true)
  })

  it('accepts a valid signature over raw bytes', () => {
    const payload = new TextEncoder().encode('{"id":"evt_2"}')
    expect(verifyStripeSignature({ payload, signatureHeader: headerFor(payload, SECRET, NOW), secret: SECRET, nowSeconds: NOW })).toBe(true)
  })

  it('accepts the request when any v1 signature matches', () => {
    const payload = 'body'
    const header = `t=${NOW},v0=ignored,v1=${'0'.repeat(64)},v1=${signatureFor(payload, SECRET, NOW)}`
    expect(verifyStripeSignature({ payload, signatureHeader: header, secret: SECRET, nowSeconds: NOW })).toBe(true)
  })

  it('rejects a tampered payload', () => {
    const header = headerFor('original', SECRET, NOW)
    expect(verifyStripeSignature({ payload: 'tampered', signatureHeader: header, secret: SECRET, nowSeconds: NOW })).toBe(false)
  })

  it('rejects a signature produced with another secret', () => {
    const payload = 'body'
    expect(verifyStripeSignature({ payload, signatureHeader: headerFor(payload, 'whsec_other', NOW), secret: SECRET, nowSeconds: NOW })).toBe(false)
  })

  it('rejects a missing header and an empty secret', () => {
    expect(verifyStripeSignature({ payload: 'body', signatureHeader: null, secret: SECRET, nowSeconds: NOW })).toBe(false)
    expect(verifyStripeSignature({ payload: 'body', signatureHeader: headerFor('body', '', NOW), secret: '', nowSeconds: NOW })).toBe(false)
  })

  it.each([
    ['missing timestamp', () => `v1=${signatureFor('body', SECRET, NOW)}`],
    ['missing signature', () => `t=${NOW}`],
    ['non-numeric timestamp', () => `t=now,v1=${signatureFor('body', SECRET, NOW)}`],
    ['duplicate timestamp', () => `t=${NOW},t=${NOW},v1=${signatureFor('body', SECRET, NOW)}`],
    ['segment without a separator', () => `t=${NOW},garbage`],
    ['empty signature', () => `t=${NOW},v1=`],
  ])('rejects a header with %s', (_name, header) => {
    expect(verifyStripeSignature({ payload: 'body', signatureHeader: header(), secret: SECRET, nowSeconds: NOW })).toBe(false)
  })

  it('rejects stale and future-dated signatures beyond the tolerance', () => {
    const payload = 'body'
    expect(verifyStripeSignature({ payload, signatureHeader: headerFor(payload, SECRET, NOW - 301), secret: SECRET, nowSeconds: NOW })).toBe(false)
    expect(verifyStripeSignature({ payload, signatureHeader: headerFor(payload, SECRET, NOW + 301), secret: SECRET, nowSeconds: NOW })).toBe(false)
  })

  it('uses the wall clock when no reference time is supplied', () => {
    const payload = 'body'
    expect(verifyStripeSignature({
      payload,
      signatureHeader: headerFor(payload, SECRET, Math.floor(Date.now() / 1000)),
      secret: SECRET,
    })).toBe(true)
  })

  it('honours an explicit tolerance and accepts both skew directions inside it', () => {
    const payload = 'body'
    const options = { payload, secret: SECRET, nowSeconds: NOW, toleranceSeconds: 10 }
    expect(verifyStripeSignature({ ...options, signatureHeader: headerFor(payload, SECRET, NOW - 10) })).toBe(true)
    expect(verifyStripeSignature({ ...options, signatureHeader: headerFor(payload, SECRET, NOW - 11) })).toBe(false)
    expect(verifyStripeSignature({ ...options, signatureHeader: headerFor(payload, SECRET, NOW + 10) })).toBe(true)
    expect(verifyStripeSignature({ ...options, signatureHeader: headerFor(payload, SECRET, NOW + 100) })).toBe(false)
  })
})

describe('parseStripeEvent', () => {
  it('parses an event with the required fields', () => {
    const event = parseStripeEvent(JSON.stringify({ id: 'evt_1', type: 'invoice.paid', data: { object: { id: 'in_1' } } }))
    expect(event).toEqual({ id: 'evt_1', type: 'invoice.paid', data: { object: { id: 'in_1' } } })
  })

  it.each([
    ['invalid JSON', 'not json'],
    ['a JSON scalar', JSON.stringify('text')],
    ['null', 'null'],
    ['an array', '[]'],
    ['an empty object', '{}'],
    ['a numeric id', JSON.stringify({ id: 1, type: 't', data: { object: {} } })],
    ['a blank id', JSON.stringify({ id: '  ', type: 't', data: { object: {} } })],
    ['a missing type', JSON.stringify({ id: 'evt_1', data: { object: {} } })],
    ['a missing data object', JSON.stringify({ id: 'evt_1', type: 't' })],
    ['a scalar data field', JSON.stringify({ id: 'evt_1', type: 't', data: 'x' })],
    ['a missing event object', JSON.stringify({ id: 'evt_1', type: 't', data: {} })],
    ['an array event object', JSON.stringify({ id: 'evt_1', type: 't', data: { object: [] } })],
  ])('returns null for %s', (_name, payload) => {
    expect(parseStripeEvent(payload)).toBeNull()
  })
})

const EVENT_ID = 'evt_test'

/** Build a validated event for mapping tests. */
function webhookEvent(type: string, object: Record<string, unknown>): StripeEvent {
  return { id: EVENT_ID, type, data: { object } }
}

describe('summarizeStripeEvent', () => {
  it('maps checkout.session.completed to a paid tenant patch', () => {
    const summary = summarizeStripeEvent(webhookEvent('checkout.session.completed', {
      id: 'cs_test_1',
      customer: 'cus_1',
      subscription: 'sub_1',
      customer_details: { email: 'buyer@example.com' },
      metadata: { tenantId: 'tenant-1', plan: 'pro' },
      amount_total: 4900,
      currency: 'usd',
      payment_status: 'paid',
    }))
    expect(summary.sales).toEqual({
      eventId: EVENT_ID,
      eventType: 'checkout.session.completed',
      tenantId: 'tenant-1',
      customerId: 'cus_1',
      subscriptionId: 'sub_1',
      amountTotal: 4900,
      currency: 'usd',
      status: 'paid',
    })
    expect(summary.tenantHint).toEqual({ tenantId: 'tenant-1', email: 'buyer@example.com', customerId: 'cus_1', subscriptionId: 'sub_1' })
    expect(summary.tenantPatch).toEqual({ plan: 'pro', status: 'active' })
  })

  it('reads expanded references, legacy email, and amount_paid for a zero-payment checkout', () => {
    const summary = summarizeStripeEvent(webhookEvent('checkout.session.completed', {
      customer: { id: 'cus_2' },
      subscription: { id: 'sub_2' },
      customer_email: 'legacy@example.com',
      amount_paid: 1200,
      currency: 'usd',
      payment_status: 'no_payment_required',
    }))
    expect(summary.sales.subscriptionId).toBe('sub_2')
    expect(summary.sales.amountTotal).toBe(1200)
    expect(summary.tenantHint).toEqual({ email: 'legacy@example.com', customerId: 'cus_2', subscriptionId: 'sub_2' })
    expect(summary.tenantPatch).toEqual({ status: 'active' })
  })

  it('leaves tenant fields untouched for an unpaid checkout', () => {
    const summary = summarizeStripeEvent(webhookEvent('checkout.session.completed', { payment_status: 'unpaid' }))
    expect(summary.sales.status).toBe('unpaid')
    expect(summary.tenantPatch).toEqual({})
  })

  it('falls back to the session status for the sales row when payment_status is absent', () => {
    const summary = summarizeStripeEvent(webhookEvent('checkout.session.completed', { status: 'complete' }))
    expect(summary.sales.status).toBe('complete')
  })

  it('maps a trialing subscription with its paid-through instant', () => {
    const summary = summarizeStripeEvent(webhookEvent('customer.subscription.created', {
      id: 'sub_1',
      customer: 'cus_1',
      status: 'trialing',
      current_period_end: 1_800_000_000,
      metadata: { tenantId: 'tenant-1' },
    }))
    expect(summary.sales).toEqual({
      eventId: EVENT_ID,
      eventType: 'customer.subscription.created',
      tenantId: 'tenant-1',
      customerId: 'cus_1',
      subscriptionId: 'sub_1',
      amountTotal: null,
      currency: null,
      status: 'trialing',
    })
    expect(summary.tenantHint).toEqual({ tenantId: 'tenant-1', customerId: 'cus_1', subscriptionId: 'sub_1' })
    expect(summary.tenantPatch).toEqual({ status: 'trialing', accessUntil: new Date(1_800_000_000 * 1000) })
  })

  it('maps an unpaid subscription to disabled and ignores an unknown subscription status', () => {
    const unpaid = summarizeStripeEvent(webhookEvent('customer.subscription.updated', { id: 'sub_1', status: 'unpaid' }))
    expect(unpaid.tenantPatch).toEqual({ status: 'disabled', accessUntil: null })

    const paused = summarizeStripeEvent(webhookEvent('customer.subscription.updated', {
      id: 'sub_1',
      status: 'paused',
      metadata: { tenantId: 'tenant-1', plan: 'pro' },
    }))
    expect(paused.tenantPatch).toEqual({ plan: 'pro', accessUntil: null })
  })

  it('keeps the paid-through instant for a canceled subscription deletion', () => {
    const summary = summarizeStripeEvent(webhookEvent('customer.subscription.deleted', {
      id: 'sub_1',
      customer: 'cus_1',
      status: 'canceled',
      current_period_end: 1_800_000_000,
      metadata: { tenantId: 'tenant-1', plan: 'pro' },
    }))
    expect(summary.sales.status).toBe('canceled')
    expect(summary.tenantPatch).toEqual({ plan: 'pro', status: 'canceled', accessUntil: new Date(1_800_000_000 * 1000) })
  })

  it('falls back to canceled for a deletion without a status or period end', () => {
    const summary = summarizeStripeEvent(webhookEvent('customer.subscription.deleted', { id: 'sub_1' }))
    expect(summary.tenantPatch).toEqual({ status: 'canceled', accessUntil: null })
  })

  it('marks a paid invoice active and a failed invoice past due', () => {
    const paid = summarizeStripeEvent(webhookEvent('invoice.paid', {
      id: 'in_1',
      customer: 'cus_1',
      subscription: 'sub_1',
      amount_total: 4900,
      currency: 'usd',
      status: 'paid',
      metadata: { tenantId: 'tenant-1', plan: 'pro' },
      customer_email: 'buyer@example.com',
    }))
    expect(paid.sales).toEqual({
      eventId: EVENT_ID,
      eventType: 'invoice.paid',
      tenantId: 'tenant-1',
      customerId: 'cus_1',
      subscriptionId: 'sub_1',
      amountTotal: 4900,
      currency: 'usd',
      status: 'paid',
    })
    expect(paid.tenantHint).toEqual({ tenantId: 'tenant-1', email: 'buyer@example.com', customerId: 'cus_1', subscriptionId: 'sub_1' })
    expect(paid.tenantPatch).toEqual({ plan: 'pro', status: 'active' })

    const paidWithoutPlan = summarizeStripeEvent(webhookEvent('invoice.paid', { id: 'in_3', status: 'paid' }))
    expect(paidWithoutPlan.tenantPatch).toEqual({ status: 'active' })

    const failed = summarizeStripeEvent(webhookEvent('invoice.payment_failed', {
      id: 'in_2',
      amount_paid: 0,
      currency: 'usd',
      status: 'open',
    }))
    expect(failed.sales.amountTotal).toBe(0)
    expect(failed.sales.status).toBe('open')
    expect(failed.tenantPatch).toEqual({ status: 'past_due' })
  })

  it('produces a null-filled sales row and empty tenant patch for an unknown event', () => {
    const summary = summarizeStripeEvent(webhookEvent('customer.created', {
      metadata: { tenantId: '   ' },
      customer_email: '',
      amount_total: 'not-a-number',
    }))
    expect(summary.sales).toEqual({
      eventId: EVENT_ID,
      eventType: 'customer.created',
      tenantId: null,
      customerId: null,
      subscriptionId: null,
      amountTotal: null,
      currency: null,
      status: null,
    })
    expect(summary.tenantHint).toEqual({})
    expect(summary.tenantPatch).toEqual({})
  })
})

const CHECKOUT_INPUT = {
  secretKey: 'sk_test_123',
  priceId: 'price_123',
  email: 'customer@example.com',
  tenantId: 'tenant-1',
  successUrl: 'https://example.com/billing/success',
  cancelUrl: 'https://example.com/billing/cancel',
}

const EXPECTED_FORM = 'mode=subscription'
  + '&line_items%5B0%5D%5Bprice%5D=price_123'
  + '&line_items%5B0%5D%5Bquantity%5D=1'
  + '&customer_email=customer%40example.com'
  + '&metadata%5BtenantId%5D=tenant-1'
  + '&client_reference_id=tenant-1'
  + '&success_url=https%3A%2F%2Fexample.com%2Fbilling%2Fsuccess'
  + '&cancel_url=https%3A%2F%2Fexample.com%2Fbilling%2Fcancel'

describe('createCheckoutLink', () => {
  it('posts the form-encoded session request and returns the hosted link', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' }),
      { status: 200 },
    ))
    const link = await createCheckoutLink(CHECKOUT_INPUT, fetchImpl)
    expect(link).toEqual({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] ?? []
    expect(url).toBe('https://api.stripe.com/v1/checkout/sessions')
    expect(init?.method).toBe('POST')
    const headers = new Headers(init?.headers)
    expect(headers.get('authorization')).toBe('Bearer sk_test_123')
    expect(headers.get('content-type')).toBe('application/x-www-form-urlencoded')
    expect(init?.body).toBe(EXPECTED_FORM)
  })

  it('uses the global fetch when no implementation is supplied', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ id: 'cs_test_2', url: 'https://checkout.stripe.com/c/pay/cs_test_2' }),
      { status: 201 },
    ))
    await expect(createCheckoutLink(CHECKOUT_INPUT)).resolves.toEqual({
      id: 'cs_test_2',
      url: 'https://checkout.stripe.com/c/pay/cs_test_2',
    })
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('throws a typed error carrying the status and body for a rejected request', async () => {
    const errorBody = JSON.stringify({ error: { message: 'No such price' } })
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(errorBody, { status: 400 }))
    const error = await createCheckoutLink(CHECKOUT_INPUT, fetchImpl).then(() => null, (caught: unknown) => caught)
    expect(error).toBeInstanceOf(StripeRequestError)
    if (error instanceof StripeRequestError) {
      expect(error.status).toBe(400)
      expect(error.body).toBe(errorBody)
      expect(error.message).toContain('status 400')
    }
  })

  it.each([
    ['a non-JSON body', 'not-json'],
    ['a JSON scalar', JSON.stringify('nope')],
    ['a missing id', JSON.stringify({ url: 'https://checkout.stripe.com/c/pay/cs_x' })],
    ['a missing url', JSON.stringify({ id: 'cs_x' })],
  ])('throws a typed error for %s', async (_name, body) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status: 200 }))
    const error = await createCheckoutLink(CHECKOUT_INPUT, fetchImpl).then(() => null, (caught: unknown) => caught)
    expect(error).toBeInstanceOf(StripeRequestError)
    if (error instanceof StripeRequestError) expect(error.status).toBe(200)
  })
})
