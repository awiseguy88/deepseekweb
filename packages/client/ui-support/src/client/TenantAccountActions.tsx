/**
 * Sidebar-footer account menu for the hosted deployment: Account opens the
 * account page and Sign out ends the tenant session. The group renders only
 * when `/auth/me` answers with a tenant session.
 * @module @deepseek-ai/dsh-client-ui-support/client/TenantAccountActions
 */
import { useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'
import css from './SupportButton.module.css'

/** Footer action props for the hosted account controls. */
export type TenantAccountActionsProps = PropsRuntime<'sidebar.footer.action'> & PropsLocale<typeof NS>

/**
 * Render the account and sign-out footer buttons for a signed-in tenant.
 * @param props - the sidebar column state and the namespace translator.
 * @returns the footer actions, or null while signed out.
 */
export function TenantAccountActions({ wide, t }: TenantAccountActionsProps) {
  const [signedIn, setSignedIn] = useState<boolean | undefined>(undefined)

  useEffect(() => {
    let live = true
    void fetch('/auth/me', { credentials: 'include' }).then(
      (response) => { if (live) setSignedIn(response.ok) },
      () => { if (live) setSignedIn(false) },
    )
    return () => { live = false }
  }, [])

  if (signedIn !== true) return null
  const label = (key: 'account.label' | 'account.signOut'): string => t(key)
  return (
    <div className={wide ? css.tenantActions : `${css.tenantActions} ${css.tenantActionsRail}`}>
      <button type="button" className={css.tenantButton} onClick={() => { window.location.assign('/account') }}>
        {label('account.label')}
      </button>
      <button
        type="button"
        className={css.tenantButton}
        onClick={() => {
          void fetch('/auth/logout', { method: 'POST', credentials: 'include' }).finally(() => { window.location.assign('/login') })
        }}
      >
        {label('account.signOut')}
      </button>
    </div>
  )
}
