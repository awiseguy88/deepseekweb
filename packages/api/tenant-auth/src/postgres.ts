import type { TenantAuthStore, TenantSessionRecord, TenantUserRecord } from './types.ts'

/** Minimal query surface, allowing the host to inject its approved Postgres driver. */
export interface TenantAuthDatabase {
  query<T extends Record<string, unknown>>(sql: string, parameters: readonly unknown[]): Promise<{ readonly rows: readonly T[] }>
}

interface UserRow extends Record<string, unknown> {
  user_id: string
  email: string
  password_hash: string
  role: 'admin' | 'member'
  tenant_id: string
  disabled: boolean
}

interface SessionRow extends Record<string, unknown> {
  session_id: string
  user_id: string
  tenant_id: string
  expires_at: Date
  revoked_at: Date | null
}

/** Postgres-backed identity lookup; session tokens are passed already hashed. */
export class PostgresTenantAuthStore implements TenantAuthStore {
  constructor(private readonly db: TenantAuthDatabase) {}

  async findUserByEmail(email: string): Promise<TenantUserRecord | null> {
    const result = await this.db.query<UserRow>(
      'SELECT user_id, email, password_hash, role, tenant_id, disabled FROM wiseai_users WHERE lower(email) = lower($1) LIMIT 1',
      [email],
    )
    const row = result.rows[0]
    return row === undefined ? null : {
      userId: row.user_id, email: row.email, passwordHash: row.password_hash,
      role: row.role, tenantId: row.tenant_id, disabled: row.disabled,
    }
  }

  async findSession(sessionId: string): Promise<TenantSessionRecord | null> {
    const result = await this.db.query<SessionRow>(
      'SELECT session_id, user_id, tenant_id, expires_at, revoked_at FROM wiseai_sessions WHERE session_id = $1 LIMIT 1',
      [sessionId],
    )
    const row = result.rows[0]
    return row === undefined ? null : {
      sessionId: row.session_id, userId: row.user_id, tenantId: row.tenant_id,
      expiresAt: row.expires_at, revokedAt: row.revoked_at,
    }
  }

  async createSession(input: Omit<TenantSessionRecord, 'revokedAt'>): Promise<TenantSessionRecord> {
    await this.db.query(
      'INSERT INTO wiseai_sessions (session_id, user_id, tenant_id, expires_at) VALUES ($1, $2, $3, $4)',
      [input.sessionId, input.userId, input.tenantId, input.expiresAt],
    )
    return { ...input, revokedAt: null }
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.db.query('UPDATE wiseai_sessions SET revoked_at = now() WHERE session_id = $1 AND revoked_at IS NULL', [sessionId])
  }
}
