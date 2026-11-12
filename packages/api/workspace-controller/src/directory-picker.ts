/**
 * Host directory-picking Remote owner: capability gating, cancellation, and the
 * stable wire failure vocabulary over the `ctx.directoryPicker` seam.
 */

import { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import { DirectoryPickerError } from '@deepseek-ai/dsh-host-directory-picker'
import type {
  DirectoryPickerCapabilities, DirectoryPickerErrorCode,
} from '@deepseek-ai/dsh-host-directory-picker'
// The seam owns the listing declaration; the generator requires the reference
// site to name that package rather than this package's re-export of it.
import type { DirectoryListing } from '@deepseek-ai/dsh-host-directory-picker/types'
import { Remote, RemoteError, TypertRemoteService, principalOf } from '@deepseek-ai/dsh-typert-protocol'
import type { RemoteErrorCode } from '@deepseek-ai/dsh-typert-protocol'

/** The tenant path policy provided by the hosted tenant-auth composition. */
interface TenantPathPolicy {
  root(tenantId: string): string
  ensure(tenantId: string): Promise<string>
  contains(tenantId: string, candidate: string): Promise<boolean>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Absent when the deployment does not partition the filesystem by tenant. */
    tenantPaths?: TenantPathPolicy
  }
}

const createDirectoryRequestSchema = z.object({
  path: z.string(),
  name: z.string(),
}).refine(
  request => request.name.trim() !== '' && request.name !== '.' && request.name !== '..'
    && !/[/\\]/.test(request.name),
  { message: 'host.createDirectory requires a single non-blank path segment name' },
)

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host directory-picking Remote namespace owner. */
    directoryPickerController: DirectoryPickerController
  }
}

/**
 * Host service backing the generated `ctx.remote.directoryPicker` namespace. The
 * seam it exports is abstract and therefore never a Loader entry of its own, so
 * this controller carries the wire verbs: one composed backend serves either the
 * native chooser or the browse primitives, and a verb the composition cannot
 * serve is refused rather than approximated.
 */
export class DirectoryPickerController extends TypertRemoteService {
  static inject = ['directoryPicker']

  /** @param ctx - Host context carrying the composed directory-picking backend. */
  constructor(ctx: Context) {
    super(ctx, 'directoryPickerController', { namespace: 'directoryPicker' })
  }

  /**
   * Open the host's OS chooser for a Remote caller.
   * @param signal - caller lifetime; abort terminates the chooser.
   * @returns the chosen absolute path, or null when the operator cancels.
   */
  @Remote('pick')
  async pick(signal: AbortSignal): Promise<string | null> {
    // The OS chooser can reach the whole host filesystem, so a tenant caller
    // never gets it; the in-app browser is scoped to the tenant root instead.
    if (await this.tenantScope() !== undefined) {
      throw new RemoteError('gateway/bad-request', 'the native directory picker is unavailable for tenant sessions', {})
    }
    if (signal.aborted) throw cancellableFailure(new Error('aborted'), signal, 'directory picker was aborted', 'directory picker failed')
    const capability = this.requireCapability('native', 'pick')
    try {
      return await capability.pick(signal)
    } catch (error: unknown) {
      throw cancellableFailure(error, signal, 'directory picker was aborted', 'directory picker failed')
    }
  }

  /**
   * List one directory level for a Remote caller's in-app browser.
   * @param path - absolute directory to list; absent lists the home directory.
   * @param signal - caller lifetime; abort stops the backend's scan instead of
   *   letting it outlive a disconnected caller.
   * @returns the level's listing with its ancestry.
   */
  @Remote('list')
  async list(path: string | undefined, signal: AbortSignal): Promise<DirectoryListing> {
    const scope = await this.tenantScope()
    if (scope !== undefined) {
      if (path !== undefined && !(await scope.paths.contains(scope.tenantId, path))) {
        throw new RemoteError('gateway/bad-request', 'directory listing is confined to the tenant workspace', {})
      }
      path = path ?? scope.root
    }
    if (signal.aborted) throw cancellableFailure(new Error('aborted'), signal, 'directory listing was aborted')
    const capability = this.requireCapability('browse', 'list')
    try {
      return await capability.list(path, signal)
    } catch (error: unknown) {
      throw cancellableFailure(error, signal, 'directory listing was aborted')
    }
  }

