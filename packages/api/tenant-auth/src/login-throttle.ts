/**
 * Per-account sign-in failure throttle. A bounded in-memory window rejects
 * repeated guesses before password verification; the accepted trade-off is a
 * fixed window per deployment process (multi-instance deployments enforce per
 * instance, and a restart clears the window).
 * @module @deepseek-ai/dsh-api-tenant-auth/login-throttle
 */

/** One deployment's sign-in failure window. */
export interface LoginThrottle {
  /**
   * Read the current cooldown for one key.
   * @param key - account + client identity.
   * @returns the remaining cooldown, or undefined when the caller may try.
   */
  check(key: string): { readonly retryAfterSeconds: number } | undefined
  /** Record one failed attempt. */
  fail(key: string): void
  /** Clear a key after a successful sign-in. */
  succeed(key: string): void
}

/** Throttle configuration; tests inject the clock. */
export interface LoginThrottleOptions {
  /** Failures allowed inside the window before the next attempt is refused. */
  readonly maxFailures?: number
  /** Rolling failure window. */
  readonly windowMs?: number
  /** Largest number of tracked keys before the oldest are evicted. */
  readonly maxKeys?: number
  readonly now?: () => number
}

/**
 * Build the sign-in failure throttle.
 * @param options - limits and clock.
 * @returns the throttle.
 */
export function createLoginThrottle(options: LoginThrottleOptions = {}): LoginThrottle {
  const maxFailures = options.maxFailures ?? 8
  const windowMs = options.windowMs ?? 15 * 60_000
  const maxKeys = options.maxKeys ?? 10_000
  const now = options.now ?? Date.now
  const failures = new Map<string, number[]>()

  const recent = (key: string): number[] => {
    const windowStart = now() - windowMs
    const kept = (failures.get(key) ?? []).filter(at => at > windowStart)
    if (kept.length === 0) failures.delete(key)
    else failures.set(key, kept)
    return kept
  }

  return {
    check(key: string): { readonly retryAfterSeconds: number } | undefined {
      const kept = recent(key)
      if (kept.length < maxFailures) return undefined
      const oldest = kept[0] ?? now()
      return { retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - now()) / 1000)) }
    },
    fail(key: string): void {
      const kept = recent(key)
      kept.push(now())
      failures.set(key, kept)
      while (failures.size > maxKeys) {
        const oldestKey = failures.keys().next().value
        if (oldestKey === undefined) break
        failures.delete(oldestKey)
      }
    },
    succeed(key: string): void {
      failures.delete(key)
    },
  }
}
