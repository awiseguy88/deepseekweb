/** Postgres tenant store maps every WiseAI admin row and patches only supplied fields. */
import { afterEach, describe, expect, it } from 'vitest'
import type { TenantAuthDatabase } from '../src/postgres.ts'
import { PostgresTenantAuthStore } from '../src/postgres.ts'
import type {
  SalesEventInput,
  SupportRequestInput,
  TenantAccountPatch,
  TenantProfilePatch,
} from '../src/types.ts'

interface RecordedCall {
  readonly sql: string
  readonly parameters: readonly unknown[]
}

type ScriptedResult =
  | { readonly rows: readonly Record<string, unknown>[] }
  | { readonly failure: unknown }

/** Fake database that records SQL and replays one canned result per query. */
class ScriptedDatabase implements TenantAuthDatabase {
  readonly calls: RecordedCall[] = []
  private readonly results: ScriptedResult[] = []

  /** Queue one successful result. */
  next(rows: readonly Record<string, unknown>[] = []): this {
    this.results.push({ rows })
    return this
  }

  /** Queue one thrown value. */
  fail(failure: unknown): this {
    this.results.push({ failure })
    return this
  }

  async query<T extends Record<string, unknown>>(sql: string, parameters: readonly unknown[]): Promise<{ readonly rows: readonly T[] }> {
    this.calls.push({ sql, parameters })
    const result = this.results.shift()
    if (result === undefined) throw new Error('ScriptedDatabase has no queued result')
    if ('failure' in result) throw result.failure
    return { rows: result.rows as readonly T[] }
  }
}

const createdAt = new Date('2026-02-01T10:00:00.000Z')
const updatedAt = new Date('2026-02-02T10:00:00.000Z')

function userRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    user_id: 'user-1',
    email: 'ada@example.com',
    password_hash: 'hash-1',
    role: 'member',
    tenant_id: 'tenant-1',
    disabled: false,
    platform_admin: false,
    last_seen_at: null,
    created_at: createdAt,
    ...overrides,
  }
}

function tenantRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tenant_id: 'tenant-1',
    name: 'Acme',
    plan: 'pro',
    status: 'active',
    disabled: false,
    stripe_customer_id: null,
    stripe_subscription_id: null,
    access_until: null,
    notes: '',
    created_at: createdAt,
    updated_at: updatedAt,
    ...overrides,
  }
}

function accountRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    user_id: 'user-1',
    tenant_id: 'tenant-1',
    tenant_name: 'Acme',
    email: 'ada@example.com',
    role: 'admin',
    platform_admin: false,
    disabled: false,
    created_at: createdAt,
    last_seen_at: null,
    ...overrides,
  }
}

function sessionRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    session_id: 'session-1',
    user_id: 'user-1',
    tenant_id: 'tenant-1',
    expires_at: new Date('2026-02-14T10:00:00.000Z'),
    revoked_at: null,
    ...overrides,
  }
}

function sessionListRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    session_id: 'session-1',
    user_id: 'user-1',
    tenant_id: 'tenant-1',
    email: 'ada@example.com',
    tenant_name: 'Acme',
    expires_at: new Date('2026-02-14T10:00:00.000Z'),
    created_at: createdAt,
    revoked_at: null,
    ...overrides,
  }
}

function supportRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    request_id: 'request-1',
    tenant_id: 'tenant-1',
    tenant_name: 'Acme',
    user_id: 'user-1',
    email: 'ada@example.com',
    subject: 'Cannot sign in',
    message: 'The sign-in form rejects my password.',
    page_url: 'https://app.example/chat',
    status: 'open',
    priority: 'normal',
    admin_note: '',
    created_at: createdAt,
    updated_at: updatedAt,
    ...overrides,
  }
}

function salesRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event_id: 'evt-1',
    event_type: 'invoice.paid',
    tenant_id: 'tenant-1',
    customer_id: 'cus-1',
    subscription_id: 'sub-1',
    amount_total: 4900,
    currency: 'usd',
    status: 'paid',
    created_at: createdAt,
    ...overrides,
  }
}

