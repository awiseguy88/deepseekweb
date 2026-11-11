import { hashPassword, verifyPassword } from './password.ts'
import { issueSession, logoutSession, resolveSession } from './session-tokens.ts'
import type { TenantAuthStore } from './types.ts'

const COOKIE = 'wiseai_session'
const SESSION_DAYS = 14

function cookieValue(request: Request): string | undefined {
  const value = request.headers.get('cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`))
  return value === undefined ? undefined : decodeURIComponent(value.slice(COOKIE.length + 1))
}

function json(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), { ...init, headers: { 'content-type': 'application/json; charset=utf-8', ...init.headers } })
}

/** HTTP auth surface for composition into a host WebServer route. */
export function tenantAuthHandler(store: TenantAuthStore, request: Request): Promise<Response> {
  return handle(store, request)
}

async function handle(store: TenantAuthStore, request: Request): Promise<Response> {
  const path = new URL(request.url).pathname
  if (path === '/auth/login' && request.method === 'POST') {
    const body = await request.json().catch(() => null) as { email?: unknown; password?: unknown } | null
    if (typeof body?.email !== 'string' || typeof body.password !== 'string') return json({ error: 'invalid_credentials' }, { status: 400 })
    const user = await store.findUserByEmail(body.email.trim())
    if (user === null || user.disabled || !(await verifyPassword(body.password, user.passwordHash))) return json({ error: 'invalid_credentials' }, { status: 401 })
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000)
    const token = await issueSession(store, user, expiresAt)
    const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : ''
    return json({ user: { userId: user.userId, email: user.email, role: user.role, tenantId: user.tenantId } }, {
      headers: { 'set-cookie': `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=${SESSION_DAYS * 86_400}` },
    })
  }
  const token = cookieValue(request)
  const session = token === undefined ? null : await resolveSession(store, token)
  if (path === '/auth/logout' && request.method === 'POST') {
    if (token !== undefined) await logoutSession(store, token)
    return json({ ok: true }, { headers: { 'set-cookie': `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` } })
  }
  if (path === '/auth/me' && request.method === 'GET') return session === null ? json({ user: null }, { status: 401 }) : json(session)
  if (path === '/admin/users' && request.method === 'GET') {
    const actor = session === null ? null : await store.findUserById(session.userId)
    if (actor === null || actor.role !== 'admin' || actor.disabled || actor.tenantId !== session?.tenantId) return json({ error: 'forbidden' }, { status: 403 })
    const users = await store.listUsers(actor.tenantId)
    return json(users.map(user => ({ userId: user.userId, email: user.email, role: user.role, disabled: user.disabled })))
  }
  if (path === '/admin/users/disable' && request.method === 'POST') {
    const actor = session === null ? null : await store.findUserById(session.userId)
    if (actor === null || actor.role !== 'admin' || actor.disabled || actor.tenantId !== session?.tenantId) return json({ error: 'forbidden' }, { status: 403 })
    const body = await request.json().catch(() => null) as { userId?: unknown; disabled?: unknown } | null
    if (typeof body?.userId !== 'string' || typeof body.disabled !== 'boolean' || body.userId === actor.userId) return json({ error: 'invalid_request' }, { status: 400 })
    await store.setUserDisabled(actor.tenantId, body.userId, body.disabled)
    return json({ ok: true })
  }
  if (path === '/auth/signup' && request.method === 'POST') {
    const body = await request.json().catch(() => null) as { email?: unknown; password?: unknown } | null
    if (typeof body?.email !== 'string' || typeof body.password !== 'string' || body.email.length > 320 || body.password.length < 12) return json({ error: 'invalid_signup' }, { status: 400 })
    const created = await store.createMember(body.email.trim(), await hashPassword(body.password))
    return json(created, { status: 201 })
  }
  return json({ error: 'not_found' }, { status: 404 })
}
