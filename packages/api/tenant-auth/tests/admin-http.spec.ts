/** Hosted admin JSON API and member support intake route, authorize, validate, and map records. */
import { afterEach, describe, expect, it } from 'vitest'
import {
  adminApiResponse,
  resolveAdmin,
  resolvePlatformAdmin,
  resolveTenantAccount,
  supportApiResponse,
} from '../src/admin-http.ts'
import type {
  SalesEventRecord,
  SupportRequestInput,
  SupportRequestPatch,
  SupportRequestRecord,
  TenantAccountPatch,
  TenantAccountRecord,
  TenantAuthStore,
  TenantProfilePatch,
  TenantRecord,
  TenantSessionListRecord,
  TenantSessionRecord,
  TenantUserRecord,
} from '../src/types.ts'

const createdAt = new Date('2026-02-01T10:00:00.000Z')
const updatedAt = new Date('2026-02-02T10:00:00.000Z')
const TOKEN = 'a'.repeat(43)

function userRecord(overrides: Partial<TenantUserRecord> = {}): TenantUserRecord {
  return {
    userId: 'user-admin',
    email: 'admin@example.com',
    passwordHash: 'hash-admin',
    role: 'admin',
    tenantId: 'tenant-ops',
    disabled: false,
    platformAdmin: true,
    createdAt,
    lastSeenAt: null,
    ...overrides,
  }
}

function tenantRecord(overrides: Partial<TenantRecord> = {}): TenantRecord {
  return {
    tenantId: 'tenant-a',
    name: 'Acme',
    plan: 'pro',
    status: 'active',
    disabled: false,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    accessUntil: null,
    notes: '',
    createdAt,
    updatedAt,
    ...overrides,
  }
}

function accountRecord(overrides: Partial<TenantAccountRecord> = {}): TenantAccountRecord {
  return {
    userId: 'user-1',
    tenantId: 'tenant-a',
    tenantName: 'Acme',
    email: 'ada@example.com',
    role: 'member',
    platformAdmin: false,
    disabled: false,
    createdAt,
    lastSeenAt: null,
    ...overrides,
  }
}

function sessionListRecord(overrides: Partial<TenantSessionListRecord> = {}): TenantSessionListRecord {
  return {
    sessionId: 'session-1',
    userId: 'user-1',
    tenantId: 'tenant-a',
    email: 'ada@example.com',
    tenantName: 'Acme',
    expiresAt: new Date('2026-02-14T10:00:00.000Z'),
    createdAt,
    revokedAt: null,
    ...overrides,
  }
}

function supportRecord(overrides: Partial<SupportRequestRecord> = {}): SupportRequestRecord {
  return {
    requestId: 'request-1',
    tenantId: 'tenant-a',
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
    ...overrides,
  }
}

function salesRecord(overrides: Partial<SalesEventRecord> = {}): SalesEventRecord {
  return {
    eventId: 'evt-1',
    eventType: 'invoice.paid',
    tenantId: 'tenant-a',
    customerId: 'cus-1',
    subscriptionId: 'sub-1',
    amountTotal: 4900,
    currency: 'usd',
    status: 'paid',
    createdAt,
    ...overrides,
  }
}

/** In-memory store covering every method the HTTP surface can reach. */
class FakeStore implements TenantAuthStore {
  users: TenantUserRecord[] = []
  session: TenantSessionRecord | null = null
  /** Session rows returned for an id lookup other than the authentication token. */
  sessionsById: Record<string, TenantSessionRecord> = {}
  tenants: TenantRecord[] = []
  accounts: TenantAccountRecord[] = []
  sessionLists: TenantSessionListRecord[] = []
  support: SupportRequestRecord[] = []
  sales: SalesEventRecord[] = []
  revoked: string[] = []
  sessionFilters: ({ readonly tenantId?: string; readonly activeOnly?: boolean })[] = []
  supportFilters: ({ readonly status?: SupportRequestRecord['status']; readonly tenantId?: string; readonly limit?: number })[] = []
  salesLimits: (number | undefined)[] = []
  tenantUpdates: { tenantId: string; patch: TenantProfilePatch }[] = []
  accountUpdates: { userId: string; patch: TenantAccountPatch }[] = []
  supportUpdates: { requestId: string; patch: SupportRequestPatch }[] = []
  supportInputs: SupportRequestInput[] = []
  tenantInputs: Parameters<TenantAuthStore['createTenant']>[0][] = []
  accountInputs: Parameters<TenantAuthStore['createUserInTenant']>[0][] = []
  missingTenant = false
  missingAccount = false
  missingSupport = false

  async createMember(_email: string, _passwordHash: string): Promise<{ userId: string; tenantId: string }> {
    throw new Error('createMember is not part of the admin surface')
  }

  async createAdmin(_email: string, _passwordHash: string): Promise<{ userId: string; tenantId: string }> {
    throw new Error('createAdmin is not part of the admin surface')
  }

