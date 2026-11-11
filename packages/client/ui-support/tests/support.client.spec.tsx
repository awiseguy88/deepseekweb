// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { SupportButton, type SupportButtonProps } from '../src/client/SupportButton.tsx'
import { en, zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const t: SupportButtonProps['t'] = makeTranslate(zh)

/** Props for one rendered footer action; the locator drives the wide and rail layouts. */
function props(wide = true): SupportButtonProps {
  return { wide, t } as SupportButtonProps
}

/** Click the footer trigger and return it (its focus is restored on close). */
function openDialog(): HTMLElement {
  const trigger = screen.getByRole('button', { name: zh['trigger.label'] })
  fireEvent.click(trigger)
  return trigger
}

/** Fill both required fields with the given drafts. */
function fill(subject: string, message: string): void {
  fireEvent.change(screen.getByPlaceholderText(zh['field.subjectPlaceholder']), { target: { value: subject } })
  fireEvent.change(screen.getByPlaceholderText(zh['field.messagePlaceholder']), { target: { value: message } })
}

/** Stub the global fetch with one fixed HTTP status and return the spy. */
function respond(status: number): ReturnType<typeof vi.fn> {
  const fetchStub = vi.fn(async () => ({ status }) as Response)
  vi.stubGlobal('fetch', fetchStub)
  return fetchStub
}

/** Click the dialog's submit button and settle its async submission. */
async function submit(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: zh['action.submit'] }))
  })
}

describe('SupportButton trigger', () => {
  it('renders the localized label in the wide footer and hides it in the rail', () => {
    const { rerender } = render(<SupportButton {...props()} />)
    const wide = screen.getByRole('button', { name: zh['trigger.label'] })
    expect(wide.textContent).toBe(zh['trigger.label'])
    expect(wide.getAttribute('aria-haspopup')).toBe('dialog')
    expect(wide.getAttribute('aria-expanded')).toBe('false')

    rerender(<SupportButton {...props(false)} />)
    const rail = screen.getByRole('button', { name: zh['trigger.label'] })
    expect(rail.textContent).toBe('')
    expect(rail.querySelector('svg')).not.toBeNull()
  })

  it('renders the English copy when the namespace resolves to English', () => {
    render(<SupportButton {...props()} t={makeTranslate(en)} />)
    expect(screen.getByRole('button', { name: en['trigger.label'] })).toBeDefined()
  })
})

