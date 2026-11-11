/** Database-facing tenant identity records. Values are intentionally opaque to callers. */
export interface TenantUserRecord {
  readonly userId: string
  readonly email: string
  readonly passwordHash: string
  readonly role: 'admin' | 'member'
  readonly tenantId: string
  readonly disabled: boolean
}

/** A server-issued session bound to one user and tenant. */
export interface TenantSessionRecord {
  readonly sessionId: string
  readonly userId: string
  readonly tenantId: string
  readonly expiresAt: Date
  readonly revokedAt: Date | null
}

/** Namespaced filesystem roots; callers must resolve these from the authenticated tenant. */
export interface TenantRoots {
  readonly root: string
  readonly sessions: string
  readonly workspace: string
  readonly credentials: string
  readonly failures: string
}

/** Minimal persistence seam for a future Postgres-backed implementation. */
export interface TenantAuthStore {
  createMember(email: string, passwordHash: string): Promise<{ userId: string; tenantId: string }>
  createAdmin(email: string, passwordHash: string): Promise<{ userId: string; tenantId: string }>
  findUserByEmail(email: string): Promise<TenantUserRecord | null>
  findUserById(userId: string): Promise<TenantUserRecord | null>
  findSession(sessionId: string): Promise<TenantSessionRecord | null>
  createSession(input: Omit<TenantSessionRecord, 'revokedAt'>): Promise<TenantSessionRecord>
  revokeSession(sessionId: string): Promise<void>
  listUsers(tenantId: string): Promise<readonly TenantUserRecord[]>
  setUserDisabled(tenantId: string, userId: string, disabled: boolean): Promise<void>
}

/** Resolve tenant-owned directories from a trusted server-side identity. */
export function tenantRoots(dataRoot: string, tenantId: string): TenantRoots {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(tenantId)) throw new Error('invalid tenant id')
  const root = `${dataRoot.replace(/[\\/]+$/, '')}/tenants/${tenantId}`
  return {
    root,
    sessions: `${root}/sessions`,
    workspace: `${root}/workspace`,
    credentials: `${root}/credentials`,
    failures: `${root}/failures`,
  }
}