function storeWith(db: ScriptedDatabase): PostgresTenantAuthStore {
  return new PostgresTenantAuthStore(db)
}

const originalBootstrapEmail = process.env.WISEAI_ADMIN_EMAIL
afterEach(() => {
  if (originalBootstrapEmail === undefined) delete process.env.WISEAI_ADMIN_EMAIL
  else process.env.WISEAI_ADMIN_EMAIL = originalBootstrapEmail
})

describe('existing tenant identity reads', () => {
  it('maps the extended user record from an email lookup', async () => {
    const db = new ScriptedDatabase().next([userRow({ platform_admin: true, last_seen_at: updatedAt })])
    const user = await storeWith(db).findUserByEmail('  Ada@Example.com ')
    expect(user).toEqual({
      userId: 'user-1',
      email: 'ada@example.com',
      passwordHash: 'hash-1',
      role: 'member',
      tenantId: 'tenant-1',
      disabled: false,
      platformAdmin: true,
      createdAt,
      lastSeenAt: updatedAt,
    })
    expect(db.calls[0]?.parameters).toEqual(['Ada@Example.com'])
    expect(db.calls[0]?.sql).toContain('lower(email) = lower($1)')
    expect(db.calls[0]?.sql).toContain('platform_admin')
    expect(db.calls[0]?.sql).toContain('last_seen_at')
    expect(db.calls[0]?.sql).toContain('created_at')
  })

  it('returns null when no account matches', async () => {
    const db = new ScriptedDatabase().next([])
    expect(await storeWith(db).findUserByEmail('nobody@example.com')).toBeNull()
    expect(await storeWith(new ScriptedDatabase().next([])).findUserById('missing')).toBeNull()
  })

  it('maps the extended user record from an id lookup', async () => {
    const db = new ScriptedDatabase().next([userRow({ disabled: true, platform_admin: true })])
    expect(await storeWith(db).findUserById('user-1')).toMatchObject({
      userId: 'user-1',
      disabled: true,
      platformAdmin: true,
      lastSeenAt: null,
    })
    expect(db.calls[0]?.parameters).toEqual(['user-1'])
  })

  it('lists tenant users with extended fields in creation order', async () => {
    const db = new ScriptedDatabase().next([userRow(), userRow({ user_id: 'user-2', platform_admin: true })])
    const users = await storeWith(db).listUsers('tenant-1')
    expect(users.map(user => user.userId)).toEqual(['user-1', 'user-2'])
    expect(users[1]?.platformAdmin).toBe(true)
    expect(db.calls[0]?.parameters).toEqual(['tenant-1'])
    expect(db.calls[0]?.sql).toContain('ORDER BY created_at, user_id')
  })
})

