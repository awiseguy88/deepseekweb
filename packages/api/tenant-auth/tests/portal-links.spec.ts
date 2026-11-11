import { describe, expect, it } from 'vitest'
import { renderAdminPage } from '../src/admin-page.ts'
import { renderAccountPage } from '../src/account-page.ts'

describe('portal navigation', () => {
  it('offers a signed-in operator a way back to the harness', () => {
    const html = renderAdminPage()
    expect(html).toContain('href="/"')
    expect(html).toContain('Back to harness')
  })

  it('offers a signed-in customer a way back to the harness', () => {
    const html = renderAccountPage()
    expect(html).toContain('href="/"')
    expect(html).toContain('Back to harness')
  })
})
