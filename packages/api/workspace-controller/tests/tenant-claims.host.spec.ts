/** Workspace creation claims the returned Workspace for a hosted tenant caller. */

import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import type { PeerId, Principal, RemoteInvocation } from '@deepseek-ai/dsh-typert-protocol'
import type { WorkspaceOwnership } from '@deepseek-ai/dsh-workspace'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import RemoteAccessService from '@deepseek-ai/dsh-api-remote-access'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WorkspaceController from '../src/index.ts'
import { MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'

const TENANT: Principal = { kind: 'tenant', tenantId: 'tenant-a', userId: 'user-a', role: 'member' }
const OWNER: Principal = { kind: 'owner' }

const roots: Context[] = []
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

async function harness(ownership: WorkspaceOwnership | undefined) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-workspace-claims-')))
  tempDirs.push(root)
  const ctx = new Context()
  roots.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend())
  const storageDomain = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', storageDomain)
  ctx.provide('storageDomain', storageDomain)
  ctx.provide('sessionPersistence', { list: () => Promise.resolve([]) } as never)
  await ctx.plugin(WorkspaceRegistry)
  const dispose = (): void => {}
  ctx.provide('typert', {
    lookups: { configure: () => dispose },
    contexts: { configureHost: () => dispose },
    resources: { register: vi.fn(() => dispose) },
  } as never)
  new RemoteAccessService(ctx)
  if (ownership !== undefined) ctx.provide('workspaceOwnership', ownership)
  const controller = new WorkspaceController(ctx, { documentsDirectory: root })
  /** Invoke `workspace/<method>` as `principal` through a Gateway-shaped invocation. */
  const as = (principal: Principal, method: string): Context => ctx.extend({
    invocation: {
      request: { namespace: 'workspace', method, args: {} },
      service: 'workspaceController',
      peer: {
        id: 'workspace-claim-peer' as PeerId,
        ctx,
        principal,
        interactions: 'answer',
        signal: new AbortController().signal,
        dispose: async () => {},
      },
      signal: new AbortController().signal,
      uplink: <In>(): AsyncIterable<In> => ({
        [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true, value: undefined }) }),
      }),
    } satisfies RemoteInvocation,
  })
  return { ctx, controller, root, as }
}

function stageDir(root: string, name: string): string {
  const path = join(root, name)
  mkdirSync(path, { recursive: true })
  return path
}

describe('Workspace ownership claims', () => {
  it('claims a created Workspace for a tenant caller', async () => {
    const claimWorkspace = vi.fn()
    const { as, root } = await harness({ claimWorkspace })

    const value = await as(TENANT, 'create').workspaceController.create({ path: stageDir(root, 'alpha') })

    expect(value.created).toBe(true)
    expect(claimWorkspace).toHaveBeenCalledExactlyOnceWith(value.workspace.workspaceId, {
      tenantId: 'tenant-a',
      userId: 'user-a',
    })
  })

  it('records no claim for owner and in-process creation', async () => {
    const claimWorkspace = vi.fn()
    const { controller, as, root } = await harness({ claimWorkspace })

    await as(OWNER, 'create').workspaceController.create({ path: stageDir(root, 'owner') })
    await controller.create({ path: stageDir(root, 'in-process') })

    expect(claimWorkspace).not.toHaveBeenCalled()
  })

  it('does not claim an idempotently resolved Workspace', async () => {
    const claimWorkspace = vi.fn()
    const { as, root } = await harness({ claimWorkspace })
    const path = stageDir(root, 'existing')
    await as(OWNER, 'create').workspaceController.create({ path })

    const value = await as(TENANT, 'create').workspaceController.create({ path })

    expect(value.created).toBe(false)
    expect(claimWorkspace).not.toHaveBeenCalled()
  })

  it('creates without an ownership service', async () => {
    const { as, root } = await harness(undefined)
    const path = stageDir(root, 'unclaimed')

    await expect(as(TENANT, 'create').workspaceController.create({ path }))
      .resolves.toMatchObject({ created: true, workspace: { path } })
  })
})
