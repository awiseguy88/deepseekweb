/**
 * ui-support plugin halves: the browser entry's dictionaries and footer-action
 * registration against the real SlotRegistry (with fiber teardown proving
 * removal — HMR safety), and the inert node entry.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as applyLocale, inject as localeInject } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'
import { apply as applyNode } from '../src/index.ts'
import { en, NS, zh } from '../src/client/locales.ts'

/** Slot ledger reader: entry ids currently registered in the footer action list. */
function footerEntryIds(ctx: Context): (string | undefined)[] {
  return ctx.slots.entries('sidebar.footer.action').map(entry => entry.options.id)
}

/** Boot the browser half over a real slot tree that declares the footer action list. */
async function bench(): Promise<{ ctx: Context; fiber: ReturnType<Context['plugin']> }> {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: {
      'sidebar.footer.action': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
  ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
  ctx.provide('remote', { $on: () => () => {} } as never)
  ctx.provide('configForms', {
    developerTools: { getSnapshot: () => true, subscribe: () => () => {} },
    get: () => stubConfigForm().scope,
  } as never)
  await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
  // The spec asserts the shipped Chinese copy; this lane has no `window`, so
  // browser-language detection never runs and the fallback locale is English.
  ctx.locale.setLocale('zh')
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, fiber }
}

describe('ui-support browser half', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['slots', 'locale'])
  })

  it('registers the footer action, and fiber teardown removes it (HMR safety)', async () => {
    const { ctx, fiber } = await bench()
    expect(footerEntryIds(ctx)).toContain('support')
    await fiber.dispose()
    expect(footerEntryIds(ctx)).not.toContain('support')
  })

  it('registers both dictionaries under its own namespace and releases them with the fiber', async () => {
    const { ctx, fiber } = await bench()
    const translate = ctx.locale.bind(NS)
    expect(translate('trigger.label')).toBe(zh['trigger.label'])
    ctx.locale.setLocale('en')
    expect(translate('trigger.label')).toBe(en['trigger.label'])

    // Withdrawn dictionaries leave the key unresolved rather than translated.
    await fiber.dispose()
    expect(translate('trigger.label')).not.toBe(en['trigger.label'])
  })

  it('keeps the English dictionary key-identical to the Chinese source of truth', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })
})

describe('ui-support node half', () => {
  it('contributes no host behavior', () => {
    // The node half exists only so the plugin appears in the Loader tree.
    expect(applyNode).not.toThrow()
  })
})
