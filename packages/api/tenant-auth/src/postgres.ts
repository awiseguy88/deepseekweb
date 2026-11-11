import { randomUUID } from 'node:crypto'
import type {
  AuditEventInput,
  AuditEventRecord,
  ClaimSessionOwnerInput,
  ClaimWorkspaceOwnerInput,
  SalesEventInput,
  SalesEventRecord,
  SupportRequestInput,
  SupportRequestPatch,
  SupportRequestRecord,
  TenantAccountPatch,
  TenantAccountRecord,
  TenantAuthStore,
  TenantProfilePatch,
  TenantRecord,
  TenantSessionListRecord,
  TenantSessionOwnerRecord,
  TenantSessionRecord,
  TenantUserRecord,
  TenantWorkspaceOwnerRecord,
} from './types.ts'

/** Minimal query surface, allowing the host to inject its approved Postgres driver. */
export interface TenantAuthDatabase {
  query<T extends Record<string, unknown>>(sql: string, parameters: readonly unknown[]): Promise<{ readonly rows: readonly T[] }>
}

/** Whole days of explicit entitlement grace after access_until; zero means none. */
function accessGraceDays(): number {
  const value = Number(process.env.WISEAI_ACCESS_GRACE_DAYS ?? '0')
  return Number.isSafeInteger(value) && value >= 0 && value <= 365 ? value : 0
}

const USER_COLUMNS = 'user_id, email, password_hash, role, tenant_id, disabled, platform_admin, last_seen_at, created_at'
const TENANT_COLUMNS = 'tenant_id, name, plan, status, disabled, stripe_customer_id, stripe_subscription_id, access_until, notes, created_at, updated_at'
const ACCOUNT_COLUMNS = 'u.user_id, u.tenant_id, t.name AS tenant_name, u.email, u.role, u.platform_admin, u.disabled, u.created_at, u.last_seen_at'
const SESSION_LIST_COLUMNS = 's.session_id, s.user_id, s.tenant_id, u.email, t.name AS tenant_name, s.expires_at, s.created_at, s.revoked_at'
const SUPPORT_COLUMNS = 'r.request_id, r.tenant_id, t.name AS tenant_name, r.user_id, r.email, r.subject, r.message, r.page_url, r.status, r.priority, r.admin_note, r.created_at, r.updated_at'
const SALES_COLUMNS = 'event_id, event_type, tenant_id, customer_id, subscription_id, amount_total, currency, status, created_at'
const SESSION_OWNER_COLUMNS = 'session_id, tenant_id, user_id'
const WORKSPACE_OWNER_COLUMNS = 'workspace_id, tenant_id, user_id'

interface UserRow extends Record<string, unknown> {
  user_id: string
  email: string
  password_hash: string
  role: 'admin' | 'member'
  tenant_id: string
  disabled: boolean
  platform_admin: boolean
  last_seen_at: Date | null
  created_at: Date
}

interface TenantRow extends Record<string, unknown> {
  tenant_id: string
  name: string
  plan: string
  status: TenantRecord['status']
  disabled: boolean
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  access_until: Date | null
  notes: string
  created_at: Date
  updated_at: Date
}

interface AuditRow extends Record<string, unknown> {
  event_id: string
  actor_user_id: string
  actor_tenant_id: string
  action: string
  target_tenant_id: string | null
  target_id: string | null
  details: Readonly<Record<string, unknown>>
  created_at: Date
}

interface AccountRow extends Record<string, unknown> {
  user_id: string
  tenant_id: string
  tenant_name: string
  email: string
  role: 'admin' | 'member'
  platform_admin: boolean
  disabled: boolean
  created_at: Date
  last_seen_at: Date | null
}

interface SessionRow extends Record<string, unknown> {
  session_id: string
  user_id: string
  tenant_id: string
  expires_at: Date
  revoked_at: Date | null
}

interface SessionListRow extends Record<string, unknown> {
  session_id: string
  user_id: string
  tenant_id: string
  email: string
  tenant_name: string
  expires_at: Date
  created_at: Date
  revoked_at: Date | null
}