describe('SupportButton dialog', () => {
  it('opens on the trigger, labels the fields, and focuses the subject', () => {
    render(<SupportButton {...props()} />)
    openDialog()
    expect(screen.getByRole('dialog', { name: zh['dialog.title'] })).toBeDefined()
    expect(screen.getByText(zh['dialog.description'])).toBeDefined()
    const subject = screen.getByPlaceholderText(zh['field.subjectPlaceholder'])
    expect(subject.getAttribute('maxlength')).toBe('200')
    expect(screen.getByPlaceholderText(zh['field.messagePlaceholder']).getAttribute('maxlength')).toBe('5000')
    expect(document.activeElement).toBe(subject)
  })

  it('opens from the rail trigger too', () => {
    render(<SupportButton {...props(false)} />)
    openDialog()
    expect(screen.getByRole('dialog', { name: zh['dialog.title'] })).toBeDefined()
  })

  it('closes on Escape and returns focus to the trigger', () => {
    render(<SupportButton {...props()} />)
    const trigger = screen.getByRole('button', { name: zh['trigger.label'] })
    trigger.focus()
    fireEvent.click(trigger)
    expect(screen.getByRole('dialog', { name: zh['dialog.title'] })).toBeDefined()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('closes on a backdrop click', () => {
    render(<SupportButton {...props()} />)
    openDialog()
    const root = document.querySelector('[role="presentation"]')
    const mask = root?.firstElementChild
    if (!(mask instanceof HTMLElement)) throw new Error('the open dialog rendered no mask')
    fireEvent.click(mask)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('cancels without submitting and starts the next dialog empty', () => {
    const fetchStub = respond(201)
    render(<SupportButton {...props()} />)
    openDialog()
    fill('Broken build', 'The build fails on start.')
    fireEvent.click(screen.getByRole('button', { name: zh['action.cancel'] }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(fetchStub).not.toHaveBeenCalled()

    openDialog()
    expect((screen.getByPlaceholderText(zh['field.subjectPlaceholder']) as HTMLInputElement).value).toBe('')
    expect((screen.getByPlaceholderText(zh['field.messagePlaceholder']) as HTMLTextAreaElement).value).toBe('')
  })
})

describe('SupportButton validation', () => {
  it('blocks an empty or partially filled submission', () => {
    const fetchStub = respond(201)
    render(<SupportButton {...props()} />)
    openDialog()
    const button = screen.getByRole('button', { name: zh['action.submit'] })
    expect(button.hasAttribute('disabled')).toBe(true)
    fireEvent.change(screen.getByPlaceholderText(zh['field.subjectPlaceholder']), { target: { value: 'Broken build' } })
    expect(button.hasAttribute('disabled')).toBe(true)
    fireEvent.change(screen.getByPlaceholderText(zh['field.messagePlaceholder']), { target: { value: 'The build fails on start.' } })
    expect(button.hasAttribute('disabled')).toBe(false)
    expect(fetchStub).not.toHaveBeenCalled()
  })

  it('treats whitespace-only drafts as empty', () => {
    render(<SupportButton {...props()} />)
    openDialog()
    fill('   ', '  \n ')
    expect(screen.getByRole('button', { name: zh['action.submit'] }).hasAttribute('disabled')).toBe(true)
  })
})

describe('SupportButton submission', () => {
  it('posts the subject, message, and page URL with credentials and shows the acknowledgement', async () => {
    const fetchStub = respond(201)
    render(<SupportButton {...props()} />)
    openDialog()
    fill('  Broken build  ', '  The build fails on start.  ')
    await submit()

    expect(fetchStub).toHaveBeenCalledTimes(1)
    expect(fetchStub).toHaveBeenCalledWith('/support/requests', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        subject: 'Broken build',
        message: 'The build fails on start.',
        pageUrl: window.location.href,
      }),
    })
    expect(screen.getByRole('status').textContent).toBe(zh['success.message'])
    expect(screen.queryByPlaceholderText(zh['field.subjectPlaceholder'])).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: zh['action.done'] }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows the sign-in message on 401 and keeps the drafts', async () => {
    respond(401)
    render(<SupportButton {...props()} />)
    openDialog()
    fill('Broken build', 'The build fails on start.')
    await submit()

    expect(screen.getByRole('alert').textContent).toBe(zh['error.signIn'])
    expect((screen.getByPlaceholderText(zh['field.subjectPlaceholder']) as HTMLInputElement).value).toBe('Broken build')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it.each([400, 500, 503])('shows the generic failure on status %i', async (status) => {
    respond(status)
    render(<SupportButton {...props()} />)
    openDialog()
    fill('Broken build', 'The build fails on start.')
    await submit()
    expect(screen.getByRole('alert').textContent).toBe(zh['error.failed'])
  })

  it('reports a network failure without leaving the dialog busy', async () => {
    const fetchStub = vi.fn(async () => { throw new Error('offline') })
    vi.stubGlobal('fetch', fetchStub)
    render(<SupportButton {...props()} />)
    openDialog()
    fill('Broken build', 'The build fails on start.')
    await submit()
    expect(screen.getByRole('alert').textContent).toBe(zh['error.failed'])
    expect(screen.getByRole('button', { name: zh['action.submit'] }).hasAttribute('disabled')).toBe(false)
  })

  it('disables every control while the request is in flight', async () => {
    let settle!: (response: { status: number }) => void
    const pending = new Promise<{ status: number }>((resolve) => { settle = resolve })
    vi.stubGlobal('fetch', vi.fn(() => pending))
    render(<SupportButton {...props()} />)
    openDialog()
    fill('Broken build', 'The build fails on start.')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: zh['action.submit'] }))
    })
    expect(screen.getByRole('button', { name: zh['action.sending'] }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: zh['action.cancel'] }).hasAttribute('disabled')).toBe(true)
    await act(async () => { settle({ status: 201 }) })
    expect(screen.getByRole('status').textContent).toBe(zh['success.message'])
  })
})