  async findUserByEmail(email: string): Promise<TenantUserRecord | null> {
    return this.users.find(user => user.email === email.trim().toLowerCase()) ?? null
  }

  async findUserById(userId: string): Promise<TenantUserRecord | null> {
    return this.users.find(user => user.userId === userId) ?? null
  }

  async findSession(sessionId: string): Promise<TenantSessionRecord | null> {
    return this.sessionsById[sessionId] ?? this.session
  }

  async createSession(): Promise<TenantSessionRecord> {
    throw new Error('createSession is not part of the admin surface')
  }

  async revokeSession(sessionId: string): Promise<void> {
    this.revoked.push(sessionId)
  }

  async listUsers(): Promise<readonly TenantUserRecord[]> {
    return this.users
  }

  async setUserDisabled(): Promise<void> {
    throw new Error('setUserDisabled is not part of the admin surface')
  }

  async createTenant(input: Parameters<TenantAuthStore['createTenant']>[0]): Promise<{ tenantId: string; userId: string }> {
    this.tenantInputs.push(input)
    return { tenantId: 'tenant-new', userId: 'user-new' }
  }

  async findTenantById(tenantId: string): Promise<TenantRecord | null> {
    if (this.missingTenant) return null
    return this.tenants.find(tenant => tenant.tenantId === tenantId) ?? null
  }

  async listTenants(): Promise<readonly TenantRecord[]> {
    return this.tenants
  }

  async updateTenant(tenantId: string, patch: TenantProfilePatch): Promise<TenantRecord | null> {
    this.tenantUpdates.push({ tenantId, patch })
    if (this.missingTenant) return null
    const existing = this.tenants.find(tenant => tenant.tenantId === tenantId) ?? tenantRecord({ tenantId })
    return { ...existing, ...patch }
  }

  async createUserInTenant(input: Parameters<TenantAuthStore['createUserInTenant']>[0]): Promise<{ userId: string }> {
    this.accountInputs.push(input)
    return { userId: 'user-added' }
  }

  async listAccounts(tenantId: string): Promise<readonly TenantAccountRecord[]> {
    return this.accounts.filter(account => account.tenantId === tenantId)
  }

  async listAllAccounts(): Promise<readonly TenantAccountRecord[]> {
    return this.accounts
  }

  async findAccountById(userId: string): Promise<TenantAccountRecord | null> {
    return this.accounts.find(account => account.userId === userId) ?? null
  }

  async updateAccount(userId: string, patch: TenantAccountPatch): Promise<TenantAccountRecord | null> {
    this.accountUpdates.push({ userId, patch })
    if (this.missingAccount) return null
    const existing = this.accounts.find(account => account.userId === userId) ?? accountRecord({ userId })
    return { ...existing, ...patch }
  }

  async recordLogin(): Promise<void> {
    throw new Error('recordLogin is not part of the admin surface')
  }

  async listSessions(filter: { readonly tenantId?: string; readonly activeOnly?: boolean } = {}): Promise<readonly TenantSessionListRecord[]> {
    this.sessionFilters.push(filter)
    return this.sessionLists
  }

  async createSupportRequest(input: SupportRequestInput): Promise<SupportRequestRecord> {
    this.supportInputs.push(input)
    return supportRecord({ ...input, requestId: 'request-new', tenantId: input.tenantId, userId: input.userId })
  }

  async listSupportRequests(filter: { readonly status?: SupportRequestRecord['status']; readonly tenantId?: string; readonly limit?: number } = {}): Promise<readonly SupportRequestRecord[]> {
    this.supportFilters.push(filter)
    return this.support.filter(request =>
      (filter.status === undefined || request.status === filter.status)
      && (filter.tenantId === undefined || request.tenantId === filter.tenantId))
  }

  async updateSupportRequest(requestId: string, patch: SupportRequestPatch): Promise<SupportRequestRecord | null> {
    this.supportUpdates.push({ requestId, patch })
    if (this.missingSupport) return null
    return { ...supportRecord({ requestId }), ...patch }
  }

  async recordSalesEvent(): Promise<void> {
    throw new Error('recordSalesEvent is not part of the admin surface')
  }

  async listSalesEvents(limit?: number): Promise<readonly SalesEventRecord[]> {
    this.salesLimits.push(limit)
    return this.sales
  }
}

function signedIn(store: FakeStore, overrides: Partial<TenantUserRecord> = {}): FakeStore {
  const user = userRecord(overrides)
  store.users = [user]
  store.session = { sessionId: 'session-admin', userId: user.userId, tenantId: user.tenantId, expiresAt: new Date('2027-01-01T00:00:00.000Z'), revokedAt: null }
  return store
}