describe('signup and session persistence', () => {
  it('creates member and admin accounts with folded emails', async () => {
    const memberDb = new ScriptedDatabase().next()
    const member = await storeWith(memberDb).createMember('  New@Example.com ', 'hash-new')
    expect(member).toEqual({ userId: expect.any(String), tenantId: expect.any(String) })
    expect(memberDb.calls[0]?.parameters).toEqual([member.tenantId, member.userId, 'new@example.com', 'hash-new'])
    expect(memberDb.calls[0]?.sql).toContain('INSERT INTO wiseai_tenants')
    expect(memberDb.calls[0]?.sql).toContain("'member'")

    const adminDb = new ScriptedDatabase().next()
    const admin = await storeWith(adminDb).createAdmin('Owner@Example.com', 'hash-owner')
    expect(adminDb.calls[0]?.parameters).toEqual([admin.tenantId, admin.userId, 'owner@example.com', 'hash-owner'])
    expect(adminDb.calls[0]?.sql).toContain("'admin'")
  })

  it('resolves an active session and refuses a revoked one', async () => {
    const db = new ScriptedDatabase().next([sessionRow()])
    expect(await storeWith(db).findSession('session-1')).toEqual({
      sessionId: 'session-1',
      userId: 'user-1',
      tenantId: 'tenant-1',
      expiresAt: new Date('2026-02-14T10:00:00.000Z'),
      revokedAt: null,
    })
    expect(db.calls[0]?.sql).toContain('NOT u.disabled AND NOT t.disabled')
    expect(db.calls[0]?.sql).toContain("t.status IN ('active', 'trialing')")
    expect(db.calls[0]?.parameters).toEqual(['session-1', 0])

    const emptyDb = new ScriptedDatabase().next([])
    expect(await storeWith(emptyDb).findSession('revoked')).toBeNull()
  })

  it('creates a session only after store admission', async () => {
    const input = { sessionId: 'session-2', userId: 'user-1', tenantId: 'tenant-1', expiresAt: new Date('2026-02-20T10:00:00.000Z') }
    const db = new ScriptedDatabase().next([{ session_id: 'session-2' }])
    expect(await storeWith(db).createSession(input)).toEqual({ ...input, revokedAt: null })
    expect(db.calls[0]?.parameters).toEqual(['session-2', 'user-1', 'tenant-1', input.expiresAt, 0])

    const refused = new ScriptedDatabase().next([])
    await expect(storeWith(refused).createSession(input)).rejects.toThrow('Session admission refused')
  })

  it('revokes sessions and disables users with tenant scope', async () => {
    const db = new ScriptedDatabase().next().next()
    await storeWith(db).revokeSession('session-1')
    await storeWith(db).setUserDisabled('tenant-1', 'user-1', true)
    expect(db.calls[0]?.parameters).toEqual(['session-1'])
    expect(db.calls[1]?.parameters).toEqual(['user-1', 'tenant-1', true])
    expect(db.calls[1]?.sql).toContain('updated_at = now()')
  })
})

