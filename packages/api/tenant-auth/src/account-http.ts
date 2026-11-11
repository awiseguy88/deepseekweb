/**
 * Hosted account self-service: profile, password, and tenant billing reads for
 * one signed-in tenant account. Mounted at `/account/api/*` behind the tenant
 * session cookie; the page itself is rendered by {@link renderAccountPage}.
 * @module @deepseek-ai/dsh-api-tenant-auth/account-http
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { TenantAuthStore, TenantUserRecord } from './types.ts'
import { hashPassword, verifyPassword } from './password.ts'
import { resolveTenantAccount } from './admin-http.ts'

/** Largest accepted account request body. */
const MAX_BODY_BYTES = 65_536

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(JSON.stringify(value))
}

/** Convert the raw request into the fetch Request the auth resolver reads. */
function toRequest(request: IncomingMessage): Request {
  const headers = new Headers()
  for (const [name, value] of Object.entries(request.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value)
  }
  return new Request(new URL(request.url ?? '/account', `http://${request.headers.host ?? 'localhost'}`), {
    method: request.method ?? 'GET',
    headers,
  })
}

/** Read one bounded JSON object body. */
async function readJson(request: IncomingMessage): Promise<Readonly<Record<string, unknown>> | null> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.length
    if (size > MAX_BODY_BYTES) return null
    chunks.push(bytes)
  }
  if (chunks.length === 0) return {}
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Readonly<Record<string, unknown>>
      : null
  } catch {
    return null
  }
}

/** One tenant account view returned to the page. */
function meValue(user: TenantUserRecord, tenant: Awaited<ReturnType<TenantAuthStore['findTenantById']>>) {
  return {
    user: { email: user.email, role: user.role, platformAdmin: user.platformAdmin },
    tenant: {
      name: tenant?.name ?? '',
      plan: tenant?.plan ?? 'free',
      status: tenant?.status ?? 'active',
      accessUntil: tenant?.accessUntil ?? null,
    },
  }
}

/**
 * Serve `/account/api/*`: the caller's profile, password change, and email
 * change. Every route derives the account from the session cookie; no route
 * accepts an account id from the body.
 * @param store - tenant identity store.
 * @param request - raw Node request.
 * @param response - raw Node response.
 * @returns when the response has been written.
 */
export async function handleAccountApi(
  store: TenantAuthStore,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const account = await resolveTenantAccount(store, toRequest(request))
  if (account === null) {
    json(response, 401, { error: 'unauthenticated' })
    return
  }
  const path = new URL(request.url ?? '/account/api', `http://${request.headers.host ?? 'localhost'}`).pathname
  if (request.method === 'GET' && path === '/account/api/me') {
    json(response, 200, meValue(account.user, await store.findTenantById(account.user.tenantId)))
    return
  }
  if (request.method === 'POST' && path === '/account/api/password') {
    const body = await readJson(request)
    const current = typeof body?.['currentPassword'] === 'string' ? body['currentPassword'] : ''
    const next = typeof body?.['newPassword'] === 'string' ? body['newPassword'] : ''
    if (current.length === 0 || next.length < 12 || next.length > 1024) {
      json(response, 400, { error: 'invalid_request' })
      return
    }
    const user = await store.findUserById(account.user.userId)
    if (user === null || !(await verifyPassword(current, user.passwordHash))) {
      json(response, 403, { error: 'invalid_credentials' })
      return
    }
    await store.updateAccount(user.userId, { passwordHash: await hashPassword(next) })
    json(response, 200, { ok: true })
    return
  }
  if (request.method === 'POST' && path === '/account/api/email') {
    const body = await readJson(request)
    const password = typeof body?.['password'] === 'string' ? body['password'] : ''
    const email = typeof body?.['email'] === 'string' ? body['email'].trim().toLowerCase() : ''
    if (password.length === 0 || !email.includes('@') || email.length > 320) {
      json(response, 400, { error: 'invalid_request' })
      return
    }
    const user = await store.findUserById(account.user.userId)
    if (user === null || !(await verifyPassword(password, user.passwordHash))) {
      json(response, 403, { error: 'invalid_credentials' })
      return
    }
    const existing = await store.findUserByEmail(email)
    if (existing !== null && existing.userId !== user.userId) {
      json(response, 409, { error: 'conflict' })
      return
    }
    await store.updateAccount(user.userId, { email })
    json(response, 200, { ok: true, email })
    return
  }
  json(response, 404, { error: 'not_found' })
}
