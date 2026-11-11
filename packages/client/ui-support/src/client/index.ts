/**
 * Support plugin, browser half: contributes the sidebar-footer "Need help?"
 * action that files a support request for the signed-in customer, plus the
 * dictionaries the action and its dialog render from.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { SupportButton } from './SupportButton.tsx'
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
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'support',
    // Last of the footer actions, directly above the Settings row.
    order: 30,
    locale: NS,
  }, SupportButton))
}