describe('customer tenants', () => {
  it('creates a tenant and its first admin in one statement', async () => {
    const db = new ScriptedDatabase().next()
    const created = await storeWith(db).createTenant({
      name: '  Acme Inc ',
      plan: 'pro',
      adminEmail: ' Owner@Example.com ',
      adminPasswordHash: 'hash-owner',
    })
    expect(created).toEqual({ tenantId: expect.any(String), userId: expect.any(String) })
    expect(db.calls).toHaveLength(1)
    expect(db.calls[0]?.sql).toContain('WITH tenant AS')
    expect(db.calls[0]?.sql).toContain('INSERT INTO wiseai_users')
    expect(db.calls[0]?.parameters).toEqual([created.tenantId, 'Acme Inc', 'pro', created.userId, 'owner@example.com', 'hash-owner', false])
  })

  it('passes platform-admin on when requested and rejects a duplicate email', async () => {
    const db = new ScriptedDatabase().next()
    await storeWith(db).createTenant({ name: 'Acme', plan: 'team', adminEmail: 'owner@example.com', adminPasswordHash: 'hash', platformAdmin: true })
    expect(db.calls[0]?.parameters[6]).toBe(true)

    const duplicate = new Error('duplicate key value violates unique constraint')
    Object.assign(duplicate, { code: '23505' })
    await expect(storeWith(new ScriptedDatabase().fail(duplicate)).createTenant({
      name: 'Acme', plan: 'free', adminEmail: 'owner@example.com', adminPasswordHash: 'hash',
    })).rejects.toThrow('An account with this email already exists')
  })

  it('rethrows unrelated create failures unchanged', async () => {
    const failure = new Error('connection reset')
    await expect(storeWith(new ScriptedDatabase().fail(failure)).createTenant({
      name: 'Acme', plan: 'free', adminEmail: 'owner@example.com', adminPasswordHash: 'hash',
    })).rejects.toBe(failure)
    await expect(storeWith(new ScriptedDatabase().fail('offline')).createUserInTenant({
      tenantId: 'tenant-1', email: 'new@example.com', passwordHash: 'hash', role: 'member',
    })).rejects.toBe('offline')
  })

  it('maps a tenant profile including absent billing fields', async () => {
    const db = new ScriptedDatabase().next([tenantRow({ status: 'trialing', access_until: updatedAt, notes: 'pilot' })])
    expect(await storeWith(db).findTenantById('tenant-1')).toEqual({
      tenantId: 'tenant-1',
      name: 'Acme',
      plan: 'pro',
      status: 'trialing',
      disabled: false,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      accessUntil: updatedAt,
      notes: 'pilot',
      createdAt,
      updatedAt,
    })
    expect(db.calls[0]?.parameters).toEqual(['tenant-1'])

    expect(await storeWith(new ScriptedDatabase().next([])).findTenantById('missing')).toBeNull()
  })

  it('lists tenants newest first', async () => {
    const db = new ScriptedDatabase().next([tenantRow(), tenantRow({ tenant_id: 'tenant-2', name: 'Beta' })])
    const tenants = await storeWith(db).listTenants()
    expect(tenants.map(tenant => tenant.name)).toEqual(['Acme', 'Beta'])
    expect(db.calls[0]?.parameters).toEqual([])
    expect(db.calls[0]?.sql).toContain('ORDER BY created_at DESC, tenant_id')
  })

  it('patches only supplied tenant fields and bumps updated_at', async () => {
    const db = new ScriptedDatabase().next([tenantRow({
      plan: 'team',
      status: 'past_due',
      disabled: true,
      stripe_customer_id: 'cus-2',
      stripe_subscription_id: 'sub-2',
      access_until: updatedAt,
      notes: 'invoice overdue',
    })])
    const patch: TenantProfilePatch = {
      plan: 'team',
      status: 'past_due',
      disabled: true,
      stripeCustomerId: 'cus-2',
      stripeSubscriptionId: 'sub-2',
      accessUntil: updatedAt,
      notes: 'invoice overdue',
    }
    const tenant = await storeWith(db).updateTenant('tenant-1', patch)
    expect(tenant).toMatchObject({ plan: 'team', status: 'past_due', disabled: true, stripeCustomerId: 'cus-2', stripeSubscriptionId: 'sub-2', accessUntil: updatedAt, notes: 'invoice overdue' })
    expect(db.calls[0]?.parameters).toEqual(['team', 'past_due', true, 'cus-2', 'sub-2', updatedAt, 'invoice overdue', 'tenant-1'])
    expect(db.calls[0]?.sql).toContain('updated_at = now()')
    expect(db.calls[0]?.sql).not.toContain('name = ')
  })

  it('clears nullable tenant fields when null is supplied', async () => {
    const db = new ScriptedDatabase().next([tenantRow()])
    await storeWith(db).updateTenant('tenant-1', { accessUntil: null, stripeCustomerId: null })
    expect(db.calls[0]?.parameters).toEqual([null, null, 'tenant-1'])
    expect(db.calls[0]?.sql).toContain('stripe_customer_id = $1')
    expect(db.calls[0]?.sql).toContain('access_until = $2')
  })

  it('bumps updated_at for an empty tenant patch and reports a missing tenant', async () => {
    const db = new ScriptedDatabase().next([tenantRow()])
    await storeWith(db).updateTenant('tenant-1', {})
    expect(db.calls[0]?.sql).toContain('SET updated_at = now()')
    expect(db.calls[0]?.parameters).toEqual(['tenant-1'])

    const missing = new ScriptedDatabase().next([])
    expect(await storeWith(missing).updateTenant('tenant-1', { plan: 'free' })).toBeNull()
  })
})

