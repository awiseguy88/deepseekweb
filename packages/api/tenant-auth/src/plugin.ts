import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import { handleNodeAuthRequest } from './http.ts'
import type { TenantAuthStore } from './types.ts'
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
  ctx.effect(() => {
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
    return async () => { dispose(); disposeAdmin(); await database.close() }
  }, 'wiseai-tenant-auth: routes')
}

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
