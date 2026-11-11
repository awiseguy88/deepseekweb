/**
 * Tenant access control for the hosted WiseAI deployment: Session and
 * Workspace ownership persisted in Postgres and served synchronously from
 * memory, and the one `tenant` Remote access policy whose bindings scope the
 * live Remote action set to the resources that tenant owns.
 *
 * Actions are broad and resources are scoped: every tenant role lists every
 * `${namespace}/${method}` endpoint of the Host plus the forwarded
 * `api-session/*` events, while `bindings()` names only the global resource,
 * the tenant's Sessions, and the tenant's Workspaces. `session/list` and
 * `workspace/follow` filter through `remoteAccess.allows()`, and a
 * Session-scoped call or event passes only while that Session is bound.
 *
 * The Host services this module reads are named by the structural contracts
 * below rather than by imports from their owning packages: `remoteAccess` and
 * the Session and Workspace ownership services do not sit in this package's
 * TypeScript project graph, so `createTenantAccess` reaches the two services
 * through `ctx.get()` after the composition injects them.
 *
 * @module @deepseek-ai/dsh-api-tenant-auth/tenant-access
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TenantAuthStore, TenantOwnershipStore } from './types.ts'

/** A canonical `<namespace>/<method>` Remote endpoint. */
export type TenantAccessEndpoint = `${string}/${string}`

/** A Remote endpoint, or `event:<name>` for one forwarded event. */
export type TenantAccessAction = TenantAccessEndpoint | `event:${string}`

/** The resource kinds a tenant role binds. */
export type TenantAccessResourceKind = 'global' | 'session' | 'workspace'

/** Compile-time identity of a Workspace, matching `WorkspaceId`. */
export type TenantWorkspaceId = Branded<'WorkspaceId'>

/** One resource a tenant binding names. */
export type TenantAccessResource =
  | { readonly kind: 'global' }
  | { readonly kind: 'session'; readonly id: SessionId }
  | { readonly kind: 'workspace'; readonly id: TenantWorkspaceId }

/** One named action set over one resource kind. */
export interface TenantAccessRole<Kind extends TenantAccessResourceKind> {
  /** Name for diagnostics; decisions read only `resource` and `actions`. */
  readonly name: string
  /** The resource kind every binding of this role names. */
  readonly resource: Kind
  /** Actions the role allows on its binding's resource. */
  readonly actions: readonly TenantAccessAction[]
}

/** One role on one resource of the role's kind. */
export type TenantAccessBinding = {
  [Kind in TenantAccessResourceKind]: {
    readonly role: TenantAccessRole<Kind>
    readonly resource: Extract<TenantAccessResource, { readonly kind: Kind }>
  }
}[TenantAccessResourceKind]

/** The authenticated tenant caller this policy serves. */
export interface TenantCaller {
  readonly kind: 'tenant'
  readonly tenantId: string
  readonly userId: string
  readonly role: 'admin' | 'member'
}

/** Business rules for the `tenant` principal kind; every answer reads memory only. */
export interface TenantAccessPolicy {
  /**
   * List the caller's bindings.
   * @param caller - authenticated tenant caller.
   * @returns the global binding plus one binding per resource the tenant owns.
   */
  bindings(caller: TenantCaller): readonly TenantAccessBinding[]
}

/** The Host `remoteAccess` members this module calls. */
export interface TenantAccessRegistrar {
  /**
   * Register the `tenant` policy in the caller's fiber.
   * @param kind - the principal kind the policy serves.
   * @param policy - the tenant bindings.
   * @returns disposer removing the policy.
   */
  registerPolicy(kind: 'tenant', policy: TenantAccessPolicy): () => void
  /** Report that the bindings of some tenant caller may have changed. */
  invalidate(): void
}

/** One Remote contribution as this module reads it. */
export interface TenantAccessRemoteDescriptor {
  readonly namespace: string
  readonly method: string
}

/**
 * One Typert endpoint registry as this module reads it: the Host invocation
 * registry (`local`) carries the descriptors the Gateway dispatches, while a
 * client assembly may additionally contribute consumer-selected remotes.
 */
export interface TenantAccessEndpointRegistry {
  /** @returns a registration-order snapshot of endpoint descriptors. */
  list(): readonly TenantAccessRemoteDescriptor[]
  /**
   * Observe later endpoint changes.
   * @param listener - synchronous observer.
   * @returns disposer for this subscription.
   */
  subscribe(listener: () => void): () => void | Promise<void>
}

/** The Host `typert` members this module calls. */
export interface TenantAccessRuntime {
  /** Host invocation registry; the authoritative endpoint set for dispatch. */
  readonly local?: TenantAccessEndpointRegistry
  /** Consumer-selected Remote contributions, when this composition has any. */
  readonly remotes?: TenantAccessEndpointRegistry
}