describe('customer accounts', () => {
  it('adds an account to an existing tenant with a folded email', async () => {
    const db = new ScriptedDatabase().next()
    const created = await storeWith(db).createUserInTenant({
      tenantId: 'tenant-1',
      email: ' Grace@Example.com ',
      passwordHash: 'hash-grace',
      role: 'member',
    })
    expect(created).toEqual({ userId: expect.any(String) })
    expect(db.calls[0]?.parameters).toEqual([created.userId, 'tenant-1', 'grace@example.com', 'hash-grace', 'member', false])
  })

  it('reports a duplicate tenant-local email clearly', async () => {
    const duplicate = new Error('duplicate key value violates unique constraint')
    Object.assign(duplicate, { code: '23505' })
    await expect(storeWith(new ScriptedDatabase().fail(duplicate)).createUserInTenant({
      tenantId: 'tenant-1', email: 'grace@example.com', passwordHash: 'hash', role: 'member',
    })).rejects.toThrow('An account with this email already exists in this tenant')
  })

  it('lists accounts joined with their tenant name', async () => {
    const db = new ScriptedDatabase().next([accountRow(), accountRow({ user_id: 'user-2', email: 'grace@example.com', role: 'member' })])
    const accounts = await storeWith(db).listAccounts('tenant-1')
    expect(accounts[0]).toEqual({
      userId: 'user-1',
      tenantId: 'tenant-1',
      tenantName: 'Acme',
      email: 'ada@example.com',
      role: 'admin',
      platformAdmin: false,
      disabled: false,
      createdAt,
      lastSeenAt: null,
    })
    expect(accounts[1]?.email).toBe('grace@example.com')
    expect(db.calls[0]?.parameters).toEqual(['tenant-1'])
    expect(db.calls[0]?.sql).toContain('t.name AS tenant_name')
  })

  it('lists every account across tenants and finds one by id', async () => {
    const all = new ScriptedDatabase().next([accountRow(), accountRow({ user_id: 'user-2', tenant_id: 'tenant-2', tenant_name: 'Beta' })])
    const accounts = await storeWith(all).listAllAccounts()
    expect(accounts.map(account => account.tenantName)).toEqual(['Acme', 'Beta'])
    expect(all.calls[0]?.parameters).toEqual([])

    const one = new ScriptedDatabase().next([accountRow({ platform_admin: true, last_seen_at: updatedAt })])
    expect(await storeWith(one).findAccountById('user-1')).toMatchObject({ tenantName: 'Acme', platformAdmin: true, lastSeenAt: updatedAt })
    expect(one.calls[0]?.parameters).toEqual(['user-1'])
    expect(await storeWith(new ScriptedDatabase().next([])).findAccountById('missing')).toBeNull()
  })

  it('patches only supplied account fields in a joined update', async () => {
    const db = new ScriptedDatabase().next([accountRow({ disabled: true, role: 'member', platform_admin: true, last_seen_at: updatedAt })])
    const patch: TenantAccountPatch = { disabled: true, role: 'member', platformAdmin: true, passwordHash: 'hash-2' }
    const account = await storeWith(db).updateAccount('user-1', patch)
    expect(account).toMatchObject({ disabled: true, role: 'member', platformAdmin: true, tenantName: 'Acme' })
    expect(db.calls[0]?.parameters).toEqual(['member', true, 'hash-2', true, 'user-1'])
    expect(db.calls[0]?.sql).toContain('WITH updated AS')
    expect(db.calls[0]?.sql).toContain('updated_at = now()')
    expect(db.calls[0]?.sql).toContain('JOIN wiseai_tenants AS t')

    const empty = new ScriptedDatabase().next([accountRow()])
    await storeWith(empty).updateAccount('user-1', {})
    expect(empty.calls[0]?.sql).toContain('SET updated_at = now()')
    expect(empty.calls[0]?.parameters).toEqual(['user-1'])

    expect(await storeWith(new ScriptedDatabase().next([])).updateAccount('missing', { disabled: true })).toBeNull()
  })

  it('records login activity and grants the bootstrap operator rights', async () => {
    process.env.WISEAI_ADMIN_EMAIL = ' Owner@Example.com '
    const db = new ScriptedDatabase().next()
    await storeWith(db).recordLogin('user-1')
    expect(db.calls[0]?.parameters).toEqual(['user-1', 'owner@example.com'])
    expect(db.calls[0]?.sql).toContain('last_seen_at = now()')
    expect(db.calls[0]?.sql).toContain('platform_admin OR')

    delete process.env.WISEAI_ADMIN_EMAIL
    const unset = new ScriptedDatabase().next()
    await storeWith(unset).recordLogin('user-2')
    expect(unset.calls[0]?.parameters).toEqual(['user-2', ''])
  })
})

