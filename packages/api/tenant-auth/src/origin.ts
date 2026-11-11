/**
 * Origin fence for cookie-authenticated mutations. A browser sends Origin on
 * non-GET requests; a cross-site page therefore cannot drive admin, support,
 * account, or sign-out endpoints with the session cookie. Requests without
 * Origin/Referer (CLI clients, same-origin form posts without CORS) pass.
 * @module @deepseek-ai/dsh-api-tenant-auth/origin
 */

/**
 * Whether one cookie-authenticated request may mutate state.
 * @param request - incoming JSON request.
 * @returns true for safe methods, same-authority browser requests, and clients
 * that sent neither Origin nor Referer.
 */
export function isSameOriginMutation(request: Request): boolean {
  if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') return true
  const source = request.headers.get('origin') ?? request.headers.get('referer')
  if (source === null) return true
  try {
    // The request URL is constructed from the Host header by both adapters, so
    // comparing authorities blocks cross-site origins without trusting a proxy.
    return new URL(source).host === new URL(request.url).host
  } catch {
    return false
  }
}