/** The tenant and user that own a claimed Session or Workspace. */
export interface TenantAccessOwner {
  readonly tenantId: string
  readonly userId: string
}

/**
 * Records which tenant may see a Session; structurally identical to the
 * Session controller's `SessionOwnership` service.
 */
export interface TenantSessionOwnership {
  /**
   * Record the caller tenant as the Session owner.
   * @param sessionId - the created Session.
   * @param owner - the tenant and user that created it.
   */
  claimSession(sessionId: SessionId, owner: TenantAccessOwner): void
}

/**
 * Records which tenant may see a Workspace; structurally identical to the
 * Workspace controller's `WorkspaceOwnership` service.
 */
export interface TenantWorkspaceOwnership {
  /**
   * Record the caller tenant as the Workspace owner.
   * @param workspaceId - the created Workspace.
   * @param owner - the tenant and user that created it.
   */
  claimWorkspace(workspaceId: TenantWorkspaceId, owner: TenantAccessOwner): void
}

/** Composition input: the Host Context and the ownership persistence. */
export interface TenantAccessOptions {
  readonly ctx: Context
  /** The identity store; it must also implement {@link TenantOwnershipStore}. */
  readonly store: TenantAuthStore
  /**
   * Explicit Remote/event action allowlist (`namespace/method`, `namespace/*`,
   * or `*`). Defaults to the hosted customer surface; setting this is the
   * deployment's capability policy, and unmatched endpoints stay denied.
   */
  readonly allowedActions?: readonly string[]
}

/** Tenant ownership services plus their registration lifecycle. */
export interface TenantAccess {
  /** Session ownership the Session controller claims through. */
  readonly sessionOwnership: TenantSessionOwnership
  /** Workspace ownership the Workspace controller claims through. */
  readonly workspaceOwnership: TenantWorkspaceOwnership
  /** Hydrate the ownership cache, register the `tenant` policy, and provide both ownership services. */
  start(): Promise<void>
  /** Remove the policy and the Remote action subscription. */
  dispose(): void
}

/**
 * Capabilities a hosted tenant peer receives by default: the Remote namespaces
 * the customer web client needs. Any endpoint outside these patterns is denied,
 * so a newly mounted backend plugin cannot widen customer permissions until an
 * operator adds its namespace (WISEAI_TENANT_ACTIONS overrides this list).
 */
const DEFAULT_TENANT_ACTIONS: readonly string[] = [
  'account/*',
  'agentPresets/*',
  'agentTeams/*',
  'commands/*',
  'credentials/*',
  'directoryPicker/*',
  'dynamicCordisRunner/*',
  'event:api-session/*',
  'fileReferences/*',
  'fileUploads/*',
  'goals/*',
  'job/*',
  'llm/*',
  'mcpManager/*',
  'messageFeedback/*',
  'officeToPdf/*',
  'permissionPresets/*',
  'pluginInventory/list',
  'pluginManager/*',
  'pluginRegistryProbe/*',
  'remoteAccess/*',
  'schedule/*',
  'session/*',
  'sessionFeedback/*',
  'sessionReferenceResolver/*',
  'settings/*',
  'skills/*',
  'subagents/*',
  'terminal/*',
  'toolResults/*',
  'userQuestions/*',
  'web/*',
  'workspace/*',
  'workspaceFiles/*',
]

/** Whether one discovered action matches an explicit allowlist pattern (`*` suffix or `*`). */
function matchesAction(action: string, pattern: string): boolean {
  if (pattern === '*') return true
  if (pattern.endsWith('*')) return action.startsWith(pattern.slice(0, -1))
  return action === pattern
}

/** Resolve the configured allowlist from options or the deployment environment. */
function configuredActions(options: TenantAccessOptions): readonly string[] {
  if (options.allowedActions !== undefined) return options.allowedActions
  const configured = process.env.WISEAI_TENANT_ACTIONS?.trim()
  if (configured === undefined || configured.length === 0) return DEFAULT_TENANT_ACTIONS
  return configured.split(',').map(pattern => pattern.trim()).filter(pattern => pattern.length > 0)
}
/** The Session notifications the Gateway forwards to tenant Peers that hold the Session. */
const FORWARDED_EVENT_ACTIONS: readonly TenantAccessAction[] = [
  'event:api-session/activity',
  'event:api-session/added',
  'event:api-session/error',
  'event:api-session/removed',
  'event:api-session/status',
]

/**
 * Read one Host service the composition injected.
 * @param ctx - the Host Context.
 * @param name - service key mounted by the composition.
 * @returns the mounted service.
 * @throws Error when the composition mounted no such service.
 */
function readService(ctx: Context, name: string): unknown {
  const service: unknown = ctx.get(name)
  if (service === undefined) throw new Error(`tenant access: the Host mounts no ${JSON.stringify(name)} service`)
  return service
}

