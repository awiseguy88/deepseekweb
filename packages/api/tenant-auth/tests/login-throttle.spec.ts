import { describe, expect, it } from 'vitest'
import { createLoginThrottle } from '../src/login-throttle.ts'

describe('login throttle', () => {
  it('allows attempts under the limit and clears after success', () => {
    let now = 0
    const throttle = createLoginThrottle({ maxFailures: 3, windowMs: 60_000, now: () => now })
    throttle.fail('a|1')
    throttle.fail('a|1')
    expect(throttle.check('a|1')).toBeUndefined()
    throttle.succeed('a|1')
    expect(throttle.check('a|1')).toBeUndefined()
  })

  it('refuses after the configured failures and reports the remaining window', () => {
    let now = 0
    const throttle = createLoginThrottle({ maxFailures: 2, windowMs: 60_000, now: () => now })
    throttle.fail('a|1')
    now = 10_000
    throttle.fail('a|1')
    now = 20_000
    expect(throttle.check('a|1')).toEqual({ retryAfterSeconds: 40 })
  })

  it('starts a fresh window after the previous failures expire', () => {
    let now = 0
    const throttle = createLoginThrottle({ maxFailures: 1, windowMs: 60_000, now: () => now })
    throttle.fail('a|1')
    expect(throttle.check('a|1')).toEqual({ retryAfterSeconds: 60 })
    now = 61_000
    expect(throttle.check('a|1')).toBeUndefined()
  })

  it('keeps keys independent and bounds the tracked set', () => {
    let now = 0
    const throttle = createLoginThrottle({ maxFailures: 1, windowMs: 60_000, maxKeys: 2, now: () => now })
    throttle.fail('a|1')
    throttle.fail('b|1')
    throttle.fail('c|1')
    expect(throttle.check('a|1')).toBeUndefined()
    expect(throttle.check('c|1')).toEqual({ retryAfterSeconds: 60 })
  })
})