/** A signed-in tenant administrator: tenant-a, without platform rights. */
function signedInTenantAdmin(overrides: Partial<TenantUserRecord> = {}): FakeStore {
  return signedIn(new FakeStore(), {
    userId: 'user-tenant-admin',
    role: 'admin',
    platformAdmin: false,
    tenantId: 'tenant-a',
    ...overrides,
  })
}

function request(path: string, init: RequestInit = {}, authenticated = true): Request {
  const headers = new Headers(init.headers)
  if (authenticated) headers.set('cookie', `wiseai_session=${TOKEN}`)
  return new Request(`http://localhost${path}`, { ...init, headers })
}

function jsonPost(path: string, body: unknown, authenticated = true): Request {
  return request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }, authenticated)
}

const originalStripeKey = process.env.STRIPE_SECRET_KEY
afterEach(() => {
  if (originalStripeKey === undefined) delete process.env.STRIPE_SECRET_KEY
  else process.env.STRIPE_SECRET_KEY = originalStripeKey
})

describe('session resolution', () => {
  it('rejects callers without a session cookie', async () => {
    const store = signedIn(new FakeStore())
    expect(await resolvePlatformAdmin(store, request('/admin/api/overview', {}, false))).toBeNull()
    expect(await resolveTenantAccount(store, request('/support/requests', {}, false))).toBeNull()
  })

  it('rejects a malformed token without touching the store', async () => {
    const store = signedIn(new FakeStore())
    expect(await resolvePlatformAdmin(store, request('/admin/api/overview', { headers: { cookie: 'wiseai_session=short' } }, false))).toBeNull()
  })

  it('resolves a platform operator and a plain member separately', async () => {
    const store = signedIn(new FakeStore())
    const admin = await resolvePlatformAdmin(store, request('/admin/api/overview'))
    expect(admin?.userId).toBe('user-admin')
    expect((await resolveTenantAccount(store, request('/support/requests')))?.session.sessionId).toBe('session-admin')

    const memberStore = signedIn(new FakeStore(), { userId: 'user-member', role: 'member', platformAdmin: false })
    expect(await resolvePlatformAdmin(memberStore, request('/admin/api/overview'))).toBeNull()
    expect((await resolveTenantAccount(memberStore, request('/support/requests')))?.user.userId).toBe('user-member')
  })

  it('rejects a disabled account', async () => {
    const store = signedIn(new FakeStore(), { disabled: true })
    expect(await resolvePlatformAdmin(store, request('/admin/api/overview'))).toBeNull()
    expect(await resolveTenantAccount(store, request('/support/requests'))).toBeNull()
  })
})

describe('admin authorization and routing', () => {
  it('answers 401 without a session and 403 for a non-operator account', async () => {
    const store = signedIn(new FakeStore())
    const anonymous = await adminApiResponse(store, request('/admin/api/overview', {}, false))
    expect(anonymous.status).toBe(401)
    expect(await anonymous.json()).toEqual({ error: 'unauthenticated' })

    const memberStore = signedIn(new FakeStore(), { platformAdmin: false, role: 'member' })
    const forbidden = await adminApiResponse(memberStore, request('/admin/api/overview'))
    expect(forbidden.status).toBe(403)
    expect(await forbidden.json()).toEqual({ error: 'forbidden' })
  })

  it('answers 404 for unknown routes and unsupported methods', async () => {
    const store = signedIn(new FakeStore())
    for (const [path, method] of [['/admin/api/nope', 'GET'], ['/admin/api/overview', 'DELETE'], ['/elsewhere', 'GET']] as const) {
      const response = await adminApiResponse(store, request(path, { method }))
      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({ error: 'not_found' })
    }
  })
})

describe('admin resolution', () => {
  it('accepts platform operators and tenant administrators, and denies members and disabled accounts', async () => {
    const platform = await resolveAdmin(signedIn(new FakeStore()), request('/admin/api/me'))
    expect(platform).toMatchObject({ platform: true, user: { userId: 'user-admin' } })

    const tenant = await resolveAdmin(signedInTenantAdmin(), request('/admin/api/me'))
    expect(tenant).toMatchObject({ platform: false, user: { userId: 'user-tenant-admin', tenantId: 'tenant-a' } })

    const member = signedIn(new FakeStore(), { role: 'member', platformAdmin: false })
    expect(await resolveAdmin(member, request('/admin/api/me'))).toBeNull()
    expect(await resolveAdmin(signedInTenantAdmin({ disabled: true }), request('/admin/api/me'))).toBeNull()
    expect(await resolveAdmin(signedInTenantAdmin(), request('/admin/api/me', {}, false))).toBeNull()
  })

  it('lets a tenant administrator reach the admin API while a member stays forbidden', async () => {
    const tenant = await adminApiResponse(signedInTenantAdmin(), request('/admin/api/me'))
    expect(tenant.status).toBe(200)

    const memberStore = signedIn(new FakeStore(), { role: 'member', platformAdmin: false })
    const forbidden = await adminApiResponse(memberStore, request('/admin/api/overview'))
    expect(forbidden.status).toBe(403)
    expect(await forbidden.json()).toEqual({ error: 'forbidden' })
  })

  it('reports the signed-in administrator and tenant name', async () => {
    const store = signedInTenantAdmin()
    store.tenants = [tenantRecord({ tenantId: 'tenant-a', name: 'Acme' })]
    const response = await adminApiResponse(store, request('/admin/api/me'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      email: 'admin@example.com',
      role: 'admin',
      platformAdmin: false,
      tenantId: 'tenant-a',
      tenantName: 'Acme',
    })

    const platformStore = signedIn(new FakeStore())
    const platform = await adminApiResponse(platformStore, request('/admin/api/me'))
    expect(await platform.json()).toMatchObject({ platformAdmin: true, tenantId: 'tenant-ops', tenantName: '' })
  })
})

