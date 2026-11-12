/** Host Workspace Remote owner: explicit commands and reconnect-safe state. */

import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, RemoteError, TypertRemoteService, principalOf } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-api-remote-access'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { WorkspaceCommands } from './commands.ts'
import { DirectoryPickerController } from './directory-picker.ts'
import { WorkspaceFeed, workspaceView } from './feed.ts'
import { defaultWorkspaceDirectory, validateDocumentsDirectory } from './default-directory.ts'
import type {
  WorkspaceArchiveSessionRequest,
  WorkspaceArchiveValue,
  WorkspaceBaseline,
  WorkspaceCreateRequest,
  WorkspaceCreateValue,
  WorkspaceDeleteRequest,
  WorkspaceDeleteValue,
  WorkspaceFollowFrame,
  WorkspaceId,
  WorkspaceInsertBeforeRequest,
  WorkspaceInsertSessionBeforeRequest,
  WorkspaceOrderValue,
  WorkspacePinSessionRequest,
  WorkspacePinValue,
  WorkspaceRenameRequest,
  WorkspaceUnarchiveSessionRequest,
  WorkspaceUnpinSessionRequest,
  WorkspaceValue,
} from './types.ts'

export type * from './types.ts'
export { DirectoryPickerController } from './directory-picker.ts'

/** First-use directory policy for the Host account. */
export interface Config {
  /** Override the system Documents directory with a fully qualified path. */
  documentsDirectory?: string
  /** Maximum duration of the operating system's Documents lookup. */
  documentsLookupTimeoutMs?: number
}

/** Directory policy after schema defaults have been applied. */
type ResolvedConfig = Config & { documentsLookupTimeoutMs: number }

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface PrincipalMap {
    /**
     * Authenticated hosted tenant caller. The Connection transport that admits
     * these peers owns the canonical declaration; the Workspace Controller
     * restates the fields its creation claims read, so its Host program does
     * not depend on a Connection build being present.
     */
    tenant: {
      readonly kind: 'tenant'
      readonly tenantId: string
      readonly userId: string
      readonly role: 'admin' | 'member'
      readonly platformAdmin?: boolean
      readonly email?: string
    }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host Workspace business API and Remote namespace owner. */
    workspaceController: WorkspaceController
  }
}

/** Host service backing the generated `ctx.remote.workspace` namespace. */
export class WorkspaceController extends TypertRemoteService {
  static inject = ['remoteAccess', 'typert', 'workspaceRegistry']

  static Config: z<Config, ResolvedConfig> = z.object({
    documentsDirectory: z.string(),
    documentsLookupTimeoutMs: z.natural().min(1).default(10_000),
  })

  private readonly config: ResolvedConfig
  private readonly commands: WorkspaceCommands
  private readonly feed: WorkspaceFeed

  /**
   * @param ctx - Host context containing the Workspace registry.
   * @param config - first-use directory policy.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'workspaceController', { namespace: 'workspace' })
    ctx.typert.resources.register('workspace', { field: 'workspaceId' })
    this.config = WorkspaceController.Config(config)
    if (this.config.documentsDirectory !== undefined) validateDocumentsDirectory(this.config.documentsDirectory)
    this.commands = new WorkspaceCommands(ctx)
    this.feed = new WorkspaceFeed(ctx)
    // This package is the Loader entry for both Remote owners it hosts: the
    // directory-picking seam is abstract and never an entry itself. The child
    // stays pending until a picking backend is composed, so a host without one
    // registers no picking namespace instead of answering an unservable verb.
    ctx.plugin(DirectoryPickerController)
  }

  /**
   * Create or idempotently resolve one Workspace over an existing directory.
   * @param request - directory path to register.
   * @returns the Workspace and whether this call created it.
   */
  @Remote('create')
  async create(request: WorkspaceCreateRequest): Promise<WorkspaceCreateValue> {
    const principal = principalOf(this.ctx.invocation)
    const paths = this.ctx.get('tenantPaths')
    if (principal?.kind === 'tenant' && paths !== undefined) {
      await paths.ensure(principal.tenantId)
      if (!(await paths.contains(principal.tenantId, request.path))) {
        throw new RemoteError('gateway/bad-request', 'workspace path is confined to the tenant workspace', {})
      }
    }
    const value = await this.commands.create(request)
    if (value.created) await this.claimWorkspaceOwnership(value.workspace.workspaceId)
    return value
  }

