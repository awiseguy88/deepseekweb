/**
 * Dependency-free Stripe billing for the hosted WiseAI admin surface.
 *
 * Checkout sessions are created through Stripe's REST API with the global
 * `fetch`; webhook signatures are verified with `node:crypto`; webhook events are
 * mapped onto the tenant records in `./types.ts`. No Stripe SDK is loaded.
 *
 * @module @deepseek-ai/dsh-api-tenant-auth/stripe
 */

import { createHmac, timingSafeEqual } from 'node:crypto'
import type { SalesEventInput, TenantRecord } from './types.ts'

/** Stripe settings resolved from the deployment environment. */
export interface StripeConfig {
  /** Secret API key for authenticated Stripe REST calls. */
  readonly secretKey: string | null
  /** Endpoint secret used to verify webhook signatures. */
  readonly webhookSecret: string | null
  /** Recurring price billed by the checkout session. */
  readonly priceId: string | null
  /** Whether every setting is present. */
  readonly configured: boolean
}

/** A Stripe JSON object; individual field values stay untyped until validated. */
export interface StripeObject {
  readonly [field: string]: unknown
}

/** A Stripe webhook event after minimal JSON validation. */
export interface StripeEvent {
  /** Stripe-assigned event identifier, used as the sales ledger key. */
  readonly id: string
  /** Stripe event type, for example `invoice.paid`. */
  readonly type: string
  readonly data: {
    /** The event's primary object (checkout session, subscription, or invoice). */
    readonly object: StripeObject
  }
}

/** Input for {@link verifyStripeSignature}. */
export interface StripeSignatureInput {
  /** Raw request body exactly as received; the signed payload for a Uint8Array is its bytes. */
  readonly payload: string | Uint8Array
  /** Value of the `Stripe-Signature` header, or null when absent. */
  readonly signatureHeader: string | null
  /** Webhook endpoint secret the signature was produced with. */
  readonly secret: string
  /** Unix seconds used for freshness checks; defaults to the wall clock. */
  readonly nowSeconds?: number
  /** Maximum accepted timestamp distance in seconds; defaults to 300. */
  readonly toleranceSeconds?: number
}

/** Tenant identity hints read from a webhook object without trusting the database. */
export interface StripeTenantHint {
  /** Tenant id carried in the object's `metadata.tenantId`. */
  readonly tenantId?: string
  /** Billing email carried in `customer_details.email` or `customer_email`. */
  readonly email?: string
  /** Stripe customer id. */
  readonly customerId?: string
  /** Stripe subscription id. */
  readonly subscriptionId?: string
}

/** Tenant fields a webhook event may update. */
export interface StripeTenantPatch {
  /** Plan label read from `metadata.plan`. */
  readonly plan?: string
  /** Access state derived from the subscription or payment status. */
  readonly status?: TenantRecord['status']
  /** Paid-through instant derived from `current_period_end`. */
  readonly accessUntil?: Date | null
}

/** The sales row plus tenant changes one webhook event produces. */
export interface StripeEventSummary {
  /** Row to append to the admin sales ledger. */
  readonly sales: SalesEventInput
  /** Identifiers the caller may use to locate the tenant. */
  readonly tenantHint: StripeTenantHint
  /** Tenant fields to apply; empty for unhandled event types. */
  readonly tenantPatch: StripeTenantPatch
}

/** Input for {@link createCheckoutLink}. */
export interface StripeCheckoutLinkInput {
  /** Secret API key. */
  readonly secretKey: string
  /** Recurring price id for the subscription line item. */
  readonly priceId: string
  /** Customer email pre-filled on the hosted checkout page. */
  readonly email: string
  /** Tenant id echoed back through metadata and `client_reference_id`. */
  readonly tenantId: string
  /** URL Stripe sends the customer to after payment. */
  readonly successUrl: string
  /** URL Stripe sends the customer to after cancellation. */
  readonly cancelUrl: string
}

/** A created Stripe Checkout Session. */
export interface StripeCheckoutLink {
  /** Checkout Session id. */
  readonly id: string
  /** Hosted checkout page URL. */
  readonly url: string
}

/** Error raised when Stripe rejects a checkout-session request or returns an unusable body. */
export class StripeRequestError extends Error {
  /** HTTP status of the failing response. */
  readonly status: number
  /** Raw response body, or the empty string when none was read. */
  readonly body: string

  /**
   * @param message - failure description for logs.
   * @param status - HTTP status of the failing response.
   * @param body - raw response body.
   */
  constructor(message: string, status: number, body = '') {
    super(message)
    this.name = 'StripeRequestError'
    this.status = status
    this.body = body
  }
}

const CHECKOUT_SESSIONS_URL = 'https://api.stripe.com/v1/checkout/sessions'
const DEFAULT_TOLERANCE_SECONDS = 300

const TENANT_STATUS_BY_SUBSCRIPTION_STATUS: Readonly<Record<string, TenantRecord['status']>> = {
  active: 'active',
  trialing: 'trialing',
  past_due: 'past_due',
  canceled: 'canceled',
  unpaid: 'disabled',
}