interface SupportRow extends Record<string, unknown> {
  request_id: string
  tenant_id: string
  tenant_name: string
  user_id: string
  email: string
  subject: string
  message: string
  page_url: string
  status: SupportRequestRecord['status']
  priority: SupportRequestRecord['priority']
  admin_note: string
  created_at: Date
  updated_at: Date
}

interface SalesRow extends Record<string, unknown> {
  event_id: string
  event_type: string
  tenant_id: string | null
  customer_id: string | null
  subscription_id: string | null
  amount_total: number | null
  currency: string | null
  status: string | null
  created_at: Date
}

interface SessionOwnerRow extends Record<string, unknown> {
  session_id: string
  tenant_id: string
  user_id: string
}

interface WorkspaceOwnerRow extends Record<string, unknown> {
  workspace_id: string
  tenant_id: string
  user_id: string
}

/** Account emails identify a person across tenants, so they are stored folded. */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === '23505'
}

/** One column assignment whose value is bound as the next positional parameter. */
type Field = readonly [column: string, value: unknown]

/** Render a dynamic SET list plus its values, always bumping `updated_at`. */
function assignments(fields: readonly Field[]): { readonly sql: string; readonly parameters: readonly unknown[] } {
  const parameters: unknown[] = []
  const columns = fields.map(([column, value]) => {
    parameters.push(value)
    return `${column} = $${parameters.length}`
  })
  columns.push('updated_at = now()')
  return { sql: columns.join(', '), parameters }
}

function userRecord(row: UserRow): TenantUserRecord {
  return {
    userId: row.user_id,
    email: row.email,
    passwordHash: row.password_hash,
    role: row.role,
    tenantId: row.tenant_id,
    disabled: row.disabled,
    platformAdmin: row.platform_admin,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  }
}

