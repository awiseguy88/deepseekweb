/**
 * Tenant access: ownership hydration from the store, synchronous claims, the
 * `tenant` remote-access bindings over global/Session/Workspace resources,
 * the broad endpoint action set, and the registration lifecycle.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  createTenantAccess,
  type TenantAccess,
  type TenantAccessBinding,
  type TenantAccessPolicy,
  type TenantCaller,
  type TenantWorkspaceId,
} from '../src/tenant-access.ts'

const TENANT_A: TenantCaller = { kind: 'tenant', tenantId: 'tenant-a', userId: 'user-a', role: 'member' }
const TENANT_B: TenantCaller = { kind: 'tenant', tenantId: 'tenant-b', userId: 'user-b', role: 'admin' }

const sessionId = (id: string): SessionId => id as SessionId
const workspaceId = (id: string): TenantWorkspaceId => id as TenantWorkspaceId

/** One Remote descriptor as this suite's Typert stand-in lists it. */
interface RemoteDescriptor {
  readonly namespace: string
  readonly method: string
}

/** The remote-access service methods tenant access calls, capturing registrations. */
class FakeRemoteAccess {
  readonly policies = new Map<string, TenantAccessPolicy>()
  invalidations = 0

  registerPolicy(kind: string, policy: TenantAccessPolicy): () => void {
    if (this.policies.has(kind)) throw new Error(`duplicate policy ${kind}`)
    this.policies.set(kind, policy)
    return () => { this.policies.delete(kind) }
  }

  invalidate(): void {
    this.invalidations += 1
  }

  bindingsFor(caller: TenantCaller): readonly TenantAccessBinding[] {
    const policy = this.policies.get('tenant')
    if (policy === undefined) throw new Error('no tenant policy registered')
    return policy.bindings(caller)
  }
}

/** The Typert runtime methods tenant access calls, with manual change publication. */
class FakeTypert {
  descriptors: RemoteDescriptor[] = []
  readonly listeners = new Set<() => void>()
  readonly remotes = {
    list: (): readonly RemoteDescriptor[] => this.descriptors,
    subscribe: (listener: () => void): (() => Promise<void>) => {
      this.listeners.add(listener)
      return async () => { this.listeners.delete(listener) }
    },
  }

  publish(descriptors: RemoteDescriptor[]): void {
    this.descriptors = descriptors
    for (const listener of [...this.listeners]) listener()
  }
}

interface SessionOwnerInput {
  readonly sessionId: string
  readonly tenantId: string
  readonly userId: string
}

interface WorkspaceOwnerInput {
  readonly workspaceId: string
  readonly tenantId: string
  readonly userId: string
}

/** Ownership persistence with recorded claims and switchable write failures. */
class FakeStore {
  sessionOwners: SessionOwnerInput[] = []
  workspaceOwners: WorkspaceOwnerInput[] = []
  readonly sessionClaims: SessionOwnerInput[] = []
  readonly workspaceClaims: WorkspaceOwnerInput[] = []
  failSessionClaims = false
  failWorkspaceClaims = false

  async listSessionOwners(): Promise<readonly SessionOwnerInput[]> {
    return this.sessionOwners
  }

  async listWorkspaceOwners(): Promise<readonly WorkspaceOwnerInput[]> {
    return this.workspaceOwners
  }

  async claimSessionOwner(input: SessionOwnerInput): Promise<void> {
    this.sessionClaims.push(input)
    if (this.failSessionClaims) throw new Error('session ownership write failed')
  }

  async claimWorkspaceOwner(input: WorkspaceOwnerInput): Promise<void> {
    this.workspaceClaims.push(input)
    if (this.failWorkspaceClaims) throw new Error('workspace ownership write failed')
  }
}

interface Fixture {
  readonly ctx: Context
  readonly access: TenantAccess
  readonly remote: FakeRemoteAccess
  readonly typert: FakeTypert
  readonly store: FakeStore
}

const roots: Context[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
})

/** A Host Context with the two fake services and a prepared store. */
function fixture(seed: (store: FakeStore) => void = () => {}, allowedActions?: readonly string[]): Fixture {
  const ctx = new Context()
  roots.push(ctx)
  const remote = new FakeRemoteAccess()
  const typert = new FakeTypert()
  typert.descriptors = [{ namespace: 'session', method: 'list' }, { namespace: 'session', method: 'events' }]
  ctx.provide('remoteAccess', remote as never)
  ctx.provide('typert', typert as never)
  const store = new FakeStore()
  seed(store)
  const access = createTenantAccess({ ctx, store: store as never, ...allowedActions === undefined ? {} : { allowedActions } })
  return { ctx, access, remote, typert, store }
}

/** Starting fixture: the access service has hydrated and registered its policy. */
async function started(seed: (store: FakeStore) => void = () => {}, allowedActions?: readonly string[]): Promise<Fixture> {
  const f = fixture(seed, allowedActions)
  await f.access.start()
  return f
}