  /**
   * Record the caller tenant as owner of a Workspace this call created. The
   * optional service is absent when the deployment does not partition Workspaces.
   * @param workspaceId - the Workspace returned by the successful create.
   */
  private async claimWorkspaceOwnership(workspaceId: WorkspaceId): Promise<void> {
    const principal = principalOf(this.ctx.invocation)
    if (principal?.kind !== 'tenant') return
    await this.ctx.get('workspaceOwnership')?.claimWorkspace(workspaceId, {
      tenantId: principal.tenantId,
      userId: principal.userId,
    })
  }

  /**
   * Initialize or reuse the default Workspace during first-use startup. The
   * directory name is fixed, so the Host never renames or relocates an
   * existing default; its initial title is that same name, which browser
   * consumers label in the reader's language. A tenant caller gets a
   * tenant-private directory below the resolved root, and the created
   * Workspace is claimed for that tenant.
   * @param signal - caller lifetime; cancels native directory lookup.
   * @returns the durable Workspace, or undefined when first-use initialization is ineligible; creates no Session or message.
   */
  @Remote('initializeDefault')
  async initializeDefault(signal: AbortSignal): Promise<WorkspaceValue | undefined> {
    const principal = principalOf(this.ctx.invocation)
    const tenant = principal?.kind === 'tenant' ? principal : undefined
    const workspace = await this.ctx.workspaceRegistry.initializeDefault(async () => {
      const timeout = AbortSignal.timeout(this.config.documentsLookupTimeoutMs)
      const root = await defaultWorkspaceDirectory(
        this.config.documentsDirectory, AbortSignal.any([signal, timeout]),
      )
      return tenant === undefined ? root : join(root, 'tenants', tenant.tenantId)
    })
    if (workspace === undefined) return undefined
    if (tenant !== undefined) await this.ctx.get('tenantPaths')?.ensure(tenant.tenantId)
    await this.claimWorkspaceOwnership(workspace.id)
    return { workspace: workspaceView(workspace) }
  }

  /**
   * Rename one Workspace to a unique non-blank title.
   * @param request - Workspace identity and proposed title.
   * @returns the updated Workspace projection.
   */
  @Remote('rename')
  rename(request: WorkspaceRenameRequest): Promise<WorkspaceValue> {
    return this.commands.rename(request)
  }

  /**
   * Remove one Workspace registration while retaining files and Sessions.
   * @param request - Workspace identity to remove.
   * @returns deletion confirmation.
   */
  @Remote('delete')
  delete(request: WorkspaceDeleteRequest): Promise<WorkspaceDeleteValue> {
    return this.commands.delete(request)
  }

  /**
   * Move one Workspace within the registry display order.
   * @param request - moved Workspace and optional anchor.
   * @returns the complete resulting Workspace order.
   */
  @Remote('insertBefore')
  insertBefore(request: WorkspaceInsertBeforeRequest): Promise<WorkspaceOrderValue> {
    return this.commands.insertBefore(request)
  }

  /**
   * Move one accounted Session within a Workspace.
   * @param request - Workspace, Session, and optional anchor identities.
   * @returns the updated Workspace projection.
   */
  @Remote('insertSessionBefore')
  insertSessionBefore(request: WorkspaceInsertSessionBeforeRequest): Promise<WorkspaceValue> {
    return this.commands.insertSessionBefore(request)
  }

  /**
   * Hide one known Session from Workspace grouping surfaces.
   * @param request - Session identity to archive.
   * @returns the complete resulting archive set.
   */
  @Remote('archiveSession')
  archiveSession(request: WorkspaceArchiveSessionRequest): Promise<WorkspaceArchiveValue> {
    return this.commands.archiveSession(request)
  }

  /**
   * Restore one archived Session to Workspace grouping surfaces.
   * @param request - Session identity to unarchive.
   * @returns the complete resulting archive set.
   */
  @Remote('unarchiveSession')
  unarchiveSession(request: WorkspaceUnarchiveSessionRequest): Promise<WorkspaceArchiveValue> {
    return this.commands.unarchiveSession(request)
  }