describe('tenant-scoped administration', () => {
  it('counts only the tenant in the overview', async () => {
    const store = signedInTenantAdmin()
    store.tenants = [tenantRecord({ tenantId: 'tenant-a' }), tenantRecord({ tenantId: 'tenant-b' })]
    store.accounts = [accountRecord(), accountRecord({ userId: 'user-2' }), accountRecord({ userId: 'user-3', tenantId: 'tenant-b' })]
    store.support = [supportRecord(), supportRecord({ requestId: 'request-2', tenantId: 'tenant-b' })]
    store.sessionLists = [sessionListRecord()]
    const response = await adminApiResponse(store, request('/admin/api/overview'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ customers: 1, activeCustomers: 1, users: 2, openSupport: 1, activeSessions: 1 })
    expect(store.supportFilters).toEqual([{ status: 'open', tenantId: 'tenant-a' }])
    expect(store.sessionFilters).toEqual([{ activeOnly: true, tenantId: 'tenant-a' }])
  })

  it('lists and reads only the tenant, and refuses another tenant', async () => {
    const store = signedInTenantAdmin()
    store.tenants = [tenantRecord({ tenantId: 'tenant-a' }), tenantRecord({ tenantId: 'tenant-b' })]
    store.accounts = [accountRecord(), accountRecord({ userId: 'user-3', tenantId: 'tenant-b' })]
    store.sessionLists = [sessionListRecord()]

    const list = await adminApiResponse(store, request('/admin/api/customers'))
    const listed = await list.json() as { customers: { tenantId: string; userCount: number }[] }
    expect(listed.customers).toEqual([expect.objectContaining({ tenantId: 'tenant-a', userCount: 1 })])

    const detail = await adminApiResponse(store, request('/admin/api/customers/tenant-a'))
    expect(detail.status).toBe(200)
    expect(store.sessionFilters).toEqual([{ tenantId: 'tenant-a' }])

    const other = await adminApiResponse(store, request('/admin/api/customers/tenant-b'))
    expect(other.status).toBe(403)
    expect(await other.json()).toEqual({ error: 'forbidden' })
    const otherPatch = await adminApiResponse(store, jsonPost('/admin/api/customers/tenant-b', { plan: 'free' }))
    expect(otherPatch.status).toBe(403)
    const otherUser = await adminApiResponse(store, jsonPost('/admin/api/customers/tenant-b/users', {
      email: 'new@example.com', password: 'a-long-enough-password', role: 'member',
    }))
    expect(otherUser.status).toBe(403)
  })

  it('forces the tenant on the session list and refuses another session', async () => {
    const store = signedInTenantAdmin()
    const expiresAt = new Date('2026-02-14T10:00:00.000Z')
    store.sessionsById = {
      'session-own': { sessionId: 'session-own', userId: 'user-1', tenantId: 'tenant-a', expiresAt, revokedAt: null },
      'session-foreign': { sessionId: 'session-foreign', userId: 'user-3', tenantId: 'tenant-b', expiresAt, revokedAt: null },
    }
    const scoped = await adminApiResponse(store, request('/admin/api/sessions?tenantId=tenant-b'))
    expect(scoped.status).toBe(200)
    expect(store.sessionFilters).toEqual([{ tenantId: 'tenant-a' }])

    const own = await adminApiResponse(store, jsonPost('/admin/api/sessions/session-own/revoke', {}))
    expect(own.status).toBe(200)
    expect(store.revoked).toEqual(['session-own'])

    const foreign = await adminApiResponse(store, jsonPost('/admin/api/sessions/session-foreign/revoke', {}))
    expect(foreign.status).toBe(403)
    expect(store.revoked).toEqual(['session-own'])
  })

  it('forbids tenant creation and platform-right promotion', async () => {
    const store = signedInTenantAdmin()
    const created = await adminApiResponse(store, jsonPost('/admin/api/customers', {
      name: 'Acme',
      plan: 'pro',
      adminEmail: 'new@example.com',
      password: 'correct-horse-battery',
    }))
    expect(created.status).toBe(403)
    expect(store.tenantInputs).toHaveLength(0)

    store.accounts = [accountRecord({ userId: 'user-2' })]
    const promote = await adminApiResponse(store, jsonPost('/admin/api/users/user-2', { platformAdmin: true }))
    expect(promote.status).toBe(403)
    const mixed = await adminApiResponse(store, jsonPost('/admin/api/users/user-2', { disabled: true, platformAdmin: false }))
    expect(mixed.status).toBe(403)
    expect(store.accountUpdates).toHaveLength(0)
  })

  it('confines user updates to the tenant and still refuses self-disable', async () => {
    const store = signedInTenantAdmin()
    store.accounts = [
      accountRecord({ userId: 'user-tenant-admin' }),
      accountRecord({ userId: 'user-2' }),
      accountRecord({ userId: 'user-3', tenantId: 'tenant-b' }),
    ]
    const own = await adminApiResponse(store, jsonPost('/admin/api/users/user-2', { role: 'member' }))
    expect(own.status).toBe(200)
    expect(store.accountUpdates).toEqual([{ userId: 'user-2', patch: { role: 'member' } }])

    const other = await adminApiResponse(store, jsonPost('/admin/api/users/user-3', { role: 'member' }))
    expect(other.status).toBe(403)
    expect(store.accountUpdates).toHaveLength(1)

    const selfDisable = await adminApiResponse(store, jsonPost('/admin/api/users/user-tenant-admin', { disabled: true }))
    expect(selfDisable.status).toBe(400)
    expect(await selfDisable.json()).toEqual({ error: 'invalid_request' })
    expect(store.accountUpdates).toHaveLength(1)
  })

  it('scopes the support inbox and triage to the tenant', async () => {
    const store = signedInTenantAdmin()
    store.support = [supportRecord(), supportRecord({ requestId: 'request-2', tenantId: 'tenant-b' })]
    const list = await adminApiResponse(store, request('/admin/api/support'))
    expect(list.status).toBe(200)
    expect(store.supportFilters).toEqual([{ tenantId: 'tenant-a' }])
    expect((await list.json() as { requests: { requestId: string }[] }).requests.map(entry => entry.requestId)).toEqual(['request-1'])

    const own = await adminApiResponse(store, jsonPost('/admin/api/support/request-1', { status: 'closed' }))
    expect(own.status).toBe(200)
    expect(store.supportUpdates).toEqual([{ requestId: 'request-1', patch: { status: 'closed' } }])

    const foreign = await adminApiResponse(store, jsonPost('/admin/api/support/request-2', { status: 'closed' }))
    expect(foreign.status).toBe(404)
    expect(store.supportUpdates).toHaveLength(1)
  })

  it('reports only the tenant sales events', async () => {
    const store = signedInTenantAdmin()
    store.sales = [salesRecord(), salesRecord({ eventId: 'evt-2', tenantId: 'tenant-b' })]
    const response = await adminApiResponse(store, request('/admin/api/sales'))
    expect(response.status).toBe(200)
    expect((await response.json() as { events: { eventId: string }[] }).events.map(event => event.eventId)).toEqual(['evt-1'])
    expect(store.salesLimits).toEqual([100])
  })
})