/** Stable labels for the resources a binding list names, in binding order. */
function resourcesOf(bindings: readonly TenantAccessBinding[]): string[] {
  return bindings.map(({ resource }) => resource.kind === 'global'
    ? 'global'
    : `${resource.kind}:${resource.id}`)
}

/** One binding of a kind; the list always holds at most one per resource. */
function bindingOf(bindings: readonly TenantAccessBinding[], kind: TenantAccessBinding['resource']['kind']): TenantAccessBinding {
  const binding = bindings.find(candidate => candidate.resource.kind === kind)
  if (binding === undefined) throw new Error(`no ${kind} binding`)
  return binding
}

const FORWARDED_EVENTS = [
  'event:api-session/activity',
  'event:api-session/added',
  'event:api-session/error',
  'event:api-session/removed',
  'event:api-session/status',
]

describe('tenant ownership hydration', () => {
  it('hydrates the ownership cache from the persisted lists', async () => {
    const f = await started((store) => {
      store.sessionOwners = [
        { sessionId: 's-a1', tenantId: 'tenant-a', userId: 'user-a' },
        { sessionId: 's-a2', tenantId: 'tenant-a', userId: 'user-a' },
        { sessionId: 's-b1', tenantId: 'tenant-b', userId: 'user-b' },
      ]
      store.workspaceOwners = [
        { workspaceId: 'w-a1', tenantId: 'tenant-a', userId: 'user-a' },
        { workspaceId: 'w-b1', tenantId: 'tenant-b', userId: 'user-b' },
      ]
    })

    expect(resourcesOf(f.remote.bindingsFor(TENANT_A))).toEqual([
      'global', 'session:s-a1', 'session:s-a2', 'workspace:w-a1',
    ])
    expect(resourcesOf(f.remote.bindingsFor(TENANT_B))).toEqual([
      'global', 'session:s-b1', 'workspace:w-b1',
    ])
  })

  it('registers one policy and survives a repeated start', async () => {
    const f = fixture((store) => {
      store.sessionOwners = [{ sessionId: 's-a1', tenantId: 'tenant-a', userId: 'user-a' }]
    })
    await Promise.all([f.access.start(), f.access.start()])
    await f.access.start()

    expect([...f.remote.policies.keys()]).toEqual(['tenant'])
    expect(resourcesOf(f.remote.bindingsFor(TENANT_A))).toEqual(['global', 'session:s-a1'])
  })

  it('reports no policy bindings for a caller without a tenant id', async () => {
    const f = await started()
    expect(f.remote.bindingsFor({ ...TENANT_A, tenantId: '' })).toEqual([])
  })

  it('refuses a store that cannot persist ownership', () => {
    const ctx = new Context()
    roots.push(ctx)
    expect(() => createTenantAccess({ ctx, store: {} as never }))
      .toThrow('does not persist Session and Workspace ownership')
  })

  it('fails loud when the composition mounts no Typert runtime', async () => {
    const ctx = new Context()
    roots.push(ctx)
    const access = createTenantAccess({ ctx, store: new FakeStore() as never })
    await expect(access.start()).rejects.toThrow('mounts no "typert" service')
  })
})

describe('ownership claims', () => {
  it('adds the Session claim to memory, persists it, and invalidates readers', async () => {
    const f = await started()

    await f.access.sessionOwnership.claimSession(sessionId('s-new'), { tenantId: 'tenant-a', userId: 'user-a' })

    expect(resourcesOf(f.remote.bindingsFor(TENANT_A))).toEqual(['global', 'session:s-new'])
    expect(f.store.sessionClaims).toEqual([{ sessionId: 's-new', tenantId: 'tenant-a', userId: 'user-a' }])
    expect(f.remote.invalidations).toBe(1)
  })

  it('adds the Workspace claim to memory, persists it, and invalidates readers', async () => {
    const f = await started()

    await f.access.workspaceOwnership.claimWorkspace(workspaceId('w-new'), { tenantId: 'tenant-a', userId: 'user-a' })

    expect(resourcesOf(f.remote.bindingsFor(TENANT_A))).toEqual(['global', 'workspace:w-new'])
    expect(f.store.workspaceClaims).toEqual([{ workspaceId: 'w-new', tenantId: 'tenant-a', userId: 'user-a' }])
    expect(f.remote.invalidations).toBe(1)
  })

  it('keeps one tenant claim invisible to another tenant', async () => {
    const f = await started()
    await f.access.sessionOwnership.claimSession(sessionId('s-only-a'), { tenantId: 'tenant-a', userId: 'user-a' })
    await f.access.workspaceOwnership.claimWorkspace(workspaceId('w-only-a'), { tenantId: 'tenant-a', userId: 'user-a' })

    expect(resourcesOf(f.remote.bindingsFor(TENANT_B))).toEqual(['global'])
  })

  it('keeps the first claim of a resource and persists it once', async () => {
    const f = await started()
    await f.access.sessionOwnership.claimSession(sessionId('s-one'), { tenantId: 'tenant-a', userId: 'user-a' })
    await f.access.sessionOwnership.claimSession(sessionId('s-one'), { tenantId: 'tenant-b', userId: 'user-b' })
    await f.access.sessionOwnership.claimSession(sessionId('s-one'), { tenantId: 'tenant-a', userId: 'user-a' })

    expect(resourcesOf(f.remote.bindingsFor(TENANT_A))).toEqual(['global', 'session:s-one'])
    expect(resourcesOf(f.remote.bindingsFor(TENANT_B))).toEqual(['global'])
    expect(f.store.sessionClaims).toHaveLength(1)
    expect(f.remote.invalidations).toBe(1)
  })

  it('ignores a claim without a tenant id', async () => {
    const f = await started()
    await f.access.sessionOwnership.claimSession(sessionId('s-orphan'), { tenantId: '', userId: 'user-a' })

    expect(f.store.sessionClaims).toEqual([])
    expect(f.remote.invalidations).toBe(0)
    expect(resourcesOf(f.remote.bindingsFor(TENANT_A))).toEqual(['global'])
  })

  it('rejects a failed persistence and grants no temporary access', async () => {
    const f = await started()
    f.store.failSessionClaims = true

    await expect(f.access.sessionOwnership.claimSession(sessionId('s-unsaved'), { tenantId: 'tenant-a', userId: 'user-a' }))
      .rejects.toThrow('session ownership write failed')

    expect(resourcesOf(f.remote.bindingsFor(TENANT_A))).toEqual(['global'])
    expect(f.remote.invalidations).toBe(0)
  })
})