/** Trim one environment hide; empty or whitespace-only values count as unset. */
function optionalEnv(name: string): string | null {
  const raw = process.env[name]
  if (raw === undefined) return null
  const value = raw.trim()
  return value.length === 0 ? null : value
}

/**
 * Resolve the Stripe settings from `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
 * and `STRIPE_PRICE_ID`.
 * @returns the configured values and whether all three are present.
 */
export function stripeConfig(): StripeConfig {
  const secretKey = optionalEnv('STRIPE_SECRET_KEY')
  const webhookSecret = optionalEnv('STRIPE_WEBHOOK_SECRET')
  const priceId = optionalEnv('STRIPE_PRICE_ID')
  return {
    secretKey,
    webhookSecret,
    priceId,
    configured: secretKey !== null && webhookSecret !== null && priceId !== null,
  }
}

/** A JSON-like value that is a non-array object. */
function isStripeObject(value: unknown): value is StripeObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Read a non-empty string, trimming surrounding whitespace. */
function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

/** Read a finite number. */
function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Read a Stripe reference that may be a bare id or an expanded object. */
function readId(value: unknown): string | null {
  if (typeof value === 'string') return readString(value)
  return isStripeObject(value) ? readString(value['id']) : null
}

/** Read a nested object field. */
function readObject(value: unknown): StripeObject | null {
  return isStripeObject(value) ? value : null
}

/** Read `metadata.tenantId` from a webhook object. */
function readTenantId(object: StripeObject): string | null {
  return readString(readObject(object['metadata'])?.['tenantId'])
}

/** Read the billing email from an object's customer details or legacy field. */
function readEmail(object: StripeObject): string | null {
  const details = readObject(object['customer_details'])
  return readString(details?.['email']) ?? readString(object['customer_email'])
}

/** Read the billed amount, preferring `amount_total` and falling back to `amount_paid`. */
function readAmount(object: StripeObject): number | null {
  return readNumber(object['amount_total']) ?? readNumber(object['amount_paid'])
}

/** Read `metadata.plan` from a webhook object. */
function readPlan(object: StripeObject): string | null {
  return readString(readObject(object['metadata'])?.['plan'])
}

/** Convert a Unix-second instant to a Date; missing or non-positive values become null. */
function unixSecondsToDate(seconds: number | null): Date | null {
  return seconds !== null && seconds > 0 ? new Date(seconds * 1000) : null
}

/** Map a Stripe subscription status onto the tenant access state. */
function tenantStatus(subscriptionStatus: string | null): TenantRecord['status'] | undefined {
  return subscriptionStatus === null ? undefined : TENANT_STATUS_BY_SUBSCRIPTION_STATUS[subscriptionStatus]
}

/** Build the tenant patch one event type implies. */
function tenantPatchFor(type: string, object: StripeObject): StripeTenantPatch {
  switch (type) {
    case 'checkout.session.completed': {
      const plan = readPlan(object)
      const paymentStatus = readString(object['payment_status'])
      const status = paymentStatus === 'paid' || paymentStatus === 'no_payment_required' ? 'active' : undefined
      return {
        ...(plan === null ? {} : { plan }),
        ...(status === undefined ? {} : { status }),
      }
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const plan = readPlan(object)
      const status = tenantStatus(readString(object['status']))
      return {
        ...(plan === null ? {} : { plan }),
        ...(status === undefined ? {} : { status }),
        accessUntil: unixSecondsToDate(readNumber(object['current_period_end'])),
      }
    }
    case 'customer.subscription.deleted': {
      const plan = readPlan(object)
      return {
        ...(plan === null ? {} : { plan }),
        status: tenantStatus(readString(object['status'])) ?? 'canceled',
        accessUntil: unixSecondsToDate(readNumber(object['current_period_end'])),
      }
    }
    case 'invoice.paid': {
      const plan = readPlan(object)
      return {
        ...(plan === null ? {} : { plan }),
        status: 'active',
      }
    }
    case 'invoice.payment_failed':
      return { status: 'past_due' }
    default:
      return {}
  }
}

/** Build the sales-ledger status field for one event type. */
function salesStatusFor(type: string, object: StripeObject): string | null {
  if (type.startsWith('customer.subscription.')) return readString(object['status'])
  if (type.startsWith('invoice.')) return readString(object['status'])
  if (type === 'checkout.session.completed') {
    return readString(object['payment_status']) ?? readString(object['status'])
  }
  return null
}

/** Read the subscription id a webhook object refers to. */
function readSubscriptionId(type: string, object: StripeObject): string | null {
  if (type.startsWith('customer.subscription.')) return readString(object['id'])
  return readId(object['subscription'])
}

/** Build the HMAC input for a signature timestamp and body. */
function signedPayload(timestamp: number, payload: string | Uint8Array): Uint8Array {
  const prefix = new TextEncoder().encode(`${timestamp}.`)
  if (typeof payload === 'string') return new TextEncoder().encode(`${timestamp}.${payload}`)
  const signed = new Uint8Array(prefix.length + payload.length)
  signed.set(prefix)
  signed.set(payload, prefix.length)
  return signed
}

