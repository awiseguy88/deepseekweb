import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import z from '@deepseek-ai/schemastery'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import { handleNodeAuthRequest } from './http.ts'
import type { TenantAuthStore } from './types.ts'
import { hashPassword } from './password.ts'
import { createPostgresTenantAuthStore } from './pg-client.ts'
import { handleAdminApi, handleSupportApi, resolveAdmin, resolveTenantAccount } from './admin-http.ts'
import { renderAdminPage } from './admin-page.ts'
import { handleAccountApi } from './account-http.ts'
import { renderAccountPage } from './account-page.ts'
import { parseStripeEvent, stripeConfig, summarizeStripeEvent, verifyStripeSignature } from './stripe.ts'
import { createTenantAccess } from './tenant-access.ts'

/** Cordis configuration for the hosted WiseAI tenant auth routes. */
export interface Config {
  readonly store?: TenantAuthStore
  readonly connectionString?: string
  /**
   * Path of the public marketing document served at `/welcome`. Signed-out
   * document requests are redirected to `/login` instead of rendering it at
   * the application root; a missing file or unset path answers 404.
   */
  readonly landingPage?: string
}

export const name = 'wiseai-tenant-auth'
export const inject = ['webServer', 'connection']
export const Config: z<Config> = z.object({ connectionString: z.string(), landingPage: z.string() })

/** JSON answer with no-store cache semantics for the hosted admin surface. */
function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(JSON.stringify(value))
}

/**
 * Delete customer tenants that exist only for deployment verification (every
 * account on the `@wiseai.example` test domain), so the hosted admin dashboard
 * reports real accounts instead of probe data.
 * @param store - tenant identity store.
 * @returns when the verification tenants are gone or the scan failed.
 */
async function purgeVerificationTenants(store: TenantAuthStore): Promise<void> {
  const tenants = await store.listTenants()
  for (const tenant of tenants) {
    const accounts = await store.listAccounts(tenant.tenantId)
    if (accounts.length === 0) continue
    if (!accounts.every(account => account.email.toLowerCase().endsWith('@wiseai.example'))) continue
    if (await store.deleteTenant(tenant.tenantId)) {
      console.log(`[wiseai-tenant-auth] removed verification tenant ${tenant.tenantId}`)
    }
  }
}