function tenantRecord(row: TenantRow): TenantRecord {
  return {
    tenantId: row.tenant_id,
    name: row.name,
    plan: row.plan,
    status: row.status,
    disabled: row.disabled,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    accessUntil: row.access_until,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function accountRecord(row: AccountRow): TenantAccountRecord {
  return {
    userId: row.user_id,
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    email: row.email,
    role: row.role,
    platformAdmin: row.platform_admin,
    disabled: row.disabled,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  }
}

function sessionListRecord(row: SessionListRow): TenantSessionListRecord {
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    tenantId: row.tenant_id,
    email: row.email,
    tenantName: row.tenant_name,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  }
}

function supportRecord(row: SupportRow): SupportRequestRecord {
  return {
    requestId: row.request_id,
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    userId: row.user_id,
    email: row.email,
    subject: row.subject,
    message: row.message,
    pageUrl: row.page_url,
    status: row.status,
    priority: row.priority,
    adminNote: row.admin_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function salesRecord(row: SalesRow): SalesEventRecord {
  return {
    eventId: row.event_id,
    eventType: row.event_type,
    tenantId: row.tenant_id,
    customerId: row.customer_id,
    subscriptionId: row.subscription_id,
    amountTotal: row.amount_total,
    currency: row.currency,
    status: row.status,
    createdAt: row.created_at,
  }
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
      [tenantId, userId, normalizeEmail(email), passwordHash],
    )
    return { userId, tenantId }
  }

  async createAdmin(email: string, passwordHash: string): Promise<{ userId: string; tenantId: string }> {
    const userId = randomUUID()
    const tenantId = randomUUID()
    await this.db.query(
      `WITH tenant AS (INSERT INTO wiseai_tenants (tenant_id) VALUES ($1) RETURNING tenant_id)
       INSERT INTO wiseai_users (user_id, tenant_id, email, password_hash, role)
       SELECT $2, tenant_id, $3, $4, 'admin' FROM tenant`,
      [tenantId, userId, normalizeEmail(email), passwordHash],
    )
    return { userId, tenantId }
  }

  async findUserByEmail(email: string): Promise<TenantUserRecord | null> {
    const result = await this.db.query<UserRow>(
      `SELECT ${USER_COLUMNS} FROM wiseai_users WHERE lower(email) = lower($1) LIMIT 1`,
      [email.trim()],
    )
    const row = result.rows[0]
    return row === undefined ? null : userRecord(row)
  }

  async findUserById(userId: string): Promise<TenantUserRecord | null> {
    const result = await this.db.query<UserRow>(
      `SELECT ${USER_COLUMNS} FROM wiseai_users WHERE user_id = $1 LIMIT 1`,
      [userId],
    )
    const row = result.rows[0]
    return row === undefined ? null : userRecord(row)
  }

  async findSession(sessionId: string): Promise<TenantSessionRecord | null> {
    const result = await this.db.query<SessionRow>(
      `SELECT s.session_id, s.user_id, s.tenant_id, s.expires_at, s.revoked_at
         FROM wiseai_sessions AS s
         JOIN wiseai_users AS u ON u.user_id = s.user_id AND u.tenant_id = s.tenant_id
         JOIN wiseai_tenants AS t ON t.tenant_id = u.tenant_id
        WHERE s.session_id = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
          AND NOT u.disabled AND NOT t.disabled AND t.deleted_at IS NULL
          AND (
            t.status IN ('active', 'trialing')
            OR (t.status = 'past_due' AND t.access_until IS NOT NULL)
          )
          AND (t.access_until IS NULL OR t.access_until + make_interval(days => $2) > now())`,
      [sessionId, accessGraceDays()],
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
        WHERE u.user_id = $2 AND u.tenant_id = $3 AND NOT u.disabled AND NOT t.disabled AND t.deleted_at IS NULL
          AND (
            t.status IN ('active', 'trialing')
            OR (t.status = 'past_due' AND t.access_until IS NOT NULL)
          )
          AND (t.access_until IS NULL OR t.access_until + make_interval(days => $5) > now())
          AND $4::timestamptz > now()
       RETURNING session_id`,
      [input.sessionId, input.userId, input.tenantId, input.expiresAt, accessGraceDays()],
    )
    if (result.rows.length !== 1) throw new Error('Session admission refused')
    return { ...input, revokedAt: null }
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.db.query('UPDATE wiseai_sessions SET revoked_at = now() WHERE session_id = $1 AND revoked_at IS NULL', [sessionId])
  }

  async listUsers(tenantId: string): Promise<readonly TenantUserRecord[]> {
    const result = await this.db.query<UserRow>(
      `SELECT ${USER_COLUMNS} FROM wiseai_users WHERE tenant_id = $1 ORDER BY created_at, user_id`,
      [tenantId],
    )
    return result.rows.map(userRecord)
  }

  async setUserDisabled(tenantId: string, userId: string, disabled: boolean): Promise<void> {
    await this.db.query(
      'UPDATE wiseai_users SET disabled = $3, updated_at = now() WHERE user_id = $1 AND tenant_id = $2',
      [userId, tenantId, disabled],
    )
  }

  async createTenant(input: {
    readonly name: string
    readonly plan: string
    readonly adminEmail: string
    readonly adminPasswordHash: string
    readonly platformAdmin?: boolean
  }): Promise<{ tenantId: string; userId: string }> {
    const tenantId = randomUUID()
    const userId = randomUUID()
    try {
      await this.db.query(
        `WITH tenant AS (
           INSERT INTO wiseai_tenants (tenant_id, name, plan) VALUES ($1, $2, $3) RETURNING tenant_id
         )
         INSERT INTO wiseai_users (user_id, tenant_id, email, password_hash, role, platform_admin)
         SELECT $4, tenant_id, $5, $6, 'admin', $7 FROM tenant`,
        [tenantId, input.name.trim(), input.plan, userId, normalizeEmail(input.adminEmail), input.adminPasswordHash, input.platformAdmin ?? false],
      )
    } catch (error) {
      if (isUniqueViolation(error)) throw new Error('An account with this email already exists')
      throw error
    }
    return { tenantId, userId }
  }

  async findTenantById(tenantId: string): Promise<TenantRecord | null> {
    const result = await this.db.query<TenantRow>(
      `SELECT ${TENANT_COLUMNS} FROM wiseai_tenants WHERE tenant_id = $1 AND deleted_at IS NULL LIMIT 1`,
      [tenantId],
    )
    const row = result.rows[0]
    return row === undefined ? null : tenantRecord(row)
  }

  async listTenants(): Promise<readonly TenantRecord[]> {
    const result = await this.db.query<TenantRow>(
      `SELECT ${TENANT_COLUMNS} FROM wiseai_tenants WHERE deleted_at IS NULL ORDER BY created_at DESC, tenant_id`,
      [],
    )
    return result.rows.map(tenantRecord)
  }

  async updateTenant(tenantId: string, patch: TenantProfilePatch): Promise<TenantRecord | null> {
    const fields: Field[] = []
    if (patch.name !== undefined) fields.push(['name', patch.name])
    if (patch.plan !== undefined) fields.push(['plan', patch.plan])
    if (patch.status !== undefined) fields.push(['status', patch.status])
    if (patch.disabled !== undefined) fields.push(['disabled', patch.disabled])
    if (patch.stripeCustomerId !== undefined) fields.push(['stripe_customer_id', patch.stripeCustomerId])
    if (patch.stripeSubscriptionId !== undefined) fields.push(['stripe_subscription_id', patch.stripeSubscriptionId])
    if (patch.accessUntil !== undefined) fields.push(['access_until', patch.accessUntil])
    if (patch.notes !== undefined) fields.push(['notes', patch.notes])
    const update = assignments(fields)
    const parameters = [...update.parameters, tenantId]
    const result = await this.db.query<TenantRow>(
      `UPDATE wiseai_tenants SET ${update.sql} WHERE tenant_id = $${parameters.length} RETURNING ${TENANT_COLUMNS}`,
      parameters,
    )
    const row = result.rows[0]
    return row === undefined ? null : tenantRecord(row)
  }

  async createUserInTenant(input: {
    readonly tenantId: string
    readonly email: string
    readonly passwordHash: string
    readonly role: 'admin' | 'member'
    readonly platformAdmin?: boolean
  }): Promise<{ userId: string }> {
    const userId = randomUUID()
    try {
      await this.db.query(
        `INSERT INTO wiseai_users (user_id, tenant_id, email, password_hash, role, platform_admin)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [userId, input.tenantId, normalizeEmail(input.email), input.passwordHash, input.role, input.platformAdmin ?? false],
      )
    } catch (error) {
      if (isUniqueViolation(error)) throw new Error('An account with this email already exists in this tenant')
      throw error
    }
    return { userId }
  }

  async listAccounts(tenantId: string): Promise<readonly TenantAccountRecord[]> {
    const result = await this.db.query<AccountRow>(
      `SELECT ${ACCOUNT_COLUMNS}
         FROM wiseai_users AS u JOIN wiseai_tenants AS t ON t.tenant_id = u.tenant_id
        WHERE u.tenant_id = $1
        ORDER BY u.created_at, u.user_id`,
      [tenantId],
    )
    return result.rows.map(accountRecord)
  }

  async listAllAccounts(): Promise<readonly TenantAccountRecord[]> {
    const result = await this.db.query<AccountRow>(
      `SELECT ${ACCOUNT_COLUMNS}
         FROM wiseai_users AS u JOIN wiseai_tenants AS t ON t.tenant_id = u.tenant_id
        ORDER BY u.created_at, u.user_id`,
      [],
    )
    return result.rows.map(accountRecord)
  }

  async findAccountById(userId: string): Promise<TenantAccountRecord | null> {
    const result = await this.db.query<AccountRow>(
      `SELECT ${ACCOUNT_COLUMNS}
         FROM wiseai_users AS u JOIN wiseai_tenants AS t ON t.tenant_id = u.tenant_id
        WHERE u.user_id = $1 LIMIT 1`,
      [userId],
    )
    const row = result.rows[0]
    return row === undefined ? null : accountRecord(row)
  }

  async updateAccount(userId: string, patch: TenantAccountPatch): Promise<TenantAccountRecord | null> {
    const fields: Field[] = []
    if (patch.role !== undefined) fields.push(['role', patch.role])
    if (patch.disabled !== undefined) fields.push(['disabled', patch.disabled])
    if (patch.passwordHash !== undefined) fields.push(['password_hash', patch.passwordHash])
    if (patch.platformAdmin !== undefined) fields.push(['platform_admin', patch.platformAdmin])
    if (patch.email !== undefined) fields.push(['email', patch.email.trim().toLowerCase()])
    const update = assignments(fields)
    const parameters = [...update.parameters, userId]
    const result = await this.db.query<AccountRow>(
      `WITH updated AS (
         UPDATE wiseai_users SET ${update.sql} WHERE user_id = $${parameters.length} RETURNING *
       )
       SELECT ${ACCOUNT_COLUMNS}
         FROM updated AS u JOIN wiseai_tenants AS t ON t.tenant_id = u.tenant_id`,
      parameters,
    )
    const row = result.rows[0]
    return row === undefined ? null : accountRecord(row)
  }

  async deleteTenant(tenantId: string): Promise<boolean> {
    const result = await this.db.query<{ tenant_id: string }>(
      'DELETE FROM wiseai_tenants WHERE tenant_id = $1 RETURNING tenant_id',
      [tenantId],
    )
    return result.rows.length > 0
  }

  async softDeleteTenant(tenantId: string): Promise<boolean> {
    const result = await this.db.query<{ tenant_id: string }>(
      `UPDATE wiseai_tenants
          SET disabled = true, deleted_at = now(), updated_at = now()
        WHERE tenant_id = $1 AND deleted_at IS NULL
        RETURNING tenant_id`,
      [tenantId],
    )
    return result.rows.length > 0
  }

  async recordAuditEvent(input: AuditEventInput): Promise<void> {
    await this.db.query(
      `INSERT INTO wiseai_audit_events
         (event_id, actor_user_id, actor_tenant_id, action, target_tenant_id, target_id, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        randomUUID(),
        input.actorUserId,
        input.actorTenantId,
        input.action,
        input.targetTenantId ?? null,
        input.targetId ?? null,
        JSON.stringify(input.details ?? {}),
      ],
    )
  }

  async listAuditEvents(filter: { readonly tenantId?: string; readonly limit?: number } = {}): Promise<readonly AuditEventRecord[]> {
    const limit = Math.min(Math.max(filter.limit ?? 100, 1), 1000)
    const conditions: string[] = []
    const parameters: unknown[] = []
    if (filter.tenantId !== undefined) {
      parameters.push(filter.tenantId)
      conditions.push(`target_tenant_id = $${parameters.length}`)
    }
    parameters.push(limit)
    const result = await this.db.query<AuditRow>(
      `SELECT event_id, actor_user_id, actor_tenant_id, action, target_tenant_id, target_id, details, created_at
         FROM wiseai_audit_events
         ${conditions.length === 0 ? '' : `WHERE ${conditions.join(' AND ')}`}
        ORDER BY created_at DESC, event_id DESC
        LIMIT $${parameters.length}`,
      parameters,
    )
    return result.rows.map(row => ({
      eventId: row.event_id,
      actorUserId: row.actor_user_id,
      actorTenantId: row.actor_tenant_id,
      action: row.action,
      ...row.target_tenant_id === null ? {} : { targetTenantId: row.target_tenant_id },
      ...row.target_id === null ? {} : { targetId: row.target_id },
      details: row.details,
      createdAt: row.created_at.toISOString(),
    }))
  }

  async revokeSessions(filter: { readonly tenantId?: string; readonly userId?: string } = {}): Promise<number> {
    const conditions = ['revoked_at IS NULL']
    const parameters: unknown[] = []
    if (filter.tenantId !== undefined) {
      parameters.push(filter.tenantId)
      conditions.push(`tenant_id = $${parameters.length}`)
    }
    if (filter.userId !== undefined) {
      parameters.push(filter.userId)
      conditions.push(`user_id = $${parameters.length}`)
    }
    const result = await this.db.query<{ session_id: string }>(
      `UPDATE wiseai_sessions SET revoked_at = now() WHERE ${conditions.join(' AND ')} RETURNING session_id`,
      parameters,
    )
    return result.rows.length
  }

  async purgeRevokedSessions(filter: { readonly tenantId?: string } = {}): Promise<number> {
    const result = filter.tenantId === undefined
      ? await this.db.query<{ session_id: string }>(
        'DELETE FROM wiseai_sessions WHERE revoked_at IS NOT NULL RETURNING session_id',
        [],
      )
      : await this.db.query<{ session_id: string }>(
        'DELETE FROM wiseai_sessions WHERE revoked_at IS NOT NULL AND tenant_id = $1 RETURNING session_id',
        [filter.tenantId],
      )
    return result.rows.length
  }

  async recordLogin(userId: string): Promise<void> {    const bootstrapEmail = process.env.WISEAI_ADMIN_EMAIL?.trim().toLowerCase() ?? ''
    await this.db.query(
      `UPDATE wiseai_users
          SET last_seen_at = now(), updated_at = now(),
              platform_admin = platform_admin OR ($2 <> '' AND lower(email) = $2)
        WHERE user_id = $1`,
      [userId, bootstrapEmail],
    )
  }

  async listSessions(filter: { readonly tenantId?: string; readonly activeOnly?: boolean } = {}): Promise<readonly TenantSessionListRecord[]> {
    const conditions: string[] = []
    const parameters: unknown[] = []
    if (filter.tenantId !== undefined) {
      parameters.push(filter.tenantId)
      conditions.push(`s.tenant_id = $${parameters.length}`)
    }
    if (filter.activeOnly === true) conditions.push('s.expires_at > now() AND s.revoked_at IS NULL')
    const where = conditions.length === 0 ? '' : ` WHERE ${conditions.join(' AND ')}`
    const result = await this.db.query<SessionListRow>(
      `SELECT ${SESSION_LIST_COLUMNS}
         FROM wiseai_sessions AS s
         JOIN wiseai_users AS u ON u.user_id = s.user_id
         JOIN wiseai_tenants AS t ON t.tenant_id = s.tenant_id${where}
        ORDER BY s.created_at DESC, s.session_id`,
      parameters,
    )
    return result.rows.map(sessionListRecord)
  }

  async createSupportRequest(input: SupportRequestInput): Promise<SupportRequestRecord> {
    const requestId = randomUUID()
    const result = await this.db.query<SupportRow>(
      `WITH inserted AS (
         INSERT INTO wiseai_support_requests (request_id, tenant_id, user_id, email, subject, message, page_url)
         SELECT $1, u.tenant_id, u.user_id, u.email, $3, $4, $5
           FROM wiseai_users AS u
          WHERE u.user_id = $2 AND u.tenant_id = $6 AND NOT u.disabled
         RETURNING *
       )
       SELECT ${SUPPORT_COLUMNS}
         FROM inserted AS r JOIN wiseai_tenants AS t ON t.tenant_id = r.tenant_id`,
      [requestId, input.userId, input.subject, input.message, input.pageUrl, input.tenantId],
    )
    const row = result.rows[0]
    if (row === undefined) throw new Error('Support request rejected')
    return supportRecord(row)
  }

  async listSupportRequests(filter: { readonly status?: SupportRequestRecord['status']; readonly tenantId?: string; readonly limit?: number } = {}): Promise<readonly SupportRequestRecord[]> {
    const conditions: string[] = []
    const parameters: unknown[] = []
    if (filter.status !== undefined) {
      parameters.push(filter.status)
      conditions.push(`r.status = $${parameters.length}`)
    }
    if (filter.tenantId !== undefined) {
      parameters.push(filter.tenantId)
      conditions.push(`r.tenant_id = $${parameters.length}`)
    }
    const where = conditions.length === 0 ? '' : ` WHERE ${conditions.join(' AND ')}`
    let limit = ''
    if (filter.limit !== undefined) {
      parameters.push(filter.limit)
      limit = ` LIMIT $${parameters.length}`
    }
    const result = await this.db.query<SupportRow>(
      `SELECT ${SUPPORT_COLUMNS}
         FROM wiseai_support_requests AS r JOIN wiseai_tenants AS t ON t.tenant_id = r.tenant_id${where}
        ORDER BY r.created_at DESC, r.request_id${limit}`,
      parameters,
    )
    return result.rows.map(supportRecord)
  }

  async updateSupportRequest(requestId: string, patch: SupportRequestPatch): Promise<SupportRequestRecord | null> {
    const fields: Field[] = []
    if (patch.status !== undefined) fields.push(['status', patch.status])
    if (patch.priority !== undefined) fields.push(['priority', patch.priority])
    if (patch.adminNote !== undefined) fields.push(['admin_note', patch.adminNote])
    const update = assignments(fields)
    const parameters = [...update.parameters, requestId]
    const result = await this.db.query<SupportRow>(
      `WITH updated AS (
         UPDATE wiseai_support_requests SET ${update.sql} WHERE request_id = $${parameters.length} RETURNING *
       )
       SELECT ${SUPPORT_COLUMNS}
         FROM updated AS r JOIN wiseai_tenants AS t ON t.tenant_id = r.tenant_id`,
      parameters,
    )
    const row = result.rows[0]
    return row === undefined ? null : supportRecord(row)
  }

  async recordSalesEvent(input: SalesEventInput): Promise<void> {
    await this.db.query(
      `INSERT INTO wiseai_sales_events
         (event_id, event_type, tenant_id, customer_id, subscription_id, amount_total, currency, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (event_id) DO NOTHING`,
      [input.eventId, input.eventType, input.tenantId, input.customerId, input.subscriptionId, input.amountTotal, input.currency, input.status],
    )
  }

  async listSalesEvents(limit?: number): Promise<readonly SalesEventRecord[]> {
    const parameters: unknown[] = []
    let sql = `SELECT ${SALES_COLUMNS} FROM wiseai_sales_events ORDER BY created_at DESC, event_id`
    if (limit !== undefined) {
      parameters.push(limit)
      sql += ` LIMIT $${parameters.length}`
    }
    const result = await this.db.query<SalesRow>(sql, parameters)
    return result.rows.map(salesRecord)
  }

  async listSessionOwners(): Promise<readonly TenantSessionOwnerRecord[]> {
    const result = await this.db.query<SessionOwnerRow>(
      `SELECT ${SESSION_OWNER_COLUMNS} FROM wiseai_session_owners ORDER BY tenant_id, session_id`,
      [],
    )
    return result.rows.map(row => ({ sessionId: row.session_id, tenantId: row.tenant_id, userId: row.user_id }))
  }

  async claimSessionOwner(input: ClaimSessionOwnerInput): Promise<void> {
    await this.db.query(
      `INSERT INTO wiseai_session_owners (session_id, tenant_id, user_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (session_id) DO NOTHING`,
      [input.sessionId, input.tenantId, input.userId],
    )
  }

  async listWorkspaceOwners(): Promise<readonly TenantWorkspaceOwnerRecord[]> {
    const result = await this.db.query<WorkspaceOwnerRow>(
      `SELECT ${WORKSPACE_OWNER_COLUMNS} FROM wiseai_workspace_owners ORDER BY tenant_id, workspace_id`,
      [],
    )
    return result.rows.map(row => ({ workspaceId: row.workspace_id, tenantId: row.tenant_id, userId: row.user_id }))
  }

  async claimWorkspaceOwner(input: ClaimWorkspaceOwnerInput): Promise<void> {
    await this.db.query(
      `INSERT INTO wiseai_workspace_owners (workspace_id, tenant_id, user_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (workspace_id) DO NOTHING`,
      [input.workspaceId, input.tenantId, input.userId],
    )
  }
}
