/**
 * JSON HTTP surface for the hosted WiseAI administration page and the in-app
 * member support intake. Both routers are pure `Request -> Response` functions
 * so the desktop host and the unit suites exercise the same routing and
 * validation; the exported `handle*` adapters bind them to the Node server.
 * Admin callers are the platform operator, whose scope is every tenant, and
 * tenant administrators, whose scope is their own tenant.
 *
 * @module @deepseek-ai/dsh-api-tenant-auth/admin-http
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { hashPassword, verifyPassword } from './password.ts'
import { resolveSession } from './session-tokens.ts'
import { isSameOriginMutation } from './origin.ts'
import type {
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
} from './types.ts'

const COOKIE = 'wiseai_session'
const MAX_BODY_BYTES = 1_048_576
const MAX_PASSWORD_BYTES = 1024
const MIN_PASSWORD_LENGTH = 12
const MAX_EMAIL_LENGTH = 320

const TENANT_STATUSES = new Set<string>(['active', 'trialing', 'past_due', 'canceled', 'disabled'])
const SUPPORT_STATUSES = new Set<string>(['open', 'in_progress', 'closed'])
const SUPPORT_PRIORITIES = new Set<string>(['low', 'normal', 'high'])
const ROLES = new Set<string>(['admin', 'member'])

/** One authenticated caller resolved from the browser session cookie. */
interface TenantPrincipal {
  readonly user: TenantUserRecord
  readonly session: TenantSessionRecord
}

/** A tenant profile patch being assembled from validated request fields. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] }

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

function invalidRequest(): Response {
  return json({ error: 'invalid_request' }, 400)
}

function notFound(): Response {
  return json({ error: 'not_found' }, 404)
}

function forbidden(): Response {
  return json({ error: 'forbidden' }, 403)
}

function cookieValue(request: Request): string | undefined {
  const value = request.headers.get('cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`))
  return value === undefined ? undefined : decodeURIComponent(value.slice(COOKIE.length + 1))
}

/**
 * Resolve the signed-in account behind the `wiseai_session` cookie.
 * @param store - tenant identity store.
 * @param request - incoming browser request.
 * @returns the enabled account and its active session, or null when unauthenticated.
 */
async function authenticate(store: TenantAuthStore, request: Request): Promise<TenantPrincipal | null> {
  const token = cookieValue(request)
  if (token === undefined) return null
  const session = await resolveSession(store, token)
  if (session === null) return null
  const user = await store.findUserById(session.userId)
  if (user === null || user.disabled || user.tenantId !== session.tenantId) return null
  return { user, session }
}

/** An administration caller: the platform operator or one tenant's administrator. */
export interface AdminCaller {
  readonly user: TenantUserRecord
  /** True for the platform operator, whose scope is every tenant; false for a tenant administrator. */
  readonly platform: boolean
}

/** Accounts admitted to the admin surface: platform operators and tenant administrators. */
function isAdminAccount(user: TenantUserRecord): boolean {
  return user.platformAdmin || user.role === 'admin'
}

/**
 * Resolve the platform operator behind the session cookie.
 * @param store - tenant identity store.
 * @param request - incoming browser request.
 * @returns the platform administrator, or null when the caller is unauthenticated, disabled, or not a platform operator.
 */
export async function resolvePlatformAdmin(store: TenantAuthStore, request: Request): Promise<TenantUserRecord | null> {
  const principal = await authenticate(store, request)
  return principal !== null && principal.user.platformAdmin ? principal.user : null
}

/**
 * Resolve an admin-surface caller behind the session cookie: an enabled
 * platform operator or an enabled tenant administrator.
 * @param store - tenant identity store.
 * @param request - incoming browser request.
 * @returns the account and whether it is the platform operator, or null when
 * the caller is unauthenticated, disabled, or neither kind of administrator.
 */
export async function resolveAdmin(store: TenantAuthStore, request: Request): Promise<AdminCaller | null> {
  const principal = await authenticate(store, request)
  if (principal === null || !isAdminAccount(principal.user)) return null
  return { user: principal.user, platform: principal.user.platformAdmin }
}

/**
 * Resolve any enabled signed-in account behind the session cookie.
 * @param store - tenant identity store.
 * @param request - incoming browser request.
 * @returns the account together with its session, or null when unauthenticated.
 */
