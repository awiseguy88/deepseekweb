/**
 * @deepseek-ai/dsh-host-frontend-static — SPA dist server over the webserver
 * fallback seat: a webserver resource serving the built frontend directory
 * with explicit index entry points. A readable index renders at the dist root
 * and configured index path; missing paths return 404, traversal outside the
 * dist root is 403, unknown extensions ship as octet-stream, and non-GET/HEAD
 * is 405. An HTTP index request first passes Connection's browser
 * authentication and renders for the browser Peer; an in-process read renders
 * for the Peer its caller admitted. Both renders go through the webserver's
 * index render (structured injection rows, then raw taps). Non-index assets
 * stay public; every file other than the index carries a weak ETag with
 * `cache-control: no-cache` and answers a matching `If-None-Match` with 304,
 * while the index carries no cache headers. The dist location is workspace
 * knowledge of the composing application, so `distIndex` is typically
 * supplied through a `!!js` expression, never hardcoded by a deployment.
 * @module @deepseek-ai/dsh-host-frontend-static
 */

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, extname, join, normalize, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { PeerScope } from '@deepseek-ai/dsh-typert-protocol'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'

/** Stable Cordis plugin name. */
export const name = 'frontend-static'

/** Services required before the authenticated fallback seat can be claimed. */
export const inject = ['webServer', 'connection']

/** Plugin config: the dist anchor and the optional public landing document. */
export interface Config {
  /** Absolute path of index.html inside the dist root. */
  distIndex: string
  /**
   * Absolute path of a public marketing document served for unauthenticated
   * index requests. Hosted deployments use it as the sign-out home page; the
   * authorized application index stays the only content behind auth.
   */
  landingPage?: string
}

export const Config: z<Config> = z.object({
  distIndex: z.string().required(),
  landingPage: z.string(),
})

const HTML_MIME = 'text/html; charset=utf-8'

const MIME: Record<string, string> = {
  '.html': HTML_MIME,
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  // Launchers require an image Content-Type for the install icons.
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.map': 'application/json',
  '.webmanifest': 'application/manifest+json',
  // The packed VFS image. Served as its own bytes, never as a Content-Encoding:
  // the worker inflates the body itself, and a transport-level encoding would
  // leave it inflating an already-decoded archive.
  '.gz': 'application/gzip',
}

const STATIC_MISS_CODES: ReadonlySet<string | undefined> = new Set([
  'ENOENT',
  'EISDIR',
  'ENOTDIR',
])

/** Paths that name the application document rather than an ordinary asset. */
function isDocumentPath(pathname: string): boolean {
  return pathname === '/' || pathname === '/index.html'
}

/** The public landing document answer; like the index it is never cached. */
function landingResponse(html: string, method: string): Response {
  const headers = { 'content-type': HTML_MIME, 'cache-control': 'no-store' }
  return method === 'HEAD' ? new Response(null, { status: 200, headers }) : new Response(html, { status: 200, headers })
}

/** A Response body that is `bytes` itself, without the copy a buffer body gets. */
function bytesBody(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
}

/**
 * Answer one GET or HEAD dist request; the webserver answers any other method
 * with 405 before a resource runs. A malformed percent-escape or a filesystem
 * failure other than a missing or non-file target rejects.
 * @param request - the request; only its method and URL path are read.
 * @param distRoot - absolute dist root directory (resolved by the caller).
 * @param distIndex - absolute path of index.html inside distRoot.
 * @param authorizeIndex - answers an index request before its bytes are read:
 * the response to send instead of the index, or undefined to serve it.
 * @param renderIndex - turns the raw index.html body into the served document
 * for the dist root and configured index path.
 * @param readLandingPage - resolves the public landing document to serve
 * instead of the unauthorised index response; undefined keeps the refusal.
 * @returns the dist response; a HEAD response carries the GET status and
 * headers without a body. A file other than the index carries
 * `cache-control: no-cache` and a weak ETag from a SHA-1 of its bytes, and a
 * request whose `If-None-Match` equals that ETag receives an empty 304.
 */
