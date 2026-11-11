import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { TenantRoots } from './types.ts'

/** A persisted, tenant-owned failure record. Secrets and request bodies are never accepted. */
export interface TenantFailureRecord {
  readonly operation: string
  readonly code: string
  readonly message: string
  readonly attempt: number
  readonly retryable: boolean
  readonly occurredAt?: string
  readonly metadata?: Readonly<Record<string, string | number | boolean>>
}

/** Append one bounded diagnostic record to the authenticated tenant's failure log. */
export async function recordTenantFailure(roots: TenantRoots, record: TenantFailureRecord): Promise<void> {
  if (!/^[a-z0-9][a-z0-9._/-]{0,127}$/iu.test(record.operation)) throw new Error('Invalid failure operation')
  if (!/^[a-z0-9][a-z0-9._/-]{0,127}$/iu.test(record.code)) throw new Error('Invalid failure code')
  const line = JSON.stringify({
    ...record,
    message: record.message.slice(0, 2_000),
    occurredAt: record.occurredAt ?? new Date().toISOString(),
  }) + '\n'
  const path = `${roots.failures}/events.jsonl`
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await appendFile(path, line, { encoding: 'utf8', mode: 0o600 })
}

/** Retry policy for transient remote work; attempts are finite and cancellation is honored. */
export interface RetryPolicy {
  readonly maxAttempts: number
  readonly initialDelayMs: number
  readonly maxDelayMs: number
}

/** Execute retryable work with exponential backoff and no retry after cancellation. */
export async function retryTransient<T>(
  work: (attempt: number) => Promise<T>,
  policy: RetryPolicy,
  signal?: AbortSignal,
  onFailure?: (error: unknown, attempt: number) => Promise<void>,
): Promise<T> {
  if (!Number.isInteger(policy.maxAttempts) || policy.maxAttempts < 1) throw new Error('Invalid retry attempt budget')
  let delay = Math.max(0, policy.initialDelayMs)
  const maxDelay = Math.max(delay, policy.maxDelayMs)
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    if (signal?.aborted) throw signal.reason ?? new Error('Operation cancelled')
    try {
      return await work(attempt)
    } catch (error) {
      await onFailure?.(error, attempt)
      if (attempt === policy.maxAttempts || signal?.aborted) throw error
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, delay)
        const abort = () => { clearTimeout(timer); reject(signal?.reason ?? new Error('Operation cancelled')) }
        signal?.addEventListener('abort', abort, { once: true })
      })
      delay = Math.min(maxDelay, Math.max(1, delay * 2))
    }
  }
  throw new Error('Retry loop exhausted')
}
