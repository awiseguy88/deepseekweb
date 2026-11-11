// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { TenantAccountActions, type TenantAccountActionsProps } from '../src/client/TenantAccountActions.tsx'
import { en, zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const t = makeTranslate(en)
const props = (wide = true): TenantAccountActionsProps => ({ wide, t }) as TenantAccountActionsProps

function respond(status: number): ReturnType<typeof vi.fn> {
  const fetchStub = vi.fn(async () => ({ ok: status === 200, status }) as Response)
  vi.stubGlobal('fetch', fetchStub)
  return fetchStub
}

describe('TenantAccountActions', () => {
  it('renders account and sign-out entries for a signed-in tenant', async () => {
    const fetchStub = respond(200)
    render(<TenantAccountActions {...props()} />)
    expect(await screen.findByRole('button', { name: en['account.label'] })).toBeDefined()
    expect(screen.getByRole('button', { name: en['account.signOut'] })).toBeDefined()
    expect(fetchStub).toHaveBeenCalledWith('/auth/me', { credentials: 'include' })
  })

  it('renders nothing without a tenant session', async () => {
    respond(401)
    render(<TenantAccountActions {...props(false)} />)
    await vi.waitFor(() => { expect(screen.queryByRole('button')).toBeNull() })
  })

  it('signs out through the auth route', async () => {
    const fetchStub = respond(200)
    render(<TenantAccountActions {...props()} />)
    fireEvent.click(await screen.findByRole('button', { name: en['account.signOut'] }))
    expect(fetchStub).toHaveBeenCalledWith('/auth/logout', { method: 'POST', credentials: 'include' })
  })

  it('keeps the local copy in the Chinese dictionary', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
    expect(zh['account.label']).not.toBe(en['account.label'])
  })
})