/** Version 4 plugin body: authentication, member support intake, admin UI/API, and Stripe. */
export function apply(ctx: Context, config: Config): void {
  const { webServer, connection } = ctx
  const database = config.store === undefined
    ? createPostgresTenantAuthStore(config.connectionString ?? process.env.DATABASE_URL ?? '')
    : { store: config.store, close: async () => {}, migrate: async () => {} }
  const store = database.store
  const bootstrapEmail = process.env.WISEAI_ADMIN_EMAIL?.trim()
  const bootstrapPassword = process.env.WISEAI_ADMIN_PASSWORD
  // The schema set is idempotent, so every boot converges an existing database
  // and a fresh Railway database to the current columns and tables.
  const migration = database.migrate().catch((error: unknown) => {
    console.error('[wiseai-tenant-auth] schema migration failed:', error)
  })
  // Probe tenants from deployment verification hold no customer data; drop
  // them after the schema settles so dashboards count real accounts.
  ctx.effect(() => {
    const cleanup = migration.then(async () => {
      await purgeVerificationTenants(store)
      await store.purgeRevokedSessions()
    }).catch((error: unknown) => {
      console.error('[wiseai-tenant-auth] verification tenant cleanup failed:', error)
    })
    return () => { void cleanup }
  }, 'wiseai-tenant-auth: verification cleanup')
  // The tenant access policy is inert until the Gateway and Typert services it
  // reads are mounted; start() also publishes the ownership services the
  // Session and Workspace controllers claim through. Start after the schema
  // settles so the ownership tables exist for the first hydration.
  const access = createTenantAccess({ ctx, store })
  ctx.inject(['typert', 'remoteAccess'], () => {
    void migration.then(() => access.start()).catch((error: unknown) => {
      console.error('[wiseai-tenant-auth] tenant access policy failed:', error)
    })
  })
  ctx.effect(() => () => access.dispose(), 'wiseai-tenant-auth: tenant access')
  // The hosted blank home greets the signed-in account; the injected label is
  // empty for an operator Peer without a recorded display name.
  ctx.effect(() => ctx.on('webserver/index-inject', (table, peer) => {
    const principal = peer.principal
    const name = principal.kind === 'tenant'
      ? principal.email === undefined ? '' : principal.email.split('@')[0] ?? ''
      : connection.displayNameOf(peer) ?? ''
    table.push({ kind: 'global', name: '__DSH_TENANT_USER__', value: name })
  }), 'wiseai-tenant-auth: home greeting')
  // The public marketing document is served at the application root; the
  // signed-out gate stays on the application itself after a sign-in attempt.
  const landingPath = config.landingPage === undefined || config.landingPage.trim().length === 0
    ? undefined
    : resolve(config.landingPage)
  let landingCache: Promise<string | undefined> | undefined
  const readLandingPage = async (): Promise<string | undefined> => {
    if (landingPath === undefined) return undefined
    landingCache ??= readFile(landingPath, 'utf8').catch((error: unknown) => {
      console.warn('[wiseai-tenant-auth] landing page is unavailable:', error)
      return undefined
    })
    return await landingCache
  }
  if (bootstrapEmail !== undefined && bootstrapEmail.length > 0) {
    void migration.then(async () => {
      const existing = await store.findUserByEmail(bootstrapEmail)
      if (existing !== null) {
        // Promote an operator provisioned before the platform-admin column
        // existed; the password variable is only needed to create the account.
        await store.updateAccount(existing.userId, { platformAdmin: true })
        return
      }
      if (bootstrapPassword === undefined) {
        console.warn('[wiseai-tenant-auth] WISEAI_ADMIN_EMAIL names no account and WISEAI_ADMIN_PASSWORD is unset; no operator was provisioned')
        return
      }
      await bootstrapAdmin(store, bootstrapEmail, bootstrapPassword)
    }).catch((error: unknown) => {
      console.error('[wiseai-tenant-auth] admin bootstrap failed:', error)
    })
  }
  ctx.effect(() => {
    const disposeLogin = webServer.register({
      kind: 'exact',
      path: '/login',
      handler: (_request, response) => {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        response.end(LOGIN_HTML)
      },
    })
    const dispose = webServer.register({
      kind: 'prefix',
      path: '/auth',
      handler: (request: IncomingMessage, response: ServerResponse) => route(request, response, store, connection),
    })
    const disposeAdmin = webServer.register({
      kind: 'prefix',
      path: '/admin',
      handler: (request: IncomingMessage, response: ServerResponse) => adminRoute(request, response, store, connection),
    })
    const disposeSupport = webServer.register({
      kind: 'prefix',
      path: '/support',
      handler: (request: IncomingMessage, response: ServerResponse) => handleSupportApi(store, request, response),
    })
    const disposeAccount = webServer.register({
      kind: 'exact',
      path: '/account',
      handler: async (request: IncomingMessage, response: ServerResponse) => {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          json(response, 405, { error: 'method_not_allowed' })
          return
        }
        const account = await resolveTenantAccount(store, nodeRequest(request))
        if (account === null) {
          response.writeHead(302, { location: '/login?next=/account', 'cache-control': 'no-store' })
          response.end()
          return
        }
        const html = renderAccountPage()
        response.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'content-length': Buffer.byteLength(html),
        })
        response.end(request.method === 'HEAD' ? undefined : html)
      },
    })
    const disposeAccountApi = webServer.register({
      kind: 'prefix',
      path: '/account/api',
      handler: (request: IncomingMessage, response: ServerResponse) => handleAccountApi(store, request, response),
    })
    const stripe = stripeConfig()
    const disposeStripe = webServer.register({
      kind: 'exact',
      path: '/stripe/webhook',
      handler: (request: IncomingMessage, response: ServerResponse) =>
        stripeWebhook(request, response, stripe, store),
    })
    const disposeWelcome = webServer.register({
      kind: 'exact',
      path: '/welcome',
      handler: async (request: IncomingMessage, response: ServerResponse) => {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          json(response, 405, { error: 'method_not_allowed' })
          return
        }
        const html = await readLandingPage()
        if (html === undefined) {
          response.writeHead(404, { 'cache-control': 'no-store' })
          response.end()
          return
        }
        response.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'content-length': Buffer.byteLength(html),
        })
        response.end(request.method === 'HEAD' ? undefined : html)
      },
    })
    return async () => {
      disposeLogin()
      dispose()
      disposeAdmin()
      disposeSupport()
      disposeAccount()
      disposeAccountApi()
      disposeStripe()
      disposeWelcome()
      await database.close()
    }
  }, 'wiseai-tenant-auth: routes')
}