/**
 * Whether the injected store persists Session and Workspace ownership.
 * @param store - the configured identity store.
 * @returns true when every ownership member is implemented.
 */
function isOwnershipStore(store: TenantAuthStore): store is TenantAuthStore & TenantOwnershipStore {
  return store.listSessionOwners !== undefined
    && store.claimSessionOwner !== undefined
    && store.listWorkspaceOwners !== undefined
    && store.claimWorkspaceOwner !== undefined
}

/**
 * Name one Remote descriptor's endpoint.
 * @param descriptor - one Remote contribution.
 * @returns the canonical `<namespace>/<method>` action.
 */
function endpointOf(descriptor: TenantAccessRemoteDescriptor): TenantAccessAction {
  // A template literal expression widens to `string`; the endpoint template is the action's own shape.
  // oxlint-disable-next-line typescript/no-unnecessary-type-assertion -- a template literal expression widens to `string`.
  return `${descriptor.namespace}/${descriptor.method}` as TenantAccessAction
}

/**
 * The action set every tenant role lists: the live Remote endpoints plus the
 * forwarded Session events. The Host `local` registry carries the endpoints
 * the Gateway dispatches; a consumer-selected `remotes` registry may add more.
 * @param runtime - the Host Typert runtime.
 * @returns the current actions.
 */
function currentActions(runtime: TenantAccessRuntime, allowed: readonly string[]): readonly TenantAccessAction[] {
  const endpoints = new Map<string, TenantAccessAction>()
  for (const registry of [runtime.local, runtime.remotes]) {
    if (registry === undefined) continue
    for (const descriptor of registry.list()) endpoints.set(`${descriptor.namespace}/${descriptor.method}`, endpointOf(descriptor))
  }
  const discovered = [...endpoints.values(), ...FORWARDED_EVENT_ACTIONS]
  return discovered.filter(action => allowed.some(pattern => matchesAction(action, pattern)))
}

/**
 * Build the ownership cache and the tenant policy for one Host.
 *
 * The returned service is inert until {@link TenantAccess.start} hydrates the
 * cache and registers the policy. Ownership claims persist first and publish to
 * memory only after the store accepts them; a failed claim rejects and leaves
 * the tenant without access rather than granting temporary ownership.
 * @param options - Host Context and ownership persistence.
 * @returns the ownership services and their lifecycle.
 * @throws Error when the configured store lacks the ownership members.
 */