describe('session administration', () => {
  it('lists sessions joined with user and tenant labels', async () => {
    const db = new ScriptedDatabase().next([sessionListRow(), sessionListRow({ session_id: 'session-2', revoked_at: updatedAt })])
    const sessions = await storeWith(db).listSessions()
    expect(sessions[0]).toEqual({
      sessionId: 'session-1',
      userId: 'user-1',
      tenantId: 'tenant-1',
      email: 'ada@example.com',
      tenantName: 'Acme',
      expiresAt: new Date('2026-02-14T10:00:00.000Z'),
      createdAt,
      revokedAt: null,
    })
    expect(sessions[1]?.revokedAt).toBe(updatedAt)
    expect(db.calls[0]?.parameters).toEqual([])
    expect(db.calls[0]?.sql).toContain('JOIN wiseai_users AS u')
    expect(db.calls[0]?.sql).toContain('JOIN wiseai_tenants AS t')
  })

  it('filters sessions by tenant and active state', async () => {
    const byTenant = new ScriptedDatabase().next([sessionListRow()])
    await storeWith(byTenant).listSessions({ tenantId: 'tenant-1' })
    expect(byTenant.calls[0]?.parameters).toEqual(['tenant-1'])
    expect(byTenant.calls[0]?.sql).toContain('WHERE s.tenant_id = $1')

    const active = new ScriptedDatabase().next([sessionListRow()])
    await storeWith(active).listSessions({ activeOnly: true })
    expect(active.calls[0]?.parameters).toEqual([])
    expect(active.calls[0]?.sql).toContain('s.expires_at > now() AND s.revoked_at IS NULL')

    const combined = new ScriptedDatabase().next([sessionListRow()])
    await storeWith(combined).listSessions({ tenantId: 'tenant-1', activeOnly: true })
    expect(combined.calls[0]?.parameters).toEqual(['tenant-1'])
    expect(combined.calls[0]?.sql).toContain('WHERE s.tenant_id = $1 AND s.expires_at > now() AND s.revoked_at IS NULL')
  })
})

