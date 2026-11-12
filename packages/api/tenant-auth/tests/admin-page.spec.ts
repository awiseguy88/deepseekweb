import { describe, expect, it } from 'vitest'
import { renderAdminPage } from '../src/admin-page.ts'

// Rendered once: the assertions below read the same document the route serves.
const html = renderAdminPage()

const TABS = ['overview', 'customers', 'users', 'support', 'sessions', 'sales', 'audit', 'usage'] as const

describe('renderAdminPage', () => {
  it('returns one complete self-contained HTML document', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html.endsWith('</html>')).toBe(true)
    expect(html.match(/<html\b/g)).toHaveLength(1)
    expect(html).toContain('<html lang="en">')
    expect(html).toContain('<meta charset="utf-8">')
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">')
    expect(html).toContain('<meta name="color-scheme" content="dark">')
    expect(html).toContain('<title>WiseAI admin</title>')
    expect(html.match(/<style>/g)).toHaveLength(1)
    expect(html.match(/<\/style>/g)).toHaveLength(1)
    expect(html.match(/<script>/g)).toHaveLength(1)
    expect(html.match(/<\/script>/g)).toHaveLength(1)
    expect(html.match(/<body>/g)).toHaveLength(1)
    expect(html).toContain('<main id="main">')
  })

  it('exposes the sections as an accessible tab set', () => {
    expect(html).toContain('role="tablist"')
    expect(html.match(/role="tab"/g)).toHaveLength(TABS.length)
    expect(html.match(/role="tabpanel"/g)).toHaveLength(TABS.length)
    expect(html).toContain('id="audit-events"')
    expect(html).toContain('id="customer-activity"')
    expect(html).toContain('id="usage-table"')
    expect(html).toContain('/admin/api/usage')
    expect(html).toContain('id="billing-events"')
    for (const tab of TABS) {
      expect(html).toContain(`id="tab-${tab}"`)
      expect(html).toContain(`id="panel-${tab}"`)
      expect(html).toContain(`aria-controls="panel-${tab}"`)
      expect(html).toContain(`aria-labelledby="tab-${tab}"`)
    }
    expect(html).toContain('aria-selected="true"')
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain('class="skip"')
  })

  it('ships the dialogs that host every mutation', () => {
    expect(html.match(/<dialog\b/g)).toHaveLength(5)
    for (const id of ['new-customer-dialog', 'customer-dialog', 'add-user-dialog', 'password-dialog', 'support-dialog']) {
      expect(html).toContain(`<dialog id="${id}"`)
    }
    // Every ARIA reference resolves to an element in the same document.
    for (const attribute of ['aria-labelledby', 'aria-controls']) {
      const references = [...html.matchAll(new RegExp(`${attribute}="([^"]+)"`, 'g'))].map(match => match[1])
      expect(references.length).toBeGreaterThan(0)
      for (const reference of references) expect(html).toContain(`id="${reference}"`)
    }
  })

  it('consumes exactly the hosted admin endpoints', () => {
    const paths = [
      '/admin/api/me',
      '/admin/api/overview',
      '/admin/api/customers',
      '/admin/api/customers/',
      '/admin/api/users/',
      '/admin/api/sessions?tenantId=',
      '/admin/api/sessions/',
      '/revoke',
      '/admin/api/support?status=',
      '/admin/api/support/',
      '/admin/api/sales',
      '/auth/logout',
      '/login',
    ]
    for (const path of paths) expect(html).toContain(path)
    expect(html).toContain('encodeURIComponent')
    expect(html).toContain("credentials: 'same-origin'")
    expect(html).toContain('response.status === 401')
    expect(html).toContain("window.location.assign('/login')")
    expect(html).toContain("method: 'POST'")
  })

  it('reads the documented response fields', () => {
    const fields = [
      'activeCustomers',
      'openSupport',
      'activeSessions',
      'tenantId',
      'tenantName',
      'platformAdmin',
      'stripeCustomerId',
      'stripeSubscriptionId',
      'accessUntil',
      'requestId',
      'adminNote',
      'amountTotal',
      'configured',
      'events',
    ]
    for (const field of fields) expect(html).toContain(field)
  })

  it('switches to a tenant workspace view from /admin/api/me', () => {
    // The page asks who it is serving before it renders a view.
    expect(html).toContain('function loadMe()')
    expect(html).toContain("api('/admin/api/me')")
    expect(html).toContain('if (me && !me.platformAdmin) applyTenantAdmin(me);')
    // The tenant view has its own heading and role label.
    expect(html).toContain('Workspace admin — ')
    expect(html).toContain('id="workspace-heading"')
    expect(html).toContain('id="console-role"')
    expect(html).toContain('Platform operator')
    // Tenant administrators keep user management but lose tenant creation,
    // the global customer table, and the platform sales ledger.
    expect(html).toContain('id="tab-users"')
    expect(html).toContain('id="panel-users"')
    expect(html).toContain("$('tab-customers').hidden = true")
    expect(html).toContain("$('panel-customers').hidden = true")
    expect(html).toContain("$('new-customer-open').hidden = true")
    expect(html).toContain("$('tab-sales').hidden = true")
    expect(html).toContain("$('tab-users').hidden = false")
    expect(html).toContain('function renderUsers(users)')
    expect(html).toContain('function loadUsers()')
  })

  it('warns about missing Stripe configuration and links the dashboard', () => {
    for (const variable of ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_ID']) {
      expect(html).toContain(variable)
    }
    expect(html).toContain('https://dashboard.stripe.com/')
  })

  it('renders server data through DOM text APIs instead of markup', () => {
    expect(html).toContain('textContent')
    expect(html).toContain('createElement')
    expect(html).not.toContain('innerHTML')
    expect(html).not.toContain('outerHTML')
    expect(html).not.toContain('insertAdjacentHTML')
    expect(html).not.toContain('document.write')
  })

  it('loads no external assets', () => {
    expect(html).not.toMatch(/<script[^>]+src=/i)
    expect(html).not.toMatch(/<link\b/i)
    expect(html).not.toMatch(/<img\b/i)
    expect(html).not.toMatch(/<iframe\b/i)
    expect(html).not.toMatch(/@import\b/i)
    expect(html).not.toMatch(/url\(\s*['"]?https?:/i)
    expect(html).not.toMatch(/fonts\.googleapis|cdn\.|unpkg\.|jsdelivr/i)
    // The Stripe dashboard link is the only external reference and it is a
    // user-clicked navigation target, not a loaded asset.
    expect(html.match(/https?:\/\/[^\s'")<]+/g)).toEqual(['https://dashboard.stripe.com/'])
  })

  it('is deterministic across renders', () => {
    expect(renderAdminPage()).toBe(html)
    expect(renderAdminPage()).toBe(renderAdminPage())
    expect(html).not.toContain('Math.random')
    expect(html).not.toContain('crypto.getRandomValues')
  })

  it('uses the WiseAI dark theme tokens', () => {
    expect(html).toContain('--bg:#0d0e0d')
    expect(html).toContain('--panel:#131412')
    expect(html).toContain('--accent:#eb6c2c')
    expect(html).toContain('prefers-reduced-motion')
    expect(html).toContain(':focus-visible')
  })
})