/**
 * Verify a `Stripe-Signature` header against the raw request body.
 *
 * The header must carry one `t` timestamp and at least one `v1` HMAC-SHA256
 * signature; any matching signature accepts the request. Signatures whose
 * timestamp differs from `nowSeconds` by more than the tolerance are rejected.
 * @param input - raw payload, header, endpoint secret, and freshness options.
 * @returns whether the request carries a valid, fresh signature.
 */
export function verifyStripeSignature(input: StripeSignatureInput): boolean {
  const { signatureHeader, secret } = input
  if (signatureHeader === null || secret.length === 0) return false
  let timestamp: number | null = null
  const signatures: string[] = []
  for (const part of signatureHeader.split(',')) {
    const separator = part.indexOf('=')
    if (separator < 0) return false
    const key = part.slice(0, separator).trim()
    const value = part.slice(separator + 1).trim()
    if (key === 't') {
      if (timestamp !== null || !/^[0-9]+$/.test(value)) return false
      timestamp = Number(value)
    } else if (key === 'v1' && value.length > 0) {
      signatures.push(value)
    }
  }
  if (timestamp === null || signatures.length === 0) return false
  const toleranceSeconds = input.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000)
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) return false
  const expected = createHmac('sha256', secret).update(signedPayload(timestamp, input.payload)).digest()
  let valid = false
  for (const signature of signatures) {
    const candidate = Buffer.from(signature, 'hex')
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) valid = true
  }
  return valid
}

/**
 * Parse a Stripe webhook body into an event, rejecting malformed JSON and
 * payloads without a string `id`/`type` and an object `data.object`.
 * @param payload - raw webhook body.
 * @returns the validated event, or null when the body is unusable.
 */
export function parseStripeEvent(payload: string): StripeEvent | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    return null
  }
  if (!isStripeObject(parsed)) return null
  const id = readString(parsed['id'])
  const type = readString(parsed['type'])
  const data = readObject(parsed['data'])
  if (id === null || type === null || data === null) return null
  const object = readObject(data['object'])
  if (object === null) return null
  return { id, type, data: { object } }
}

/**
 * Map a webhook event onto a sales-ledger row, tenant hints, and tenant changes.
 *
 * `checkout.session.completed`, `customer.subscription.created|updated|deleted`,
 * `invoice.paid`, and `invoice.payment_failed` update tenant state; every other
 * event type still produces a sales row with an empty tenant patch.
 * @param event - validated webhook event.
 * @returns the sales row, tenant hints, and tenant patch for the event.
 */
export function summarizeStripeEvent(event: StripeEvent): StripeEventSummary {
  const object = event.data.object
  const tenantId = readTenantId(object)
  const email = readEmail(object)
  const customerId = readId(object['customer'])
  const subscriptionId = readSubscriptionId(event.type, object)
  return {
    sales: {
      eventId: event.id,
      eventType: event.type,
      tenantId,
      customerId,
      subscriptionId,
      amountTotal: readAmount(object),
      currency: readString(object['currency']),
      status: salesStatusFor(event.type, object),
    },
    tenantHint: {
      ...(tenantId === null ? {} : { tenantId }),
      ...(email === null ? {} : { email }),
      ...(customerId === null ? {} : { customerId }),
      ...(subscriptionId === null ? {} : { subscriptionId }),
    },
    tenantPatch: tenantPatchFor(event.type, object),
  }
}

/**
 * Create a subscription-mode Stripe Checkout Session and return its hosted URL.
 *
 * The request is form-encoded and authenticated with the supplied secret key.
 * Any non-2xx response, unparseable body, or missing `id`/`url` throws a
 * {@link StripeRequestError}.
 * @param input - secret key, price, customer, tenant, and redirect URLs.
 * @param fetchImpl - fetch implementation; defaults to the global `fetch`.
 * @returns the Checkout Session id and hosted checkout URL.
 */
export async function createCheckoutLink(
  input: StripeCheckoutLinkInput,
  fetchImpl: typeof fetch = fetch,
): Promise<StripeCheckoutLink> {
  const form = new URLSearchParams()
  form.set('mode', 'subscription')
  form.set('line_items[0][price]', input.priceId)
  form.set('line_items[0][quantity]', '1')
  form.set('customer_email', input.email)
  form.set('metadata[tenantId]', input.tenantId)
  form.set('client_reference_id', input.tenantId)
  form.set('success_url', input.successUrl)
  form.set('cancel_url', input.cancelUrl)
  const response = await fetchImpl(CHECKOUT_SESSIONS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  })
  const body = await response.text()
  if (!response.ok) {
    throw new StripeRequestError(`Stripe checkout session request failed with status ${response.status}`, response.status, body)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    throw new StripeRequestError('Stripe checkout session response was not JSON', response.status, body)
  }
  if (!isStripeObject(parsed)) {
    throw new StripeRequestError('Stripe checkout session response was not an object', response.status, body)
  }
  const id = readString(parsed['id'])
  const url = readString(parsed['url'])
  if (id === null || url === null) {
    throw new StripeRequestError('Stripe checkout session response lacked id or url', response.status, body)
  }
  return { id, url }
}