describe('support inbox', () => {
  const input: SupportRequestInput = {
    tenantId: 'tenant-1',
    userId: 'user-1',
    subject: 'Cannot sign in',
    message: 'The sign-in form rejects my password.',
    pageUrl: 'https://app.example/chat',
  }

  it('raises a support request scoped to the signed-in account', async () => {
    const db = new ScriptedDatabase().next([supportRow()])
    const request = await storeWith(db).createSupportRequest(input)
    expect(request).toEqual({
      requestId: 'request-1',
      tenantId: 'tenant-1',
      tenantName: 'Acme',
      userId: 'user-1',
      email: 'ada@example.com',
      subject: 'Cannot sign in',
      message: 'The sign-in form rejects my password.',
      pageUrl: 'https://app.example/chat',
      status: 'open',
      priority: 'normal',
      adminNote: '',
      createdAt,
      updatedAt,
    })
    expect(db.calls[0]?.parameters?.slice(1)).toEqual(['user-1', 'Cannot sign in', 'The sign-in form rejects my password.', 'https://app.example/chat', 'tenant-1'])
    expect(db.calls[0]?.sql).toContain('u.tenant_id = $6')
    expect(db.calls[0]?.sql).toContain('NOT u.disabled')
  })

  it('refuses a support request for an account outside the tenant', async () => {
    await expect(storeWith(new ScriptedDatabase().next([])).createSupportRequest(input)).rejects.toThrow('Support request rejected')
  })

  it('lists the inbox newest first with every filter', async () => {
    const db = new ScriptedDatabase().next([supportRow(), supportRow({ request_id: 'request-2', status: 'closed' })])
    const requests = await storeWith(db).listSupportRequests({ status: 'open', tenantId: 'tenant-1', limit: 25 })
    expect(requests).toHaveLength(2)
    expect(requests[1]?.status).toBe('closed')
    expect(db.calls[0]?.parameters).toEqual(['open', 'tenant-1', 25])
    expect(db.calls[0]?.sql).toContain('WHERE r.status = $1 AND r.tenant_id = $2')
    expect(db.calls[0]?.sql).toContain('ORDER BY r.created_at DESC, r.request_id LIMIT $3')
  })

  it('lists the inbox without filters', async () => {
    const db = new ScriptedDatabase().next([supportRow()])
    await storeWith(db).listSupportRequests()
    expect(db.calls[0]?.parameters).toEqual([])
    expect(db.calls[0]?.sql).not.toContain('WHERE')
  })

  it('triages a support request and returns the joined record', async () => {
    const db = new ScriptedDatabase().next([supportRow({ status: 'in_progress', priority: 'high', admin_note: 'Contacted the customer.' })])
    const request = await storeWith(db).updateSupportRequest('request-1', {
      status: 'in_progress',
      priority: 'high',
      adminNote: 'Contacted the customer.',
    })
    expect(request).toMatchObject({ status: 'in_progress', priority: 'high', adminNote: 'Contacted the customer.', tenantName: 'Acme' })
    expect(db.calls[0]?.parameters).toEqual(['in_progress', 'high', 'Contacted the customer.', 'request-1'])
    expect(db.calls[0]?.sql).toContain('WITH updated AS')
    expect(db.calls[0]?.sql).toContain('updated_at = now()')

    const empty = new ScriptedDatabase().next([supportRow()])
    await storeWith(empty).updateSupportRequest('request-1', {})
    expect(empty.calls[0]?.sql).toContain('SET updated_at = now()')
    expect(empty.calls[0]?.parameters).toEqual(['request-1'])

    expect(await storeWith(new ScriptedDatabase().next([])).updateSupportRequest('missing', { status: 'closed' })).toBeNull()
  })
})

describe('sales ledger', () => {
  const event: SalesEventInput = {
    eventId: 'evt-1',
    eventType: 'invoice.paid',
    tenantId: 'tenant-1',
    customerId: 'cus-1',
    subscriptionId: 'sub-1',
    amountTotal: 4900,
    currency: 'usd',
    status: 'paid',
  }

  it('records a Stripe webhook fact idempotently', async () => {
    const db = new ScriptedDatabase().next()
    await storeWith(db).recordSalesEvent(event)
    expect(db.calls[0]?.parameters).toEqual(['evt-1', 'invoice.paid', 'tenant-1', 'cus-1', 'sub-1', 4900, 'usd', 'paid'])
    expect(db.calls[0]?.sql).toContain('ON CONFLICT (event_id) DO NOTHING')
  })

  it('lists the ledger newest first, optionally bounded', async () => {
    const db = new ScriptedDatabase().next([salesRow(), salesRow({ event_id: 'evt-2', amount_total: null, currency: null, status: null, tenant_id: null })])
    const events = await storeWith(db).listSalesEvents(100)
    expect(events[0]).toEqual({
      eventId: 'evt-1',
      eventType: 'invoice.paid',
      tenantId: 'tenant-1',
      customerId: 'cus-1',
      subscriptionId: 'sub-1',
      amountTotal: 4900,
      currency: 'usd',
      status: 'paid',
      createdAt,
    })
    expect(events[1]?.amountTotal).toBeNull()
    expect(events[1]?.tenantId).toBeNull()
    expect(db.calls[0]?.parameters).toEqual([100])
    expect(db.calls[0]?.sql).toContain('ORDER BY created_at DESC, event_id LIMIT $1')

    const unbounded = new ScriptedDatabase().next([])
    expect(await storeWith(unbounded).listSalesEvents()).toEqual([])
    expect(unbounded.calls[0]?.parameters).toEqual([])
    expect(unbounded.calls[0]?.sql).not.toContain('LIMIT')
  })
})