describe('overview and customers', () => {
  it('summarizes the platform from store reads', async () => {
    const store = signedIn(new FakeStore())
    store.tenants = [
      tenantRecord(),
      tenantRecord({ tenantId: 'tenant-b', status: 'trialing' }),
      tenantRecord({ tenantId: 'tenant-c', disabled: true, status: 'active' }),
    ]
    store.accounts = [accountRecord(), accountRecord({ userId: 'user-2' }), accountRecord({ userId: 'user-3', tenantId: 'tenant-b' })]
    store.support = [supportRecord(), supportRecord({ requestId: 'request-2' })]
    store.sessionLists = [sessionListRecord()]
    const response = await adminApiResponse(store, request('/admin/api/overview'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ customers: 3, activeCustomers: 1, users: 3, openSupport: 2, activeSessions: 1 })
    expect(store.supportFilters).toEqual([{ status: 'open' }])
    expect(store.sessionFilters).toEqual([{ activeOnly: true }])
  })

  it('lists customers with per-tenant user counts and newest activity', async () => {
    const store = signedIn(new FakeStore())
    store.tenants = [tenantRecord(), tenantRecord({ tenantId: 'tenant-b', name: 'Beta' })]
    store.accounts = [
      accountRecord({ lastSeenAt: createdAt }),
      accountRecord({ userId: 'user-2', lastSeenAt: updatedAt }),
    ]
    const response = await adminApiResponse(store, request('/admin/api/customers'))
    const body = await response.json() as { customers: { tenantId: string; userCount: number; lastSeenAt: string | null }[] }
    expect(body.customers).toHaveLength(2)
    expect(body.customers[0]).toMatchObject({ tenantId: 'tenant-a', userCount: 2, lastSeenAt: updatedAt.toISOString() })
    expect(body.customers[1]).toMatchObject({ tenantId: 'tenant-b', userCount: 0, lastSeenAt: null })
  })

  it('creates a customer tenant with a hashed first-admin password', async () => {
    const store = signedIn(new FakeStore())
    const response = await adminApiResponse(store, jsonPost('/admin/api/customers', {
      name: '  Acme Inc ',
      plan: 'pro',
      adminEmail: ' Owner@Example.com ',
      password: 'correct-horse-battery',
    }))
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ tenantId: 'tenant-new', userId: 'user-new' })
    const [input] = store.tenantInputs
    expect(input).toMatchObject({ name: 'Acme Inc', plan: 'pro', adminEmail: 'owner@example.com' })
    expect(input?.adminPasswordHash).toMatch(/^wiseai-argon2id-v1\$/)
    expect(input?.adminPasswordHash).not.toContain('correct-horse-battery')
  })

  it('validates the create-customer body', async () => {
    const store = signedIn(new FakeStore())
    const cases: unknown[] = [
      { plan: 'pro', adminEmail: 'owner@example.com', password: 'correct-horse-battery' },
      { name: 'Acme', plan: 'pro', adminEmail: 'not-an-email', password: 'correct-horse-battery' },
      { name: 'Acme', plan: 'pro', adminEmail: 'owner@example.com', password: 'short' },
      ['not', 'an', 'object'],
    ]
    for (const body of cases) {
      const response = await adminApiResponse(store, jsonPost('/admin/api/customers', body))
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: 'invalid_request' })
    }
    const malformed = await adminApiResponse(store, request('/admin/api/customers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    }))
    expect(malformed.status).toBe(400)
    const empty = await adminApiResponse(store, request('/admin/api/customers', { method: 'POST', headers: { 'content-type': 'application/json' } }))
    expect(empty.status).toBe(400)
    expect(store.tenantInputs).toHaveLength(0)
  })

  it('rejects an already-registered admin email', async () => {
    const store = signedIn(new FakeStore())
    store.users = [userRecord({ email: 'owner@example.com' })]
    const response = await adminApiResponse(store, jsonPost('/admin/api/customers', {
      name: 'Acme',
      plan: 'pro',
      adminEmail: 'Owner@Example.com',
      password: 'correct-horse-battery',
    }))
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'conflict' })
    expect(store.tenantInputs).toHaveLength(0)
  })

  it('reads one customer with its accounts and sessions', async () => {
    const store = signedIn(new FakeStore())
    store.tenants = [tenantRecord()]
    store.accounts = [accountRecord()]
    store.sessionLists = [sessionListRecord()]
    const response = await adminApiResponse(store, request('/admin/api/customers/tenant-a'))
    expect(response.status).toBe(200)
    const body = await response.json() as { customer: { tenantId: string }; users: { userId: string }[]; sessions: { sessionId: string }[] }
    expect(body.customer.tenantId).toBe('tenant-a')
    expect(body.users.map(user => user.userId)).toEqual(['user-1'])
    expect(body.sessions.map(session => session.sessionId)).toEqual(['session-1'])
    expect(store.sessionFilters).toEqual([{ tenantId: 'tenant-a' }])

    store.missingTenant = true
    const missing = await adminApiResponse(store, request('/admin/api/customers/tenant-a'))
    expect(missing.status).toBe(404)
  })

  it('patches a customer profile with parsed and nullable fields', async () => {
    const store = signedIn(new FakeStore())
    store.tenants = [tenantRecord()]
    const response = await adminApiResponse(store, jsonPost('/admin/api/customers/tenant-a', {
      name: '  Acme Two ',
      plan: 'team',
      status: 'past_due',
      disabled: true,
      accessUntil: '2026-03-01T00:00:00.000Z',
      notes: 'renewal pending',
      stripeCustomerId: 'cus-9',
      stripeSubscriptionId: null,
    }))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8')
    expect(store.tenantUpdates).toEqual([{
      tenantId: 'tenant-a',
      patch: {
        name: 'Acme Two',
        plan: 'team',
        status: 'past_due',
        disabled: true,
        accessUntil: new Date('2026-03-01T00:00:00.000Z'),
        notes: 'renewal pending',
        stripeCustomerId: 'cus-9',
        stripeSubscriptionId: null,
      },
    }])
  })

  it('rejects invalid customer patches and reports a missing tenant', async () => {
    const store = signedIn(new FakeStore())
    store.tenants = [tenantRecord()]
    const cases: unknown[] = [
      { status: 'unknown' },
      { disabled: 'yes' },
      { accessUntil: 'not-a-date' },
      { accessUntil: 42 },
      { notes: 42 },
      { stripeCustomerId: 42 },
    ]
    for (const body of cases) {
      const response = await adminApiResponse(store, jsonPost('/admin/api/customers/tenant-a', body))
      expect(response.status).toBe(400)
    }
    expect(store.tenantUpdates).toHaveLength(0)

    store.missingTenant = true
    const missing = await adminApiResponse(store, jsonPost('/admin/api/customers/tenant-a', { plan: 'free' }))
    expect(missing.status).toBe(404)
  })

  it('adds an account to a customer tenant', async () => {
    const store = signedIn(new FakeStore())
    const response = await adminApiResponse(store, jsonPost('/admin/api/customers/tenant-a/users', {
      email: ' Grace@Example.com ',
      password: 'a-long-enough-password',
      role: 'member',
    }))
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ userId: 'user-added' })
    expect(store.accountInputs[0]).toMatchObject({ tenantId: 'tenant-a', email: 'grace@example.com', role: 'member' })
    expect(store.accountInputs[0]?.passwordHash).toMatch(/^wiseai-argon2id-v1\$/)

    const badRole = await adminApiResponse(store, jsonPost('/admin/api/customers/tenant-a/users', {
      email: 'other@example.com', password: 'a-long-enough-password', role: 'owner',
    }))
    expect(badRole.status).toBe(400)
    const shortPassword = await adminApiResponse(store, jsonPost('/admin/api/customers/tenant-a/users', {
      email: 'other@example.com', password: 'short', role: 'member',
    }))
    expect(shortPassword.status).toBe(400)
  })

  it('updates one account and refuses self-disable', async () => {
    const store = signedIn(new FakeStore())
    store.accounts = [accountRecord({ userId: 'user-2' })]
    const response = await adminApiResponse(store, jsonPost('/admin/api/users/user-2', {
      disabled: true,
      role: 'admin',
      platformAdmin: true,
      password: 'another-long-password',
    }))
    expect(response.status).toBe(200)
    const patch = store.accountUpdates[0]?.patch
    expect(patch).toMatchObject({ disabled: true, role: 'admin', platformAdmin: true })
    expect(patch?.passwordHash).toMatch(/^wiseai-argon2id-v1\$/)

    const selfDisable = await adminApiResponse(store, jsonPost('/admin/api/users/user-admin', { disabled: true }))
    expect(selfDisable.status).toBe(400)
    expect(await selfDisable.json()).toEqual({ error: 'invalid_request' })
    expect(store.accountUpdates).toHaveLength(1)

    const badRole = await adminApiResponse(store, jsonPost('/admin/api/users/user-2', { role: 'owner' }))
    expect(badRole.status).toBe(400)
    const shortPassword = await adminApiResponse(store, jsonPost('/admin/api/users/user-2', { password: 'short' }))
    expect(shortPassword.status).toBe(400)

    store.missingAccount = true
    const missing = await adminApiResponse(store, jsonPost('/admin/api/users/missing', { disabled: true }))
    expect(missing.status).toBe(404)
  })
})

