/** Session creation and fork claim the returned Session for a hosted tenant caller. */

import { Context } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionOwnership } from '@deepseek-ai/dsh-session'
import type { PeerId, Principal, RemoteInvocation } from '@deepseek-ai/dsh-typert-protocol'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSessionTestController } from './test-remote.ts'

const TENANT: Principal = { kind: 'tenant', tenantId: 'tenant-a', userId: 'user-a', role: 'member' }
const OWNER: Principal = { kind: 'owner' }
const SOURCE = SessionId('tenant-claim-source')

const owned: Context[] = []
afterEach(async () => {
  await Promise.all(owned.splice(0).map(ctx => ctx.fiber.dispose()))
})

async function harness(ownership: SessionOwnership | undefined) {
  const ctx = new Context()
  owned.push(ctx)
  await ctx.plugin(TypertRegistry)
  await mountAgentLoopTestDependencies(ctx)
  const loop = await mountAgentLoopTestHarness(ctx)
  ctx.provide('workspaceRegistry', {
    get: () => undefined, list: () => [], archivedSessionIds: [],
  } as never)
  if (ownership !== undefined) ctx.provide('sessionOwnership', ownership)
  const controller = await createSessionTestController(ctx, {
    defaultModelSelection: () => ({ provider: 'provider', model: 'model' }),
    cwd: '/tmp',
  })
  /** Invoke `session/<method>` as `principal` through a Gateway-shaped invocation. */
  const as = (principal: Principal, method: string): Context => ctx.extend({
    invocation: {
      request: { namespace: 'session', method, args: {} },
      service: 'sessionController',
      peer: {
        id: 'tenant-claim-peer' as PeerId,
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
  return { ctx, controller, loop, as }
}

/** A source Session with one completed turn, which fork can copy. */
async function completedSource(loop: Awaited<ReturnType<typeof mountAgentLoopTestHarness>>) {
  const source = await loop.create(SOURCE, {}, { cwd: '/tmp' })
  source.session.append('turn/start', { turn: 1 })
  source.session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'source prompt' }], source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  source.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  return source
}

describe('Session ownership claims', () => {
  it('claims a created Session for a tenant caller', async () => {
    const claimSession = vi.fn()
    const { as } = await harness({ claimSession })

    const value = await as(TENANT, 'create').sessionController.create({ cwd: '/tmp' })

    expect(claimSession).toHaveBeenCalledExactlyOnceWith(value.sessionId, {
      tenantId: 'tenant-a',
      userId: 'user-a',
    })
  })

  it('claims a forked Session for a tenant caller', async () => {
    const claimSession = vi.fn()
    const { as, loop } = await harness({ claimSession })
    await completedSource(loop)

    const value = await as(TENANT, 'fork').sessionController.fork({ sessionId: SOURCE })

    expect(claimSession).toHaveBeenCalledExactlyOnceWith(value.sessionId, {
      tenantId: 'tenant-a',
      userId: 'user-a',
    })
  })

  it('records no claim for owner and in-process creation', async () => {
    const claimSession = vi.fn()
    const { controller, as, loop } = await harness({ claimSession })
    await completedSource(loop)

    await as(OWNER, 'create').sessionController.create({ cwd: '/tmp' })
    await controller.create({ cwd: '/tmp' })
    await as(OWNER, 'fork').sessionController.fork({ sessionId: SOURCE })

    expect(claimSession).not.toHaveBeenCalled()
  })

  it('creates and forks without an ownership service', async () => {
    const { as, loop } = await harness(undefined)
    await completedSource(loop)

    const created = await as(TENANT, 'create').sessionController.create({ cwd: '/tmp' })
    const forked = await as(TENANT, 'fork').sessionController.fork({ sessionId: SOURCE })

    expect(typeof created.sessionId).toBe('string')
    expect(typeof forked.sessionId).toBe('string')
  })
})
