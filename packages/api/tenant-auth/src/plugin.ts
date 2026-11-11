import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import { handleNodeAuthRequest } from './http.ts'
import type { TenantAuthStore } from './types.ts'
import { hashPassword } from './password.ts'
import { createPostgresTenantAuthStore } from './pg-client.ts'

/** Cordis configuration for the hosted WiseAI tenant auth routes. */
export interface Config {
  readonly store?: TenantAuthStore
  readonly connectionString?: string
}

/** Mount authentication and admin routes behind the existing Connection trust fence. */
export function apply(ctx: Context, config: Config): void {
  const webServer = ctx.get('webServer') as WebServer | undefined
  const connection = ctx.get('connection') as HostConnectionHandle | undefined
  if (webServer === undefined || connection === undefined) throw new Error('WiseAI tenant auth requires webServer and connection')
  const database = config.store === undefined
    ? createPostgresTenantAuthStore(config.connectionString ?? process.env.DATABASE_URL ?? '')
    : { store: config.store, close: async () => {} }
  const bootstrapEmail = process.env.WISEAI_ADMIN_EMAIL?.trim()
  const bootstrapPassword = process.env.WISEAI_ADMIN_PASSWORD
  if (bootstrapEmail !== undefined && bootstrapPassword !== undefined) {
    void bootstrapAdmin(database.store, bootstrapEmail, bootstrapPassword).catch(error => {
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
      handler: (request: IncomingMessage, response: ServerResponse) => route(request, response, database.store, connection),
    })
    const disposeAdmin = webServer.register({
      kind: 'prefix',
      path: '/admin',
      handler: (request: IncomingMessage, response: ServerResponse) => route(request, response, database.store, connection),
    })
    return async () => { disposeLogin(); dispose(); disposeAdmin(); await database.close() }
  }, 'wiseai-tenant-auth: routes')
}

async function bootstrapAdmin(store: TenantAuthStore, email: string, password: string): Promise<void> {
  if (password.length < 12) throw new Error('WISEAI_ADMIN_PASSWORD must contain at least 12 characters')
  if (await store.findUserByEmail(email) !== null) return
  await store.createAdmin(email, await hashPassword(password))
}

const LOGIN_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WiseAI sign in</title><style>body{font:16px system-ui;max-width:26rem;margin:12vh auto;padding:2rem;background:#101116;color:#f5f5f5}form{display:grid;gap:1rem}input,button{font:inherit;padding:.75rem;border-radius:.5rem;border:1px solid #555}button{background:#7c5cff;color:#fff;cursor:pointer}#error{color:#ff8f8f;min-height:1.5em}</style></head><body><h1>Sign in to WiseAI</h1><form id="form"><label>Email<br><input name="email" type="email" autocomplete="username" required></label><label>Password<br><input name="password" type="password" autocomplete="current-password" required></label><button>Sign in</button><div id="error" role="alert"></div></form><script>const form=document.querySelector('#form'),error=document.querySelector('#error');form.addEventListener('submit',async event=>{event.preventDefault();error.textContent='';const body=Object.fromEntries(new FormData(form));const result=await fetch('/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});if(result.ok)location.href='/';else error.textContent='Unable to sign in with those credentials.'})</script></body></html>`

async function route(
  request: IncomingMessage,
  response: ServerResponse,
  store: TenantAuthStore,
  connection: HostConnectionHandle,
): Promise<void> {
  const rejection = connection.requestRejection(request)
  if (rejection !== undefined && request.url !== '/auth/login' && request.url !== '/auth/signup') {
    response.writeHead(rejection)
    response.end()
    return
  }
  await handleNodeAuthRequest(store, request, response, {
    register: (token, principal) => connection.registerTenantSession(token, principal),
    unregister: token => connection.unregisterTenantSession(token),
  })
}
