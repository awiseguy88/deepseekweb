// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { HeroShell } from '../src/client/skeleton/EmptyHero.tsx'
import { en } from '../src/client/locales.ts'

const t = makeTranslate(en)
const renderSlot = (() => null) as never

function headlineOf(account: string | undefined): string {
  if (account === undefined) Reflect.deleteProperty(globalThis, '__DSH_TENANT_USER__')
  else Reflect.set(globalThis, '__DSH_TENANT_USER__', account)
  const view = render(<HeroShell t={t} renderSlot={renderSlot} />)
  const headline = view.container.textContent ?? ''
  view.unmount()
  return headline
}

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(globalThis, '__DSH_TENANT_USER__')
})

describe('hero greeting', () => {
  it('keeps the product headline when no hosted identity is injected', () => {
    expect(headlineOf(undefined)).toContain('Into the Unknown')
  })

  it('greets an operator whose display name is unavailable', () => {
    expect(headlineOf('')).toContain('Welcome back')
    expect(headlineOf('')).not.toContain(',')
  })

  it('greets the signed-in tenant by name', () => {
    expect(headlineOf('alice')).toContain('Welcome back, alice')
  })
})