export async function resolveTenantAccount(
  store: TenantAuthStore,
  request: Request,
): Promise<{ user: TenantUserRecord; session: TenantSessionRecord } | null> {
  return authenticate(store, request)
}

/** A decoded JSON body, or the status and code the router must answer with. */
type JsonBody =
  | { readonly kind: 'value'; readonly value: unknown }
  | { readonly kind: 'invalid'; readonly status: 400 | 413; readonly error: 'invalid_request' | 'request_too_large' }

/** Read a bounded JSON body without trusting its declared length. */
async function readJsonBody(request: Request): Promise<JsonBody> {
  const declared = request.headers.get('content-length')
  if (declared !== null && Number(declared) > MAX_BODY_BYTES) return { kind: 'invalid', status: 413, error: 'request_too_large' }
  const bytes = await request.arrayBuffer()
  if (bytes.byteLength > MAX_BODY_BYTES) return { kind: 'invalid', status: 413, error: 'request_too_large' }
  try {
    return { kind: 'value', value: JSON.parse(new TextDecoder().decode(bytes)) }
  } catch {
    // A body that is not JSON is a malformed request, not a server failure.
    return { kind: 'invalid', status: 400, error: 'invalid_request' }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function trimmedString(value: unknown, min: number, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length >= min && trimmed.length <= max ? trimmed : null
}

/** Emails are compared and stored folded, matching the store's uniqueness rules. */
function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const email = value.trim().toLowerCase()
  return email.length > 0 && email.length <= MAX_EMAIL_LENGTH && email.includes('@') ? email : null
}

function validPassword(value: unknown): value is string {
  return typeof value === 'string' && value.length >= MIN_PASSWORD_LENGTH && Buffer.byteLength(value) <= MAX_PASSWORD_BYTES
}

function isTenantStatus(value: unknown): value is TenantRecord['status'] {
  return typeof value === 'string' && TENANT_STATUSES.has(value)
}

function isSupportStatus(value: unknown): value is SupportRequestRecord['status'] {
  return typeof value === 'string' && SUPPORT_STATUSES.has(value)
}

function isSupportPriority(value: unknown): value is SupportRequestRecord['priority'] {
  return typeof value === 'string' && SUPPORT_PRIORITIES.has(value)
}

function isRole(value: unknown): value is 'admin' | 'member' {
  return typeof value === 'string' && ROLES.has(value)
}

/** Read a JSON body, mapping malformed input to its typed error response. */
async function readBody(request: Request): Promise<{ readonly value: Record<string, unknown> } | { readonly response: Response }> {
  const body = await readJsonBody(request)
  if (body.kind === 'invalid') return { response: json({ error: body.error }, body.status) }
  if (!isRecord(body.value)) return { response: invalidRequest() }
  return { value: body.value }
}

/**
 * Summarize the deployment.
 * @param store - tenant identity store.
 * @param tenantScope - the caller's tenant, or undefined for the platform operator.
 * @returns the counts visible to the caller.
 */
async function overview(store: TenantAuthStore, tenantScope: string | undefined): Promise<Response> {
  if (tenantScope !== undefined) {
    const [tenant, accounts, openRequests, activeSessions] = await Promise.all([
      store.findTenantById(tenantScope),
      store.listAccounts(tenantScope),
      store.listSupportRequests({ status: 'open', tenantId: tenantScope }),
      store.listSessions({ activeOnly: true, tenantId: tenantScope }),
    ])
    return json({
      customers: tenant === null ? 0 : 1,
      activeCustomers: tenant !== null && !tenant.disabled && tenant.status === 'active' ? 1 : 0,
      users: accounts.length,
      openSupport: openRequests.length,
      activeSessions: activeSessions.length,
    })
  }
  const [tenants, accounts, openRequests, activeSessions] = await Promise.all([
    store.listTenants(),
    store.listAllAccounts(),
    store.listSupportRequests({ status: 'open' }),
    store.listSessions({ activeOnly: true }),
  ])
  return json({
    customers: tenants.length,
    activeCustomers: tenants.filter(tenant => !tenant.disabled && tenant.status === 'active').length,
    users: accounts.length,
    openSupport: openRequests.length,
    activeSessions: activeSessions.length,
  })
}

/** Per-tenant account count and newest activity, keyed by tenant id. */
function accountStats(accounts: readonly TenantAccountRecord[]): Map<string, { userCount: number; lastSeenAt: Date | null }> {
  const stats = new Map<string, { userCount: number; lastSeenAt: Date | null }>()
  for (const account of accounts) {
    const entry = stats.get(account.tenantId) ?? { userCount: 0, lastSeenAt: null }
    entry.userCount += 1
    if (account.lastSeenAt !== null && (entry.lastSeenAt === null || account.lastSeenAt > entry.lastSeenAt)) {
      entry.lastSeenAt = account.lastSeenAt
    }
    stats.set(account.tenantId, entry)
  }
  return stats
}

/**
 * List the customer tenants visible to the caller.
 * @param store - tenant identity store.
 * @param tenantScope - the caller's tenant, or undefined for the platform operator.
 * @returns the customer rows with per-tenant user counts and newest activity.
 */
async function listCustomers(store: TenantAuthStore, tenantScope: string | undefined): Promise<Response> {
  if (tenantScope !== undefined) {
    const [tenant, accounts] = await Promise.all([store.findTenantById(tenantScope), store.listAccounts(tenantScope)])
    const stats = accountStats(accounts)
    const customers = tenant === null ? [] : [{ ...tenant, ...(stats.get(tenantScope) ?? { userCount: 0, lastSeenAt: null }) }]
    return json({ customers })
  }
  const [tenants, accounts] = await Promise.all([store.listTenants(), store.listAllAccounts()])
  const stats = accountStats(accounts)
  const customers = tenants.map(tenant => ({ ...tenant, ...(stats.get(tenant.tenantId) ?? { userCount: 0, lastSeenAt: null }) }))
  return json({ customers })
}

async function createCustomer(store: TenantAuthStore, request: Request): Promise<Response> {
  const body = await readBody(request)
  if ('response' in body) return body.response
  const name = trimmedString(body.value.name, 1, 200)
  const plan = trimmedString(body.value.plan, 1, 64)
  const adminEmail = normalizeEmail(body.value.adminEmail)
  const password = body.value.password
  if (name === null || plan === null || adminEmail === null || !validPassword(password)) return invalidRequest()
  if (await store.findUserByEmail(adminEmail) !== null) return json({ error: 'conflict' }, 409)
  const created = await store.createTenant({ name, plan, adminEmail, adminPasswordHash: await hashPassword(password) })
  return json(created, 201)
}

async function customerDetail(store: TenantAuthStore, tenantId: string): Promise<Response> {
  const customer = await store.findTenantById(tenantId)
  if (customer === null) return notFound()
  const [users, sessions] = await Promise.all([store.listAccounts(tenantId), store.listSessions({ tenantId })])
  return json({ customer, users, sessions })
}

async function customerDeletePreview(store: TenantAuthStore, tenantId: string): Promise<Response> {
  const customer = await store.findTenantById(tenantId)
  if (customer === null) return notFound()
  const [users, sessions] = await Promise.all([store.listAccounts(tenantId), store.listSessions({ tenantId })])
  return json({
    tenantId,
    name: customer.name,
    plan: customer.plan,
    status: customer.status,
    users: users.length,
    sessions: sessions.length,
    confirmationName: customer.name,
    requiresReauthentication: true,
  })
}

async function customerSoftDelete(
  store: TenantAuthStore,
  actor: TenantUserRecord,
  tenantId: string,
  request: Request,
): Promise<Response> {
  if (tenantId === actor.tenantId) return invalidRequest()
  const body = await readBody(request)
  if ('response' in body) return body.response
  const password = body.value.password
  const confirmationName = body.value.confirmationName
  if (typeof password !== 'string' || password.length === 0 || typeof confirmationName !== 'string') return invalidRequest()
  const customer = await store.findTenantById(tenantId)
  if (customer === null) return notFound()
  const account = await store.findUserById(actor.userId)
  if (account === null || !(await verifyPassword(password, account.passwordHash))) {
    return json({ error: 'reauth_failed' }, 403)
  }
  if (confirmationName !== customer.name) return json({ error: 'confirmation_mismatch' }, 400)
  const [users, sessions] = await Promise.all([store.listAccounts(tenantId), store.listSessions({ tenantId })])
  await store.recordAuditEvent({
    action: 'customer.soft_delete',
    actorUserId: actor.userId,
    actorTenantId: actor.tenantId,
    targetTenantId: tenantId,
    targetId: customer.name,
    details: { users: users.length, sessions: sessions.length, plan: customer.plan, previousStatus: customer.status },
  })
  if (!(await store.softDeleteTenant(tenantId))) return notFound()
  await store.revokeSessions({ tenantId })
  return json({ ok: true })
}

async function auditEvents(store: TenantAuthStore, tenantScope: string | undefined, url: URL): Promise<Response> {
  const requested = Number(url.searchParams.get('limit') ?? '100')
  const limit = Number.isSafeInteger(requested) && requested > 0 ? Math.min(requested, 1000) : 100
  const events = await store.listAuditEvents(tenantScope === undefined ? { limit } : { tenantId: tenantScope, limit })
  return json({ events })
}

async function updateCustomer(store: TenantAuthStore, actor: TenantUserRecord, tenantId: string, request: Request): Promise<Response> {
  const body = await readBody(request)
  if ('response' in body) return body.response
  const fields = body.value
  const patch: Mutable<TenantProfilePatch> = {}
  if (fields.name !== undefined) {
    const name = trimmedString(fields.name, 1, 200)
    if (name === null) return invalidRequest()
    patch.name = name
  }
  if (fields.plan !== undefined) {
    const plan = trimmedString(fields.plan, 1, 64)
    if (plan === null) return invalidRequest()
    patch.plan = plan
  }
  if (fields.status !== undefined) {
    if (!isTenantStatus(fields.status)) return invalidRequest()
    patch.status = fields.status
  }
  if (fields.disabled !== undefined) {
    if (typeof fields.disabled !== 'boolean') return invalidRequest()
    patch.disabled = fields.disabled
  }
  if (fields.accessUntil !== undefined) {
    if (fields.accessUntil === null) patch.accessUntil = null
    else if (typeof fields.accessUntil === 'string') {
      const accessUntil = new Date(fields.accessUntil)
      if (Number.isNaN(accessUntil.getTime())) return invalidRequest()
      patch.accessUntil = accessUntil
    } else return invalidRequest()
  }
  if (fields.notes !== undefined) {
    if (typeof fields.notes !== 'string') return invalidRequest()
    patch.notes = fields.notes
  }
  if (fields.stripeCustomerId !== undefined) {
    if (fields.stripeCustomerId !== null && typeof fields.stripeCustomerId !== 'string') return invalidRequest()
    patch.stripeCustomerId = fields.stripeCustomerId
  }
  if (fields.stripeSubscriptionId !== undefined) {
    if (fields.stripeSubscriptionId !== null && typeof fields.stripeSubscriptionId !== 'string') return invalidRequest()
    patch.stripeSubscriptionId = fields.stripeSubscriptionId
  }
  const customer = await store.updateTenant(tenantId, patch)
  if (customer === null) return notFound()
  // Suspension takes effect immediately for sign-ins: the tenant's live login
  // sessions are revoked so the next request cannot keep using one.
  if (patch.status === 'canceled' || patch.status === 'disabled' || patch.disabled === true) {
    await store.revokeSessions({ tenantId })
    await store.recordAuditEvent({
      action: 'customer.suspended',
      actorUserId: actor.userId,
      actorTenantId: actor.tenantId,
      targetTenantId: tenantId,
      details: { status: customer.status, disabled: customer.disabled },
    })
  }
  return json({ customer })
}

async function addCustomerUser(store: TenantAuthStore, tenantId: string, request: Request): Promise<Response> {
  const body = await readBody(request)
  if ('response' in body) return body.response
  const email = normalizeEmail(body.value.email)
  const role = body.value.role
  const password = body.value.password
  if (email === null || !isRole(role) || !validPassword(password)) return invalidRequest()
  if (await store.findUserByEmail(email) !== null) return json({ error: 'conflict' }, 409)
  const created = await store.createUserInTenant({ tenantId, email, passwordHash: await hashPassword(password), role })
  return json(created, 201)
}

async function updateUser(
  store: TenantAuthStore,
  actor: TenantUserRecord,
  tenantScope: string | undefined,
  userId: string,
  request: Request,
): Promise<Response> {
  if (tenantScope !== undefined) {
    const account = await store.findAccountById(userId)
    if (account === null) return notFound()
    if (account.tenantId !== tenantScope) return forbidden()
  }
  const body = await readBody(request)
  if ('response' in body) return body.response
  const fields = body.value
  const patch: Mutable<TenantAccountPatch> = {}
  if (fields.disabled !== undefined) {
    if (typeof fields.disabled !== 'boolean') return invalidRequest()
    if (fields.disabled && userId === actor.userId) return invalidRequest()
    patch.disabled = fields.disabled
  }
  if (fields.role !== undefined) {
    if (!isRole(fields.role)) return invalidRequest()
    patch.role = fields.role
  }
  if (fields.platformAdmin !== undefined) {
    if (typeof fields.platformAdmin !== 'boolean') return invalidRequest()
    // Only the platform operator may grant or revoke platform rights.
    if (tenantScope !== undefined) return forbidden()
    patch.platformAdmin = fields.platformAdmin
  }
  if (fields.password !== undefined) {
    if (!validPassword(fields.password)) return invalidRequest()
    patch.passwordHash = await hashPassword(fields.password)
  }
  const user: TenantAccountRecord | null = await store.updateAccount(userId, patch)
  if (user === null) return notFound()
  if (patch.disabled === true) {
    // Disabling an account also ends its live sign-ins.
    await store.revokeSessions({ userId })
    await store.recordAuditEvent({
      action: 'user.suspended',
      actorUserId: actor.userId,
      actorTenantId: actor.tenantId,
      targetTenantId: user.tenantId,
      targetId: userId,
    })
  }
  return json({ user })
}

/**
 * List sessions within the caller's scope.
 * @param store - tenant identity store.
 * @param tenantScope - the caller's tenant, or undefined for the platform operator.
 * @param url - request URL carrying the optional platform tenant filter.
 * @returns the listed sessions.
 */
async function listSessions(store: TenantAuthStore, tenantScope: string | undefined, url: URL): Promise<Response> {
  const requested = url.searchParams.get('tenantId')
  const tenantId = tenantScope ?? (requested === null || requested === '' ? undefined : requested)
  const sessions: readonly TenantSessionListRecord[] = await store.listSessions(tenantId === undefined ? {} : { tenantId })
  return json({ sessions })
}

/**
 * Revoke one session within the caller's scope.
 * @param store - tenant identity store.
 * @param tenantScope - the caller's tenant, or undefined for the platform operator.
 * @param sessionId - the session to revoke.
 * @returns 200 once revoked; 403 for another tenant's session.
 */
async function revokeSession(store: TenantAuthStore, tenantScope: string | undefined, sessionId: string): Promise<Response> {
  if (tenantScope !== undefined) {
    const session = await store.findSession(sessionId)
    if (session === null) return notFound()
    if (session.tenantId !== tenantScope) return forbidden()
  }
  await store.revokeSession(sessionId)
  return json({ ok: true })
}

/**
 * List the support inbox within the caller's scope.
 * @param store - tenant identity store.
 * @param tenantScope - the caller's tenant, or undefined for the platform operator.
 * @param url - request URL carrying the optional status filter.
 * @returns the matching support requests.
 */
async function listSupportRequests(store: TenantAuthStore, tenantScope: string | undefined, url: URL): Promise<Response> {
  const status = url.searchParams.get('status')
  if (status !== null && status !== '' && !isSupportStatus(status)) return invalidRequest()
  return json({
    requests: await store.listSupportRequests({
      ...status === null || status === '' ? {} : { status },
      ...tenantScope === undefined ? {} : { tenantId: tenantScope },
    }),
  })
}

/**
 * Triage one support request within the caller's scope.
 * @param store - tenant identity store.
 * @param tenantScope - the caller's tenant, or undefined for the platform operator.
 * @param requestId - the support request to update.
 * @param request - request carrying the validated patch.
 * @returns the updated request; 404 when it is absent or belongs to another tenant.
 */
async function updateSupportRequest(
  store: TenantAuthStore,
  tenantScope: string | undefined,
  requestId: string,
  request: Request,
): Promise<Response> {
  if (tenantScope !== undefined) {
    const owned = await store.listSupportRequests({ tenantId: tenantScope })
    if (!owned.some(candidate => candidate.requestId === requestId)) return notFound()
  }
  const body = await readBody(request)
  if ('response' in body) return body.response
  const fields = body.value
  const patch: Mutable<SupportRequestPatch> = {}
  if (fields.status !== undefined) {
    if (!isSupportStatus(fields.status)) return invalidRequest()
    patch.status = fields.status
  }
  if (fields.priority !== undefined) {
    if (!isSupportPriority(fields.priority)) return invalidRequest()
    patch.priority = fields.priority
  }
  if (fields.adminNote !== undefined) {
    if (typeof fields.adminNote !== 'string') return invalidRequest()
    patch.adminNote = fields.adminNote
  }
  const updated = await store.updateSupportRequest(requestId, patch)
  return updated === null ? notFound() : json({ request: updated })
}

/**
 * Report Stripe configuration and the sales ledger within the caller's scope.
 * @param store - tenant identity store.
 * @param tenantScope - the caller's tenant, or undefined for the platform operator.
 * @returns the ledger events the caller may see.
 */
async function sales(store: TenantAuthStore, tenantScope: string | undefined): Promise<Response> {
  const events = await store.listSalesEvents(100)
  return json({
    configured: Boolean(process.env.STRIPE_SECRET_KEY),
    events: tenantScope === undefined ? events : events.filter(event => event.tenantId === tenantScope),
  })
}

/**
 * Report the signed-in administrator and its tenant.
 * @param store - tenant identity store.
 * @param user - the authenticated administrator.
 * @returns the identity fields the admin page uses to choose its view.
 */
async function whoAmI(store: TenantAuthStore, user: TenantUserRecord): Promise<Response> {
  const tenant = await store.findTenantById(user.tenantId)
  return json({
    email: user.email,
    role: user.role,
    platformAdmin: user.platformAdmin,
    tenantId: user.tenantId,
    tenantName: tenant?.name ?? '',
  })
}

/**
 * Route one `/admin/api/*` request for a platform operator or a tenant
 * administrator. A tenant administrator is confined to its own tenant:
 * platform-wide reads are narrowed, and tenant creation and platform rights
 * are refused.
 * @param store - tenant identity store.
 * @param request - incoming JSON request.
 * @returns the JSON response; 401 for an absent session, 403 for an account
 * that is neither kind of administrator or for an operation outside a tenant
 * administrator's tenant, 404 for an unknown route.
 */
export async function adminApiResponse(store: TenantAuthStore, request: Request): Promise<Response> {
  if (!isSameOriginMutation(request)) return forbidden()
  const principal = await authenticate(store, request)
  if (principal === null) return json({ error: 'unauthenticated' }, 401)
  if (!isAdminAccount(principal.user)) return forbidden()
  const response = await dispatchAdmin(store, principal, request)
  if (request.method === 'POST' && response.ok) await recordMutationAudit(store, principal.user, request)
  return response
}

/**
 * Audit action for one successful mutating admin route. The customer-delete
 * handler records its own detailed soft-delete event, so this returns
 * undefined for it to keep one record per action.
 * @param segments - decoded path segments below `/admin/api`.
 * @returns the action name and optional customer scope, or undefined.
 */
function mutationAuditAction(segments: readonly string[]): { action: string; targetTenantId?: string } | undefined {
  const [, , resource, first, second] = segments
  if (resource === 'customers' && first === undefined) return { action: 'customer.create' }
  if (resource === 'customers' && second === undefined && first !== undefined) return { action: 'customer.update', targetTenantId: first }
  if (resource === 'customers' && second === 'users' && first !== undefined) return { action: 'user.create', targetTenantId: first }
  if (resource === 'customers' && second === 'delete') return undefined
  if (resource === 'users' && first !== undefined) return { action: 'user.update' }
  if (resource === 'sessions' && first === 'revoke-all') return { action: 'session.revoke_all' }
  if (resource === 'sessions' && first === 'purge-revoked') return { action: 'session.purge_revoked' }
  if (resource === 'sessions' && second === 'revoke' && first !== undefined) return { action: 'session.revoke' }
  if (resource === 'support' && first !== undefined) return { action: 'support.update' }
  return undefined
}

/** Append one audit record for the completed admin mutation; logging never changes the response. */
async function recordMutationAudit(store: TenantAuthStore, actor: TenantUserRecord, request: Request): Promise<void> {
  const url = new URL(request.url, 'http://localhost')
  const segments = url.pathname.split('/').filter(segment => segment.length > 0)
  const mapped = mutationAuditAction(segments)
  if (mapped === undefined) return
  const third = segments[3]
  try {
    await store.recordAuditEvent({
      action: mapped.action,
      actorUserId: actor.userId,
      actorTenantId: actor.tenantId,
      ...mapped.targetTenantId === undefined ? {} : { targetTenantId: mapped.targetTenantId },
      ...third === undefined ? {} : { targetId: third },
      details: { path: url.pathname },
    })
  } catch (error) {
    console.error('[wiseai-tenant-auth] audit write failed:', error)
  }
}

async function dispatchAdmin(
  store: TenantAuthStore,
  principal: { readonly user: TenantUserRecord },
  request: Request,
): Promise<Response> {
  const tenantScope = principal.user.platformAdmin ? undefined : principal.user.tenantId
  const url = new URL(request.url, 'http://localhost')
  const segments = url.pathname.split('/').filter(segment => segment.length > 0)
  const method = request.method
  const resource = segments[2]
  const rest = segments.slice(3)
  if (segments[0] !== 'admin' || segments[1] !== 'api') return notFound()
  if (resource === 'me' && rest.length === 0 && method === 'GET') return whoAmI(store, principal.user)
  if (resource === 'overview' && rest.length === 0 && method === 'GET') return overview(store, tenantScope)
  if (resource === 'customers' && rest.length === 0) {
    if (method === 'GET') return listCustomers(store, tenantScope)
    if (method === 'POST') return tenantScope === undefined ? createCustomer(store, request) : forbidden()
  }
  if (resource === 'customers' && rest.length === 1 && rest[0] !== undefined) {
    const tenantId = decodeURIComponent(rest[0])
    if (tenantScope !== undefined && tenantId !== tenantScope) return forbidden()
    if (method === 'GET') return customerDetail(store, tenantId)
    if (method === 'POST') return updateCustomer(store, principal.user, tenantId, request)
  }
  if (resource === 'customers' && rest.length === 2 && rest[0] !== undefined && rest[1] === 'users' && method === 'POST') {
    const tenantId = decodeURIComponent(rest[0])
    if (tenantScope !== undefined && tenantId !== tenantScope) return forbidden()
    return addCustomerUser(store, tenantId, request)
  }
  if (resource === 'customers' && rest.length === 2 && rest[0] !== undefined && rest[1] === 'delete-preview' && method === 'GET') {
    if (tenantScope !== undefined) return forbidden()
    return customerDeletePreview(store, decodeURIComponent(rest[0]))
  }
  if (resource === 'customers' && rest.length === 2 && rest[0] !== undefined && rest[1] === 'delete' && method === 'POST') {
    if (tenantScope !== undefined) return forbidden()
    return customerSoftDelete(store, principal.user, decodeURIComponent(rest[0]), request)
  }
  if (resource === 'audit' && rest.length === 0 && method === 'GET') return auditEvents(store, tenantScope, url)
  if (resource === 'users' && rest.length === 1 && rest[0] !== undefined && method === 'POST') {
    return updateUser(store, principal.user, tenantScope, decodeURIComponent(rest[0]), request)
  }
  if (resource === 'sessions' && rest.length === 0 && method === 'GET') return listSessions(store, tenantScope, url)
  if (resource === 'sessions' && rest.length === 1 && rest[0] === 'revoke-all' && method === 'POST') {
    const revoked = await store.revokeSessions(tenantScope === undefined ? {} : { tenantId: tenantScope })
    return json({ ok: true, revoked })
  }
  if (resource === 'sessions' && rest.length === 1 && rest[0] === 'purge-revoked' && method === 'POST') {
    const removed = await store.purgeRevokedSessions(tenantScope === undefined ? {} : { tenantId: tenantScope })
    return json({ ok: true, removed })
  }
  if (resource === 'sessions' && rest.length === 2 && rest[0] !== undefined && rest[1] === 'revoke' && method === 'POST') {
    return revokeSession(store, tenantScope, decodeURIComponent(rest[0]))
  }
  if (resource === 'support' && rest.length === 0 && method === 'GET') return listSupportRequests(store, tenantScope, url)
  if (resource === 'support' && rest.length === 1 && rest[0] !== undefined && method === 'POST') {
    return updateSupportRequest(store, tenantScope, decodeURIComponent(rest[0]), request)
  }
  if (resource === 'sales' && rest.length === 0 && method === 'GET') return sales(store, tenantScope)
  return notFound()
}

/**
 * Route one member support request from the in-app Need Help control.
 * @param store - tenant identity store.
 * @param request - incoming JSON request.
 * @returns 201 with the new request id, 400 for invalid fields, 401 for an absent session, 404 for other routes.
 */
export async function supportApiResponse(store: TenantAuthStore, request: Request): Promise<Response> {
  const url = new URL(request.url, 'http://localhost')
  if (url.pathname !== '/support/requests' || request.method !== 'POST') return notFound()
  if (!isSameOriginMutation(request)) return forbidden()
  const principal = await authenticate(store, request)
  if (principal === null) return json({ error: 'unauthenticated' }, 401)
  const body = await readBody(request)
  if ('response' in body) return body.response
  const subject = trimmedString(body.value.subject, 1, 200)
  const message = trimmedString(body.value.message, 1, 5000)
  if (subject === null || message === null) return invalidRequest()
  let pageUrl = ''
  if (body.value.pageUrl !== undefined) {
    if (typeof body.value.pageUrl !== 'string') return invalidRequest()
    pageUrl = body.value.pageUrl.trim()
    if (pageUrl.length > 2048) return invalidRequest()
  }
  const created = await store.createSupportRequest({
    tenantId: principal.user.tenantId,
    userId: principal.user.userId,
    subject,
    message,
    pageUrl,
  })
  return json({ requestId: created.requestId }, 201)
}

/** Read the bounded Node request body, answering 413 itself when it is too large. */
async function readNodeBody(request: IncomingMessage, response: ServerResponse): Promise<Buffer | null> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.length
    if (size > MAX_BODY_BYTES) {
      response.writeHead(413, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      response.end(JSON.stringify({ error: 'request_too_large' }))
      return null
    }
    chunks.push(bytes)
  }
  return Buffer.concat(chunks)
}