async function serveStatic(
  request: Request, distRoot: string, distIndex: string,
  authorizeIndex: () => Response | PeerScope | undefined,
  renderIndex: (html: string, admittedPeer?: PeerScope) => string,
  readLandingPage?: () => Promise<string | undefined>,
): Promise<Response> {
  const pathname = new URL(request.url).pathname
  const target = resolve(normalize(join(distRoot, decodeURIComponent(pathname))))
  // Traversal rejection: the target must be distRoot itself (`/`) or stay under
  // it. `sep`, not '/': resolve() emits backslash paths on Windows, where a '/'
  // suffix would reject every legitimate subpath as traversal.
  if (target !== distRoot && !target.startsWith(distRoot + sep)) return new Response(null, { status: 403 })
  let body: string | Uint8Array<ArrayBuffer>
  let headers: Record<string, string>
  try {
    if (target === distRoot || target === distIndex) {
      const admission = authorizeIndex()
      if (admission instanceof Response) {
        // The signed-out home page is the deployment's public landing document;
        // every other index refusal (and every non-document path) still uses
        // Connection's authenticated-index contract.
        if (admission.status === 401 && readLandingPage !== undefined && isDocumentPath(pathname)) {
          const landing = await readLandingPage()
          if (landing !== undefined) return landingResponse(landing, request.method)
        }
        return admission
      }
      const admittedPeer = admission
      body = renderIndex(await readFile(distIndex, 'utf8'), admittedPeer)
      headers = { 'content-type': HTML_MIME }
    } else {
      body = await readFile(target)
      // Weak: gzip changes the transferred bytes.
      const cache = { 'cache-control': 'no-cache', etag: `W/"${createHash('sha1').update(body).digest('base64url')}"` }
      if (request.headers.get('if-none-match') === cache.etag) return new Response(null, { status: 304, headers: cache })
      headers = { 'content-type': MIME[extname(target)] ?? 'application/octet-stream', ...cache }
    }
  } catch (error) {
    // Only absent or non-file targets are 404; other filesystem failures reach
    // the caller, which the webserver answers with 400 over HTTP.
    if (!STATIC_MISS_CODES.has((error as NodeJS.ErrnoException).code)) throw error
    return new Response(null, { status: 404 })
  }
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers })
  return new Response(typeof body === 'string' ? body : bytesBody(body), { status: 200, headers })
}

/**
 * Claim the webserver fallback seat with a resource serving the dist.
 * @param ctx - plugin context carrying the webServer and connection services.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  const distIndex = config.distIndex
  const distRoot = dirname(distIndex)
  const landingPath = config.landingPage === undefined || config.landingPage.trim().length === 0
    ? undefined
    : resolve(config.landingPage)
  // Read once per process: the landing document is deployment content, and a
  // missing file degrades to the authenticated-index refusal rather than a 500.
  let landingCache: Promise<string | undefined> | undefined
  const readLandingPage = landingPath === undefined ? undefined : (): Promise<string | undefined> =>
    landingCache ??= readFile(landingPath, 'utf8').catch((error: unknown) => {
      if (!STATIC_MISS_CODES.has((error as NodeJS.ErrnoException).code)) throw error
      return undefined
    })
  // Connection's browser authentication writes the token exchange's 303 or
  // the 401 through a writeHead/end response; capture it as a Fetch response.
  // The answer stays a 401 unless Connection writes another one.
  const authorizeIndex = (request: Request): Response | PeerScope | undefined => {
    let status = 401
    let headers = new Headers()
    let body: string | undefined
    const admittedPeer = ctx.connection.peerForIndex(request)
    if (admittedPeer !== undefined) return admittedPeer
    const admitted = ctx.connection.authorizeIndex(request, {
      writeHead(nextStatus, nextHeaders) {
        status = nextStatus
        headers = new Headers(nextHeaders)
      },
      end(text) { body = text },
    })
    return admitted ? undefined : new Response(body, { status, headers })
  }
  ctx.effect(() => ctx.webServer.registerFallback({
    resource: (request, peer) => serveStatic(
      request,
      distRoot,
      distIndex,
      // A read with a Peer was admitted by its caller; an HTTP request carries
      // none and passes Connection's browser authentication instead.
      () => peer === undefined ? authorizeIndex(request) : undefined,
      // The browser authentication admits the owner's or tenant's Peer. The
      // base goes in after all index transforms, so it precedes every resource
      // reference they insert.
      (html, admittedPeer) => ctx.webServer.renderIndex(html, peer ?? admittedPeer ?? ctx.connection.browserPeer)
        .replace(/<head(?:\s[^>]*)?>/i, open => `${open}<base href="./">`),
      readLandingPage,
    ),
  }), 'frontend-static: fallback seat')
}