describe('sessions and support inbox', () => {
  it('lists sessions, optionally scoped to a tenant, and revokes one', async () => {
    const store = signedIn(new FakeStore())
    store.sessionLists = [sessionListRecord()]
    const all = await adminApiResponse(store, request('/admin/api/sessions'))
    expect(all.status).toBe(200)
    expect((await all.json() as { sessions: unknown[] }).sessions).toHaveLength(1)
    expect(store.sessionFilters).toEqual([{}])

    const scoped = await adminApiResponse(store, request('/admin/api/sessions?tenantId=tenant-a'))
    expect(scoped.status).toBe(200)
    expect(store.sessionFilters[1]).toEqual({ tenantId: 'tenant-a' })

    const revoked = await adminApiResponse(store, jsonPost('/admin/api/sessions/session-1/revoke', {}))
    expect(revoked.status).toBe(200)
    expect(await revoked.json()).toEqual({ ok: true })
    expect(store.revoked).toEqual(['session-1'])
  })

  it('lists the support inbox and applies the status filter', async () => {
    const store = signedIn(new FakeStore())
    store.support = [supportRecord()]
    const all = await adminApiResponse(store, request('/admin/api/support'))
    expect(all.status).toBe(200)
    expect(store.supportFilters).toEqual([{}])

    const open = await adminApiResponse(store, request('/admin/api/support?status=open'))
    expect(open.status).toBe(200)
    expect(store.supportFilters[1]).toEqual({ status: 'open' })
    expect((await open.json() as { requests: { requestId: string }[] }).requests[0]?.requestId).toBe('request-1')

    const invalid = await adminApiResponse(store, request('/admin/api/support?status=urgent'))
    expect(invalid.status).toBe(400)
  })

  it('triages one support request and reports a missing one', async () => {
    const store = signedIn(new FakeStore())
    const response = await adminApiResponse(store, jsonPost('/admin/api/support/request-1', {
      status: 'in_progress',
      priority: 'high',
      adminNote: 'Contacted the customer.',
    }))
    expect(response.status).toBe(200)
    expect(store.supportUpdates).toEqual([{
      requestId: 'request-1',
      patch: { status: 'in_progress', priority: 'high', adminNote: 'Contacted the customer.' },
    }])
    expect((await response.json() as { request: { status: string } }).request.status).toBe('in_progress')

    const badPriority = await adminApiResponse(store, jsonPost('/admin/api/support/request-1', { priority: 'urgent' }))
    expect(badPriority.status).toBe(400)

    store.missingSupport = true
    const missing = await adminApiResponse(store, jsonPost('/admin/api/support/missing', { status: 'closed' }))
    expect(missing.status).toBe(404)
  })
})