  /**
   * Surface one known unarchived Session ahead of unpinned Sessions.
   * @param request - Session identity to pin.
   * @returns the complete resulting pin set, most recently pinned first.
   */
  @Remote('pinSession')
  pinSession(request: WorkspacePinSessionRequest): Promise<WorkspacePinValue> {
    return this.commands.pinSession(request)
  }

  /**
   * Remove one Session's pin without changing its saved Session order.
   * @param request - Session identity to unpin.
   * @returns the complete resulting pin set, most recently pinned first.
   */
  @Remote('unpinSession')
  unpinSession(request: WorkspaceUnpinSessionRequest): Promise<WorkspacePinValue> {
    return this.commands.unpinSession(request)
  }

  /**
   * Stream a complete Workspace baseline followed by ordered increments. A
   * non-owner receives only the Workspaces and Sessions `allows()` admits.
   * When a delivered Workspace is no longer admitted at its next change or
   * the next order change, the stream sends a `replace` frame with the
   * complete filtered state instead of a `remove`, because a Client never
   * resurrects a removed Workspace; a `remove` frame reports a deletion and
   * reaches only a Client that received that Workspace.
   * @param signal - generation cancellation.
   * @returns baseline followed by ordered Workspace increments.
   */
  @Remote({ mode: 'stream' })
  async *follow(signal: AbortSignal): AsyncIterable<WorkspaceFollowFrame> {
    const access = this.ctx.remoteAccess
    const visible = (workspaceId: WorkspaceId): boolean => access.allows({ kind: 'workspace', id: workspaceId })
    const sessions = (sessionIds: readonly SessionId[]): SessionId[] =>
      sessionIds.filter(sessionId => access.allows({ kind: 'session', id: sessionId }))
    /** Workspaces this generation has delivered and not yet removed. */
    const delivered = new Set<WorkspaceId>()
    /** The admitted part of `value`; it becomes the delivered set. */
    const filtered = (value: WorkspaceBaseline): WorkspaceBaseline => {
      const items = value.items.filter(item => visible(item.workspaceId))
      delivered.clear()
      for (const item of items) delivered.add(item.workspaceId)
      return {
        items: items.map(item => ({ ...item, sessionIds: sessions(item.sessionIds) })),
        archivedSessionIds: sessions(value.archivedSessionIds),
        pinnedSessionIds: sessions(value.pinnedSessionIds),
      }
    }
    for await (const frame of this.feed.follow(signal)) {
      switch (frame.type) {
        case 'baseline':
          yield { type: 'baseline', value: filtered(frame.value) }
          break
        case 'upsert': {
          const workspaceId = frame.workspace.workspaceId
          if (visible(workspaceId)) {
            delivered.add(workspaceId)
            yield { type: 'upsert', workspace: { ...frame.workspace, sessionIds: sessions(frame.workspace.sessionIds) } }
          } else if (delivered.has(workspaceId)) {
            yield { type: 'replace', value: filtered(this.feed.baseline()) }
          }
          break
        }
        case 'remove':
          if (delivered.delete(frame.workspaceId)) yield frame
          break
        case 'order':
          if (frame.workspaceIds.some(workspaceId => delivered.has(workspaceId) && !visible(workspaceId))) {
            yield { type: 'replace', value: filtered(this.feed.baseline()) }
          } else {
            yield { type: 'order', workspaceIds: frame.workspaceIds.filter(visible) }
          }
          break
        case 'archived':
          yield { type: 'archived', archivedSessionIds: sessions(frame.archivedSessionIds) }
          break
        case 'pinned':
          yield { type: 'pinned', pinnedSessionIds: sessions(frame.pinnedSessionIds) }
          break
        /* v8 ignore next -- closed follow-frame union. */
        default:
          assertNever(frame)
      }
    }
  }
}

/* v8 ignore next 3 -- closed-union backstop. */
function assertNever(value: never): never {
  throw new Error(`unreachable Workspace follow frame: ${JSON.stringify(value)}`)
}

export default WorkspaceController