/**
 * Dispatch the hosted admin prefix: the page, the role-scoped API, and the
 * tenant-scoped endpoints that predate the platform surface. A platform
 * operator sees every tenant; a tenant administrator sees only its own.
 */
async function adminRoute(
  request: IncomingMessage,
  response: ServerResponse,
  store: TenantAuthStore,
  connection: HostConnectionHandle,
): Promise<void> {
  const pathname = new URL(request.url ?? '/admin', `http://${request.headers.host ?? 'localhost'}`).pathname
  if (pathname === '/admin' || pathname === '/admin/') {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      json(response, 405, { error: 'method_not_allowed' })
      return
    }
    const admin = await resolveAdmin(store, nodeRequest(request))
    if (admin === null) {
      response.writeHead(302, { location: '/login?next=/admin', 'cache-control': 'no-store' })
      response.end()
      return
    }
    const html = renderAdminPage()
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(html),
    })
    response.end(request.method === 'HEAD' ? undefined : html)
    return
  }
  if (pathname === '/admin/api' || pathname.startsWith('/admin/api/')) {
    await handleAdminApi(store, request, response)
    return
  }
  // Tenant-scoped routes keep the Connection trust fence and tenant-session auth.
  await route(request, response, store, connection)
}

/**
 * Verify and record one Stripe webhook event. Checkout sessions carry the
 * tenant id in their metadata/client_reference_id; subscription events are
 * joined back through the recorded customer id or the billing email.
 */
async function stripeWebhook(
  request: IncomingMessage,
  response: ServerResponse,
  stripe: ReturnType<typeof stripeConfig>,
  store: TenantAuthStore,
): Promise<void> {
  if (!stripe.configured || stripe.webhookSecret === null) {
    json(response, 503, { error: 'stripe_not_configured' })
    return
  }
  if (request.method !== 'POST') {
    json(response, 405, { error: 'method_not_allowed' })
    return
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.length
    if (size > 1_048_576) {
      json(response, 413, { error: 'request_too_large' })
      return
    }
    chunks.push(bytes)
  }
  const payload = Buffer.concat(chunks).toString('utf8')
  const signature = request.headers['stripe-signature']
  if (!verifyStripeSignature({ payload, signatureHeader: Array.isArray(signature) ? signature[0] ?? null : signature ?? null, secret: stripe.webhookSecret })) {
    json(response, 400, { error: 'invalid_signature' })
    return
  }
  const event = parseStripeEvent(payload)
  if (event === null) {
    json(response, 400, { error: 'invalid_event' })
    return
  }
  const summary = summarizeStripeEvent(event)
  const tenantId = summary.tenantHint.tenantId ?? await tenantForStripeHint(store, summary.tenantHint)
  if (tenantId !== null) {
    await store.updateTenant(tenantId, {
      ...summary.tenantPatch,
      ...summary.tenantHint.customerId === undefined ? {} : { stripeCustomerId: summary.tenantHint.customerId },
      ...summary.tenantHint.subscriptionId === undefined ? {} : { stripeSubscriptionId: summary.tenantHint.subscriptionId },
    })
  }
  await store.recordSalesEvent(tenantId === null ? summary.sales : { ...summary.sales, tenantId })
  json(response, 200, { received: true })
}