describe('sales ledger', () => {
  it('reports Stripe configuration from the environment and the newest events', async () => {
    const store = signedIn(new FakeStore())
    store.sales = [salesRecord()]
    delete process.env.STRIPE_SECRET_KEY
    const unconfigured = await adminApiResponse(store, request('/admin/api/sales'))
    expect(unconfigured.status).toBe(200)
    expect(await unconfigured.json()).toMatchObject({ configured: false })
    expect(store.salesLimits).toEqual([100])

    process.env.STRIPE_SECRET_KEY = 'sk_test_123'
    const configured = await adminApiResponse(store, request('/admin/api/sales'))
    expect(await configured.json()).toMatchObject({ configured: true, events: [{ eventId: 'evt-1', amountTotal: 4900 }] })
  })
})

describe('member support intake', () => {
  it('rejects an unauthenticated account', async () => {
    const store = new FakeStore()
    const response = await supportApiResponse(store, jsonPost('/support/requests', { subject: 'Help', message: 'Please help.' }, false))
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'unauthenticated' })
    expect(store.supportInputs).toHaveLength(0)
  })

  it('accepts a support request from an enabled member and scopes it to the session', async () => {
    const store = signedIn(new FakeStore(), { userId: 'user-member', role: 'member', platformAdmin: false, tenantId: 'tenant-a' })
    const response = await supportApiResponse(store, jsonPost('/support/requests', {
      subject: '  Cannot sign in  ',
      message: '  The sign-in form rejects my password.  ',
      pageUrl: 'https://app.example/chat',
    }))
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ requestId: 'request-new' })
    expect(store.supportInputs).toEqual([{
      tenantId: 'tenant-a',
      userId: 'user-member',
      subject: 'Cannot sign in',
      message: 'The sign-in form rejects my password.',
      pageUrl: 'https://app.example/chat',
    }])
  })

  it('defaults an absent page URL', async () => {
    const store = signedIn(new FakeStore(), { userId: 'user-member', role: 'member', platformAdmin: false })
    const response = await supportApiResponse(store, jsonPost('/support/requests', { subject: 'Help', message: 'Please help.' }))
    expect(response.status).toBe(201)
    expect(store.supportInputs[0]?.pageUrl).toBe('')
  })

  it('validates trimmed field bounds', async () => {
    const store = signedIn(new FakeStore(), { userId: 'user-member', role: 'member', platformAdmin: false })
    const cases: unknown[] = [
      { subject: '   ', message: 'Please help.' },
      { subject: 'a'.repeat(201), message: 'Please help.' },
      { subject: 'Help', message: '   ' },
      { subject: 'Help', message: 'a'.repeat(5001) },
      { subject: 'Help', message: 'Please help.', pageUrl: 'a'.repeat(2049) },
      { subject: 'Help', message: 'Please help.', pageUrl: 42 },
      [],
    ]
    for (const body of cases) {
      const response = await supportApiResponse(store, jsonPost('/support/requests', body))
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: 'invalid_request' })
    }
    expect(store.supportInputs).toHaveLength(0)
  })

  it('rejects malformed and oversized bodies', async () => {
    const store = signedIn(new FakeStore(), { userId: 'user-member', role: 'member', platformAdmin: false })
    const malformed = await supportApiResponse(store, request('/support/requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    }))
    expect(malformed.status).toBe(400)

    const oversized = await supportApiResponse(store, request('/support/requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'x'.repeat(1_048_577),
    }))
    expect(oversized.status).toBe(413)
    expect(await oversized.json()).toEqual({ error: 'request_too_large' })
  })

  it('answers 404 for other support routes', async () => {
    const store = signedIn(new FakeStore(), { userId: 'user-member', role: 'member', platformAdmin: false })
    expect((await supportApiResponse(store, request('/support/other', { method: 'POST' }))).status).toBe(404)
    expect((await supportApiResponse(store, request('/support/requests', { method: 'GET' }))).status).toBe(404)
  })
})
