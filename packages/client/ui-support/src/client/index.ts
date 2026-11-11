/**
 * Support plugin, browser half: contributes the sidebar-footer "Need help?"
 * action that files a support request for the signed-in customer, plus the
 * dictionaries the action and its dialog render from.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { SupportButton } from './SupportButton.tsx'
import { TenantAccountActions } from './TenantAccountActions.tsx'
import { WiseBrandMark } from './WiseBrandMark.tsx'
import { en, ja, es, fr, de, ru, pt, NS, zh, type SupportKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Need-help footer action and support-request dialog copy. */
    support: SupportKey
  }
}

export type { SupportButtonProps } from './SupportButton.tsx'

/** Required services: the slot registry and the dictionary registry. */
export const inject = ['slots', 'locale']

/**
 * Client plugin body: register the dictionaries and the footer action.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }), 'ui-support: dictionaries')
  // Hosted WiseAI brand: a W mark in the sidebar header and in the blank-home
  // greeting, replacing the whale artwork.
  ctx.slots.inject('sidebar.brand.mark', () => ctx.slots.register({ name: 'sidebar.brand.mark' }, WiseBrandMark))
  ctx.slots.inject('conversation.hero.brand.mark', () => ctx.slots.register({
    name: 'conversation.hero.brand.mark',
  }, WiseBrandMark))
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'support',
    // Last of the footer actions, directly above the Settings row.
    order: 30,
    locale: NS,
  }, SupportButton))
  // Hosted tenant account menu: Account and Sign out, hidden when the page
  // carries no tenant session.
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'tenant-account',
    order: 40,
    locale: NS,
  }, TenantAccountActions))
}