describe('tenant policy bindings and actions', () => {
  it('binds the global resource and lists every live endpoint plus the forwarded events', async () => {
    const f = await started()
    const bindings = f.remote.bindingsFor(TENANT_A)
    const global = bindingOf(bindings, 'global')

    expect(resourcesOf(bindings)).toEqual(['global'])
    expect(global.role.actions).toEqual(['session/list', 'session/events', ...FORWARDED_EVENTS])
  })

  it('gives the Session and Workspace roles the same action array as the global role', async () => {
    const f = await started((store) => {
      store.sessionOwners = [{ sessionId: 's-a1', tenantId: 'tenant-a', userId: 'user-a' }]
      store.workspaceOwners = [{ workspaceId: 'w-a1', tenantId: 'tenant-a', userId: 'user-a' }]
    })
    const bindings = f.remote.bindingsFor(TENANT_A)
    const actions = bindingOf(bindings, 'global').role.actions

    expect(bindingOf(bindings, 'session').role.actions).toEqual(actions)
    expect(bindingOf(bindings, 'workspace').role.actions).toEqual(actions)
  })

  it('denies endpoints outside the explicit capability allowlist, including later contributions', async () => {
    const f = await started(undefined, ['session/list', 'event:api-session/activity'])
    expect(bindingOf(f.remote.bindingsFor(TENANT_A), 'global').role.actions).toEqual([
      'session/list', 'event:api-session/activity',
    ])

    f.typert.publish([{ namespace: 'secret', method: 'leak' }])
    expect(bindingOf(f.remote.bindingsFor(TENANT_A), 'global').role.actions).not.toContain('secret/leak')
  })

  it('supports exact endpoints and namespace wildcards in the allowlist', async () => {
    const f = await started(undefined, ['session/*', 'event:api-session/status'])
    expect(bindingOf(f.remote.bindingsFor(TENANT_A), 'global').role.actions).toEqual([
      'session/list', 'session/events', 'event:api-session/status',
    ])
  })

  it('refreshes the cached action array when Remote contributions change', async () => {
    const f = await started()
    expect(bindingOf(f.remote.bindingsFor(TENANT_A), 'global').role.actions).not.toContain('workspace/follow')

    f.typert.publish([{ namespace: 'workspace', method: 'follow' }])

    expect(bindingOf(f.remote.bindingsFor(TENANT_A), 'global').role.actions).toEqual([
      'workspace/follow', ...FORWARDED_EVENTS,
    ])
    expect(f.remote.invalidations).toBe(1)
  })
})

describe('tenant access lifecycle', () => {
  it('removes the policy, the subscription, and the ownership services on dispose', async () => {
    const f = await started()
    expect(f.ctx.get('sessionOwnership')).toBeDefined()
    expect(f.ctx.get('workspaceOwnership')).toBeDefined()

    f.access.dispose()
    f.access.dispose()

    expect(f.remote.policies.has('tenant')).toBe(false)
    expect(f.typert.listeners.size).toBe(0)
    expect(f.ctx.get('sessionOwnership')).toBeUndefined()
    expect(f.ctx.get('workspaceOwnership')).toBeUndefined()
  })

  it('stops refreshing actions after dispose', async () => {
    const f = await started()
    f.access.dispose()
    f.typert.publish([{ namespace: 'session', method: 'prompt' }])

    expect(f.remote.invalidations).toBe(0)
  })
})