/** Resolve the customer tenant recorded for one Stripe event, when possible. */
async function tenantForStripeHint(
  store: TenantAuthStore,
  hint: { readonly email?: string; readonly customerId?: string },
): Promise<string | null> {
  if (hint.email !== undefined) {
    const user = await store.findUserByEmail(hint.email)
    if (user !== null) return user.tenantId
  }
  if (hint.customerId === undefined) return null
  const tenants = await store.listTenants()
  return tenants.find(tenant => tenant.stripeCustomerId === hint.customerId)?.tenantId ?? null
}

/** Convert the raw request into the fetch Request shape shared by the API modules. */
function nodeRequest(request: IncomingMessage): Request {
  const headers = new Headers()
  for (const [name, value] of Object.entries(request.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value)
  }
  return new Request(new URL(request.url ?? '/admin', `http://${request.headers.host ?? 'localhost'}`), {
    method: request.method ?? 'GET',
    headers,
  })
}

async function bootstrapAdmin(store: TenantAuthStore, email: string, password: string): Promise<void> {
  if (password.length < 12) throw new Error('WISEAI_ADMIN_PASSWORD must contain at least 12 characters')
  const existing = await store.findUserByEmail(email)
  if (existing !== null) {
    // Promote an already-created operator without rewriting its password: the
    // bootstrap variables are a one-shot provisioning step, not a reset flow.
    await store.updateAccount(existing.userId, { platformAdmin: true })
    return
  }
  const created = await store.createAdmin(email, await hashPassword(password))
  await store.updateAccount(created.userId, { platformAdmin: true })
  await store.updateTenant(created.tenantId, { name: 'WiseAI Operations' })
}

const LOGIN_HTML = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WiseAI sign in</title><style>body{font:16px system-ui;max-width:26rem;margin:12vh auto;padding:2rem;background:#101116;color:#f5f5f5}form{display:grid;gap:1rem}input,button{font:inherit;padding:.75rem;border-radius:.5rem;border:1px solid #555}button{background:#7c5cff;color:#fff;cursor:pointer}#error{color:#ff8f8f;min-height:1.5em}</style></head><body><h1>Sign in to WiseAI</h1><form id="form"><label>Email<br><input name="email" type="email" autocomplete="username" required></label><label>Password<br><input name="password" type="password" autocomplete="current-password" required></label><button>Sign in</button><div id="error" role="alert"></div></form><script>const form=document.querySelector(\'#form\'),error=document.querySelector(\'#error\');form.addEventListener(\'submit\',async event=>{event.preventDefault();error.textContent=\'\';const body=Object.fromEntries(new FormData(form));const result=await fetch(\'/auth/login\',{method:\'POST\',headers:{\'content-type\':\'application/json\'},body:JSON.stringify(body)});if(result.ok){const next=new URLSearchParams(location.search).get(\'next\');location.href=next&&next.startsWith(\'/\')&&!next.startsWith(\'//\')?next:\'/\'}else error.textContent=\'Unable to sign in with those credentials.\'})</script></body></html>'

async function route(
  request: IncomingMessage,
  response: ServerResponse,
  store: TenantAuthStore,
  connection: HostConnectionHandle,
): Promise<void> {
  const rejection = connection.requestRejection(request)
  const publicRoute = request.url === '/auth/login' || request.url === '/auth/signup'
  if (rejection === 403 || (rejection === 401 && !publicRoute)) {
    response.writeHead(rejection)
    response.end()
    return
  }
  await handleNodeAuthRequest(store, request, response, {
    // A platform operator keeps the main harness: the sign-in becomes the owner
    // Peer. Ordinary accounts stay scoped by the tenant access policy.
    register: (token, principal) => principal.platformAdmin === true
      ? connection.registerOwnerSession(token, principal.email?.split('@')[0])
      : connection.registerTenantSession(token, principal),
    unregister: token => connection.unregisterTenantSession(token),
  })
}
