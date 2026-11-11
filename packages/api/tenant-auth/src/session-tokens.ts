import { createHash, randomBytes } from 'node:crypto'
import type { TenantAuthStore, TenantUserRecord } from './types.ts'

function digest(token: string): string {
  return createHash('sha256').update(token, 'ascii').digest('hex')
}

function valid(token: string): boolean {
  return token.length === 43 && /^[A-Za-z0-9_-]+$/.test(token)
}

/** Issue a browser token only after its digest has been persisted. */
export async function issueSession(store: TenantAuthStore, user: TenantUserRecord, expiresAt: Date): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  await store.createSession({ sessionId: digest(token), userId: user.userId, tenantId: user.tenantId, expiresAt })
  return token
}

/** Resolve an opaque browser token through the store's current admission checks. */
export async function resolveSession(store: TenantAuthStore, token: string) {
  return valid(token) ? store.findSession(digest(token)) : null
}

/** Revoke the stored digest when its browser session logs out. */
export async function logoutSession(store: TenantAuthStore, token: string): Promise<void> {
  if (valid(token)) await store.revokeSession(digest(token))
}
