import { randomUUID } from 'node:crypto'
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

  async createMember(email: string, passwordHash: string): Promise<{ userId: string; tenantId: string }> {
    const userId = randomUUID()
    const tenantId = randomUUID()
    await this.db.query(
      `WITH tenant AS (
         INSERT INTO wiseai_tenants (tenant_id) VALUES ($1) RETURNING tenant_id
       )
       INSERT INTO wiseai_users (user_id, tenant_id, email, password_hash, role)
       SELECT $2, tenant_id, $3, $4, 'member' FROM tenant`,
      [tenantId, userId, email.trim(), passwordHash],
    )
    return { userId, tenantId }
  }

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
      `SELECT s.session_id, s.user_id, s.tenant_id, s.expires_at, s.revoked_at
         FROM wiseai_sessions AS s
         JOIN wiseai_users AS u ON u.user_id = s.user_id AND u.tenant_id = s.tenant_id
         JOIN wiseai_tenants AS t ON t.tenant_id = u.tenant_id
        WHERE s.session_id = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
          AND NOT u.disabled AND NOT t.disabled`,
      [sessionId],
    )
    const row = result.rows[0]
    return row === undefined ? null : {
      sessionId: row.session_id, userId: row.user_id, tenantId: row.tenant_id,
      expiresAt: row.expires_at, revokedAt: row.revoked_at,
    }
  }

  async createSession(input: Omit<TenantSessionRecord, 'revokedAt'>): Promise<TenantSessionRecord> {
    const result = await this.db.query(
      `INSERT INTO wiseai_sessions (session_id, user_id, tenant_id, expires_at)
       SELECT $1, u.user_id, u.tenant_id, $4::timestamptz
         FROM wiseai_users AS u JOIN wiseai_tenants AS t ON t.tenant_id = u.tenant_id
        WHERE u.user_id = $2 AND u.tenant_id = $3 AND NOT u.disabled AND NOT t.disabled
          AND $4::timestamptz > now()
       RETURNING session_id`,
      [input.sessionId, input.userId, input.tenantId, input.expiresAt],
    )
    if (result.rows.length !== 1) throw new Error('Session admission refused')
    return { ...input, revokedAt: null }
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.db.query('UPDATE wiseai_sessions SET revoked_at = now() WHERE session_id = $1 AND revoked_at IS NULL', [sessionId])
  }

  async listUsers(tenantId: string): Promise<readonly TenantUserRecord[]> {
    const result = await this.db.query<UserRow>(
      'SELECT user_id, email, password_hash, role, tenant_id, disabled FROM wiseai_users WHERE tenant_id = $1 ORDER BY created_at, user_id',
      [tenantId],
    )
    return result.rows.map(row => ({
      userId: row.user_id, email: row.email, passwordHash: row.password_hash,
      role: row.role, tenantId: row.tenant_id, disabled: row.disabled,
    }))
  }

  async setUserDisabled(tenantId: string, userId: string, disabled: boolean): Promise<void> {
    await this.db.query(
      'UPDATE wiseai_users SET disabled = $3 WHERE user_id = $1 AND tenant_id = $2',
      [userId, tenantId, disabled],
    )
  }
}