export function createTenantAccess(options: TenantAccessOptions): TenantAccess {
  const { ctx, store } = options
  const allowedActions = configuredActions(options)
  if (!isOwnershipStore(store)) {
    throw new Error('tenant access: the configured store does not persist Session and Workspace ownership')
  }
  // Narrowed once here so the claim closures and start() read the required members.
  const ownership: TenantOwnershipStore = store
  const sessions = new Map<string, Set<SessionId>>()
  const workspaces = new Map<string, Set<TenantWorkspaceId>>()
  let actions: readonly TenantAccessAction[] = []
  let registrar: TenantAccessRegistrar | undefined
  let removePolicy: (() => void) | undefined
  let unsubscribe: (() => void) | undefined
  const removeOwnershipServices: Array<() => void> = []
  let started = false
  let disposed = false
  let starting: Promise<void> | undefined

  const globalRole: TenantAccessRole<'global'> = {
    name: 'tenant:global',
    resource: 'global',
    get actions(): readonly TenantAccessAction[] { return actions },
  }
  const sessionRole: TenantAccessRole<'session'> = {
    name: 'tenant:session',
    resource: 'session',
    get actions(): readonly TenantAccessAction[] { return actions },
  }
  const workspaceRole: TenantAccessRole<'workspace'> = {
    name: 'tenant:workspace',
    resource: 'workspace',
    get actions(): readonly TenantAccessAction[] { return actions },
  }

  const policy: TenantAccessPolicy = {
    bindings(caller): readonly TenantAccessBinding[] {
      // A caller with no tenant owns nothing; the owner principal never reaches a policy.
      if (caller.tenantId.length === 0) return []
      const bindings: TenantAccessBinding[] = [{ role: globalRole, resource: { kind: 'global' } }]
      const ownedSessions = sessions.get(caller.tenantId)
      if (ownedSessions !== undefined) {
        for (const id of ownedSessions) bindings.push({ role: sessionRole, resource: { kind: 'session', id } })
      }
      const ownedWorkspaces = workspaces.get(caller.tenantId)
      if (ownedWorkspaces !== undefined) {
        for (const id of ownedWorkspaces) bindings.push({ role: workspaceRole, resource: { kind: 'workspace', id } })
      }
      return bindings
    },
  }

  /**
   * Record one ownership claim after its durable write: the first claim of a
   * resource wins, and a failed write rejects without publishing any access.
   */
  async function claim<Id extends string>(
    owners: Map<string, Set<Id>>,
    id: Id,
    owner: TenantAccessOwner,
    persist: () => Promise<void>,
  ): Promise<void> {
    if (owner.tenantId.length === 0) return
    for (const ids of owners.values()) {
      if (ids.has(id)) return
    }
    await persist()
    let ids = owners.get(owner.tenantId)
    if (ids === undefined) {
      ids = new Set<Id>()
      owners.set(owner.tenantId, ids)
    }
    ids.add(id)
    registrar?.invalidate()
  }

  const sessionOwnership: TenantSessionOwnership = {
    claimSession(sessionId, owner): Promise<void> {
      return claim(sessions, sessionId, owner, () => ownership.claimSessionOwner({
        sessionId, tenantId: owner.tenantId, userId: owner.userId,
      }))
    },
  }
  const workspaceOwnership: TenantWorkspaceOwnership = {
    claimWorkspace(workspaceId, owner): Promise<void> {
      return claim(workspaces, workspaceId, owner, () => ownership.claimWorkspaceOwner({
        workspaceId, tenantId: owner.tenantId, userId: owner.userId,
      }))
    },
  }

  /** Hydrate the cache, then publish the policy and ownership services. */
  async function hydrate(): Promise<void> {
    const runtime = readService(ctx, 'typert') as TenantAccessRuntime
    registrar = readService(ctx, 'remoteAccess') as TenantAccessRegistrar
    const refresh = (): void => {
      actions = currentActions(runtime, allowedActions)
      registrar?.invalidate()
    }
    const stops: Array<() => void | Promise<void>> = []
    for (const registry of [runtime.local, runtime.remotes]) {
      if (registry === undefined) continue
      stops.push(registry.subscribe(refresh))
    }
    unsubscribe = () => {
      for (const stop of stops) void stop()
    }
    actions = currentActions(runtime, allowedActions)
    removePolicy = registrar.registerPolicy('tenant', policy)
    // Report the denied surface once per boot so an operator can spot a newly
    // mounted plugin that needs an allowlist entry instead of silent denials.
    const denied = [...(runtime.local?.list() ?? []), ...(runtime.remotes?.list() ?? [])]
      .map(descriptor => `${descriptor.namespace}/${descriptor.method}`)
      .filter(action => !allowedActions.some(pattern => matchesAction(action, pattern)))
    if (denied.length > 0) {
      console.warn(`[wiseai-tenant-auth] tenant capability policy denies ${denied.length} endpoint(s): ${denied.join(', ')}`)
    }
    // The controllers read the ownership services by name, so this factory is
    // also their provider; providing through the fiber disposes them with the
    // composition as well as through dispose().
    removeOwnershipServices.push(
      ctx.provide('sessionOwnership', sessionOwnership),
      ctx.provide('workspaceOwnership', workspaceOwnership),
    )
    started = true
    // Registration above must not wait for the database: a slow or failed
    // ownership read would otherwise refuse every tenant call. A failed
    // hydration keeps the policy live and is reported; new claims still
    // populate memory and the store.
    try {
      const [sessionOwners, workspaceOwners] = await Promise.all([
        ownership.listSessionOwners(),
        ownership.listWorkspaceOwners(),
      ])
      if (disposed) return
      for (const owner of sessionOwners) {
        let ids = sessions.get(owner.tenantId)
        if (ids === undefined) {
          ids = new Set<SessionId>()
          sessions.set(owner.tenantId, ids)
        }
        // The durable store returns the wire identity; Session ids are branded at this boundary.
        ids.add(owner.sessionId as SessionId)
      }
      for (const owner of workspaceOwners) {
        let ids = workspaces.get(owner.tenantId)
        if (ids === undefined) {
          ids = new Set<TenantWorkspaceId>()
          workspaces.set(owner.tenantId, ids)
        }
        ids.add(owner.workspaceId as TenantWorkspaceId)
      }
    } catch (error) {
      console.error('[wiseai-tenant-auth] failed to load tenant resource ownership:', error)
    }
  }

  return {
    sessionOwnership,
    workspaceOwnership,
    start(): Promise<void> {
      if (started || disposed) return Promise.resolve()
      starting ??= hydrate().catch((error: unknown) => {
        // A failed registration may be retried once its services are ready.
        starting = undefined
        throw error
      })
      return starting
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      starting = undefined
      for (const remove of removeOwnershipServices.splice(0)) remove()
      removePolicy?.()
      removePolicy = undefined
      const stop = unsubscribe
      unsubscribe = undefined
      if (stop !== undefined) void stop()
      registrar = undefined
      started = false
      sessions.clear()
      workspaces.clear()
    },
  }
}