/** Convert the raw request and its already-read body into the fetch Request surface. */
function nodeToRequest(request: IncomingMessage, body: Buffer): Request {
  const headers = new Headers()
  for (const [name, value] of Object.entries(request.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value)
  }
  const url = new URL(request.url ?? '/admin/api', `http://${request.headers.host ?? 'localhost'}`)
  return new Request(url, {
    method: request.method ?? 'GET',
    headers,
    ...(body.length === 0 ? {} : { body: body.toString('utf8') }),
  })
}

/** Copy the fetch Response onto the Node server response. */
async function writeNodeResponse(response: ServerResponse, result: Response): Promise<void> {
  const headers: Record<string, string> = {}
  result.headers.forEach((value, name) => { headers[name] = value })
  response.writeHead(result.status, headers)
  const body = Buffer.from(await result.arrayBuffer())
  response.end(body.byteLength === 0 ? undefined : body)
}

/**
 * Adapt a Node HTTP request for the `/admin/api/*` router.
 * @param store - tenant identity store.
 * @param request - incoming Node request.
 * @param response - outgoing Node response.
 * @returns when the response has been written.
 */
export async function handleAdminApi(store: TenantAuthStore, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = await readNodeBody(request, response)
  if (body === null) return
  await writeNodeResponse(response, await adminApiResponse(store, nodeToRequest(request, body)))
}

/**
 * Adapt a Node HTTP request for the member support router.
 * @param store - tenant identity store.
 * @param request - incoming Node request.
 * @param response - outgoing Node response.
 * @returns when the response has been written.
 */
export async function handleSupportApi(store: TenantAuthStore, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = await readNodeBody(request, response)
  if (body === null) return
  await writeNodeResponse(response, await supportApiResponse(store, nodeToRequest(request, body)))
}