  /**
   * Create one child directory for a Remote caller's in-app browser.
   * @param path - absolute existing parent directory.
   * @param name - single non-blank path segment.
   * @returns the created directory's absolute path.
   */
  @Remote('createDirectory')
  async createDirectory(path: string, name: string): Promise<string> {
    const request = createDirectoryRequestSchema.safeParse({ path, name })
    if (!request.success) {
      throw new RemoteError(
        'gateway/bad-request',
        'invalid payload for host.createDirectory',
        { issues: request.error.issues },
      )
    }
    const scope = await this.tenantScope()
    if (scope !== undefined && !(await scope.paths.contains(scope.tenantId, request.data.path))) {
      throw new RemoteError('gateway/bad-request', 'directory creation is confined to the tenant workspace', {})
    }
    const capability = this.requireCapability('browse', 'createDirectory')
    try {
      return await capability.createDirectory(request.data.path, request.data.name)
    } catch (error: unknown) {
      throw browseFailure(error)
    }
  }

  /** Resolve the caller's tenant confinement, or undefined for non-tenant callers. */
  private async tenantScope(): Promise<{ readonly paths: TenantPathPolicy; readonly tenantId: string; readonly root: string } | undefined> {
    const principal = principalOf(this.ctx.invocation)
    if (principal?.kind !== 'tenant') return undefined
    const paths = this.ctx.get('tenantPaths')
    if (paths === undefined) return undefined
    return { paths, tenantId: principal.tenantId, root: await paths.ensure(principal.tenantId) }
  }

  /** Resolve the capability one wire verb needs, or refuse with the kind this backend serves. */
  private requireCapability<Kind extends keyof DirectoryPickerCapabilities>(
    kind: Kind,
    method: string,
  ): DirectoryPickerCapabilities[Kind] {
    const capability = this.ctx.directoryPicker.capability()
    if (capability.kind !== kind) {
      throw new RemoteError(
        'directory-picker/unavailable',
        `directoryPicker.${method} needs the ${kind} capability; the composed picker serves "${capability.kind}"`,
        { capability: capability.kind },
      )
    }
    return capability as DirectoryPickerCapabilities[Kind]
  }
}

/**
 * Wire code answered for each seam browse failure. The seam's closed codes are
 * its own local vocabulary, so this controller owns the projection onto the
 * `directory-picker/*` codes a Remote caller discriminates on.
 */
const BROWSE_FAILURE_CODES = {
  'directory-unreadable': 'directory-picker/unreadable',
  'directory-exists': 'directory-picker/exists',
  'directory-create-failed': 'directory-picker/create-failed',
} as const satisfies Record<DirectoryPickerErrorCode, RemoteErrorCode>

/**
 * Classify a browse-primitive rejection: the seam's own closed codes carry the
 * path they are about, and anything else stays an infrastructure failure.
 * @param error - the primitive's rejection.
 * @returns the failure to throw across the Remote boundary.
 */
function browseFailure(error: unknown): RemoteError {
  if (error instanceof DirectoryPickerError) {
    return new RemoteError(
      BROWSE_FAILURE_CODES[error.code],
      error.message,
      { path: error.path },
      { cause: error },
    )
  }
  return new RemoteError('gateway/internal', errorMessage(error), {}, { cause: error })
}

/**
 * Classify a cancellable primitive's rejection. An abort is the caller's own
 * timeout or disconnect, not a backend failure, so it answers `gateway/cancelled`
 * before the business classification runs.
 * @param error - the primitive's rejection.
 * @param signal - the caller lifetime the primitive ran under.
 * @param cancelled - operator-facing text for the abort outcome.
 * @param failed - prefix for a non-seam failure, when the verb has no closed codes.
 * @returns the failure to throw across the Remote boundary.
 */
function cancellableFailure(
  error: unknown,
  signal: AbortSignal,
  cancelled: string,
  failed?: string,
): RemoteError {
  if (signal.aborted) return new RemoteError('gateway/cancelled', cancelled, {}, { cause: error })
  if (failed === undefined) return browseFailure(error)
  return new RemoteError('gateway/internal', `${failed}: ${errorMessage(error)}`, {}, { cause: error })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
