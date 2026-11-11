/**
 * The sidebar-footer "Need help?" action and its support-request dialog.
 * @module @deepseek-ai/dsh-client-ui-support/client/SupportButton
 */
import { useEffect, useRef, useState } from 'react'
import { Button, IconQuestionOutlineRegular, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'
import css from './SupportButton.module.css'

/** Longest subject the support endpoint accepts. */
const SUBJECT_MAX = 200

/** Longest message the support endpoint accepts. */
const MESSAGE_MAX = 5_000

/** Full props for the sidebar footer action: the column state and the locale seat. */
export type SupportButtonProps = PropsRuntime<'sidebar.footer.action'> & PropsLocale<typeof NS>

/** Why the last submission attempt showed an error, or `null` while no error shows. */
type Failure = 'signIn' | 'failed' | null

/**
 * The dialog's visible phase. `sent` replaces the form with the acknowledgement
 * and keeps the request body out of the DOM.
 */
type Phase = 'editing' | 'sending' | 'sent'

/**
 * Sidebar-footer entry point: a compact "Need help?" control that opens a
 * subject/message dialog and files the request at `POST /support/requests`.
 * The dialog closes on Escape or a backdrop click, blocks closing while a
 * submission is in flight, moves focus into the form on open, and restores it
 * to the trigger on close.
 * @param props - the sidebar column state (`wide`) and the namespace translator.
 * @returns the footer trigger and its dialog.
 */
export function SupportButton({ wide, t }: SupportButtonProps) {
  const [open, setOpen] = useState(false)
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [phase, setPhase] = useState<Phase>('editing')
  const [failure, setFailure] = useState<Failure>(null)
  const doneRef = useRef<HTMLButtonElement>(null)
  const sending = phase === 'sending'
  const blocked = sending || subject.trim() === '' || message.trim() === ''

  // The form unmounts on success; move focus to the acknowledgement control
  // rather than leaving it on a removed button.
  useEffect(() => {
    if (phase === 'sent') doneRef.current?.focus()
  }, [phase])

  const close = (): void => {
    if (sending) return
    setOpen(false)
    setSubject('')
    setMessage('')
    setPhase('editing')
    setFailure(null)
  }

  const submit = async (): Promise<void> => {
    if (blocked) return
    setPhase('sending')
    setFailure(null)
    try {
      const response = await fetch('/support/requests', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          subject: subject.trim(),
          message: message.trim(),
          pageUrl: window.location.href,
        }),
      })
      if (response.status === 201) {
        setPhase('sent')
        return
      }
      setPhase('editing')
      setFailure(response.status === 401 ? 'signIn' : 'failed')
    } catch {
      setPhase('editing')
      setFailure('failed')
    }
  }

  const footer = phase === 'sent'
    ? (
      <Button ref={doneRef} variant="primary" data-modal-autofocus onClick={close}>
        {t('action.done')}
      </Button>
    )
    : (
      <>
        <Button variant="outline" disabled={sending} onClick={close}>{t('action.cancel')}</Button>
        <Button variant="primary" disabled={blocked} onClick={() => { void submit() }}>
          {t(sending ? 'action.sending' : 'action.submit')}
        </Button>
      </>
    )

  return (
    <div className={wide ? css.action : `${css.action} ${css.actionRail}`}>
      <button
        type="button"
        className={wide ? css.trigger : `${css.trigger} ${css.rail}`}
        aria-label={t('trigger.label')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => { setOpen(true) }}
      >
        <IconQuestionOutlineRegular size={wide ? 16 : 18} />
        {wide && <span className={css.label}>{t('trigger.label')}</span>}
      </button>
      <Modal
        open={open}
        onClose={close}
        closeLabel={t('dialog.close')}
        title={t('dialog.title')}
        className={css.dialog as string}
        footer={footer}
        {...phase === 'sent' ? {} : { description: t('dialog.description') }}
      >
        {phase === 'sent'
          ? <p className={css.success} role="status">{t('success.message')}</p>
          : (
            <div className={css.fields}>
              <label className={css.field}>
                <span className={css.fieldLabel}>{t('field.subject')}</span>
                <input
                  className={css.input}
                  value={subject}
                  maxLength={SUBJECT_MAX}
                  placeholder={t('field.subjectPlaceholder')}
                  data-modal-autofocus
                  disabled={sending}
                  required
                  onChange={(event) => { setSubject(event.target.value); setFailure(null) }}
                />
              </label>
              <label className={css.field}>
                <span className={css.fieldLabel}>{t('field.message')}</span>
                <textarea
                  className={css.textarea}
                  value={message}
                  maxLength={MESSAGE_MAX}
                  placeholder={t('field.messagePlaceholder')}
                  rows={5}
                  disabled={sending}
                  required
                  onChange={(event) => { setMessage(event.target.value); setFailure(null) }}
                />
              </label>
              {failure !== null && (
                <p className={css.error} role="alert">
                  {t(failure === 'signIn' ? 'error.signIn' : 'error.failed')}
                </p>
              )}
            </div>
          )}
      </Modal>
    </div>
  )
}
