/** Database-facing tenant identity records. Values are intentionally opaque to callers. */
export interface TenantUserRecord {
  readonly userId: string
  readonly email: string
  readonly passwordHash: string
  readonly role: 'admin' | 'member'
  readonly tenantId: string
  readonly disabled: boolean
  /** Platform operator allowed to manage every tenant from the hosted admin surface. */
  readonly platformAdmin: boolean
  readonly createdAt: Date
  readonly lastSeenAt: Date | null
}

/** One customer tenant with its billing and access state. */
export interface TenantRecord {
  readonly tenantId: string
  readonly name: string
  /** Commercial plan label, for example `free`, `pro`, or `team`. */
  readonly plan: string
  /** Access state driven by the operator or the Stripe subscription webhook. */
  readonly status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'disabled'
  readonly disabled: boolean
  readonly stripeCustomerId: string | null
  readonly stripeSubscriptionId: string | null
  readonly accessUntil: Date | null
  readonly notes: string
  readonly createdAt: Date
  readonly updatedAt: Date
}

/** One user row joined with its tenant label, as rendered by the admin lists. */
export interface TenantAccountRecord {
  readonly userId: string
  readonly tenantId: string
  readonly tenantName: string
  readonly email: string
  readonly role: 'admin' | 'member'
  readonly platformAdmin: boolean
  readonly disabled: boolean
  readonly createdAt: Date
  readonly lastSeenAt: Date | null
}

/** A server-issued session bound to one user and tenant. */
export interface TenantSessionRecord {
  readonly sessionId: string
  readonly userId: string
  readonly tenantId: string
  readonly expiresAt: Date
  readonly revokedAt: Date | null
}

/** A listed session joined with its user and tenant labels. */
export interface TenantSessionListRecord {
  readonly sessionId: string
  readonly userId: string
  readonly tenantId: string
  readonly email: string
  readonly tenantName: string
  readonly expiresAt: Date
  readonly createdAt: Date
  readonly revokedAt: Date | null
}

/** State of a customer support request raised from the in-app Need Help control. */
export type SupportRequestStatus = 'open' | 'in_progress' | 'closed'

/** Priority assigned by the operator while triaging the support inbox. */
export type SupportRequestPriority = 'low' | 'normal' | 'high'

/** One support request joined with the customer that raised it. */
export interface SupportRequestRecord {
  readonly requestId: string
  readonly tenantId: string
  readonly tenantName: string
  readonly userId: string
  readonly email: string
  readonly subject: string
  readonly message: string
  readonly pageUrl: string
  readonly status: SupportRequestStatus
  readonly priority: SupportRequestPriority
  readonly adminNote: string
  readonly createdAt: Date
  readonly updatedAt: Date
}

/** One Stripe webhook fact retained for the admin sales ledger. */
export interface SalesEventRecord {
  readonly eventId: string
  readonly eventType: string
  readonly tenantId: string | null
  readonly customerId: string | null
  readonly subscriptionId: string | null
  readonly amountTotal: number | null
  readonly currency: string | null
  readonly status: string | null
  readonly createdAt: Date
}

/** Fields an operator may change on a tenant profile. */
export interface TenantProfilePatch {
  readonly name?: string
  readonly plan?: string
  readonly status?: TenantRecord['status']
  readonly disabled?: boolean
  readonly stripeCustomerId?: string | null
  readonly stripeSubscriptionId?: string | null
  readonly accessUntil?: Date | null
  readonly notes?: string
}

/** Fields an operator may change on one account. */
export interface TenantAccountPatch {
  readonly role?: 'admin' | 'member'
  readonly disabled?: boolean
  readonly passwordHash?: string
  readonly platformAdmin?: boolean
  /** Sign-in email; unique across the deployment. */
  readonly email?: string
}

/** Input accepted from a signed-in customer raising a support request. */
export interface SupportRequestInput {
  readonly tenantId: string
  readonly userId: string
  readonly subject: string
  readonly message: string
  readonly pageUrl: string
}

/** Fields an operator may change while triaging one support request. */
export interface SupportRequestPatch {
  readonly status?: SupportRequestStatus
  readonly priority?: SupportRequestPriority
  readonly adminNote?: string
}

/** Connection input for a Stripe webhook fact. */
export interface SalesEventInput {
  readonly eventId: string
  readonly eventType: string
  readonly tenantId: string | null
  readonly customerId: string | null
  readonly subscriptionId: string | null
  readonly amountTotal: number | null
  readonly currency: string | null
  readonly status: string | null
}

/** One appended administrative audit record. */
export interface AuditEventInput {
  /** Stable action name such as `customer.delete` or `session.revoke`. */
  readonly action: string
  readonly actorUserId: string
  readonly actorTenantId: string
  readonly targetTenantId?: string
  readonly targetId?: string
  /** Non-secret structured context, for example counts and previous status. */
  readonly details?: Readonly<Record<string, unknown>>
}

/** One persisted administrative audit record. */
export interface AuditEventRecord extends AuditEventInput {
  readonly eventId: string
  readonly createdAt: string
}

/** One Session recorded as owned by a tenant, as persisted. */
export interface TenantSessionOwnerRecord {
  readonly sessionId: string
  readonly tenantId: string
  readonly userId: string
}

/** One Workspace recorded as owned by a tenant, as persisted. */
export interface TenantWorkspaceOwnerRecord {
  readonly workspaceId: string
  readonly tenantId: string
  readonly userId: string
}

/** Input recording the tenant and user that own one Session. */
export interface ClaimSessionOwnerInput {
  readonly sessionId: string
  readonly tenantId: string
  readonly userId: string
}

/** Input recording the tenant and user that own one Workspace. */
export interface ClaimWorkspaceOwnerInput {
  readonly workspaceId: string
  readonly tenantId: string
  readonly userId: string
}

/**
 * The ownership members of {@link TenantAuthStore} narrowed to their required
 * form; a composition that partitions resources by tenant requires all four.
 */
export type TenantOwnershipStore = Required<Pick<
  TenantAuthStore,
  'listSessionOwners' | 'claimSessionOwner' | 'listWorkspaceOwners' | 'claimWorkspaceOwner'
>>

/** Namespaced filesystem roots; callers must resolve these from the authenticated tenant. */
export interface TenantRoots {
  readonly root: string
  readonly sessions: string
  readonly workspace: string
  readonly credentials: string
  readonly failures: string
}

/** One append-only usage fact produced by a run. */
export interface UsageEventInput {
  readonly tenantId: string
  readonly kind: 'llm' | 'compute' | 'storage' | 'tool'
  readonly sessionId?: string
  readonly provider?: string
  readonly model?: string
  readonly inputTokens?: number
  readonly outputTokens?: number
  readonly computeMs?: number
  readonly costMicrousd?: number
  /** Idempotency key for retried producers; a duplicate insert is ignored. */
  readonly idempotencyKey?: string
}

/** Aggregated usage for one tenant/kind/provider/model combination. */
export interface UsageSummaryRow {
  readonly tenantId: string
  readonly kind: string
  readonly provider: string | null
  readonly model: string | null
  readonly events: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly computeMs: number
  readonly costMicrousd: number
}

/** One usage aggregation window. */
export interface UsageSummaryFilter {
  readonly tenantId?: string
  readonly since?: Date
}

/** Database readiness evidence for the hosted health endpoint. */
export interface TenantStoreHealth {
  /** The tenant table answers a query. */
  readonly tenants: boolean
  /** Migration 004's soft-delete column exists. */
  readonly deletedAt: boolean
  /** Migration 004's audit table exists. */
  readonly auditEvents: boolean
  /** Migration 005/006's billing inbox and ordering column exist. */
  readonly billingEvents: boolean
  /** Migration 007's usage metering table exists. */
  readonly usageEvents: boolean
  /** The session-admission entitlement query binds and executes. */
  readonly sessionAdmission: boolean
}

/** One verified Stripe event claimed for processing. */
export interface BillingEventInput {
  readonly eventId: string
  readonly eventType: string
  /** Stripe's event creation time; retained for lifecycle ordering diagnostics. */
  readonly eventCreated?: Date | null
}

/**
 * Persistence seam for tenant identity plus the hosted-admin extensions.
 * Every method resolves the tenant from a trusted server-side identity; no
 * caller may pass a browser-supplied tenant id.
 */
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

  /** Create a customer tenant together with its first administrator. */
  createTenant(input: {
    readonly name: string
    readonly plan: string
    readonly adminEmail: string
    readonly adminPasswordHash: string
    readonly platformAdmin?: boolean
  }): Promise<{ tenantId: string; userId: string }>
  findTenantById(tenantId: string): Promise<TenantRecord | null>
  listTenants(): Promise<readonly TenantRecord[]>
  updateTenant(tenantId: string, patch: TenantProfilePatch): Promise<TenantRecord | null>
  /** Add one account to an existing tenant. Throws on a duplicate tenant-local email. */
  createUserInTenant(input: {
    readonly tenantId: string
    readonly email: string
    readonly passwordHash: string
    readonly role: 'admin' | 'member'
    readonly platformAdmin?: boolean
  }): Promise<{ userId: string }>
  listAccounts(tenantId: string): Promise<readonly TenantAccountRecord[]>
  listAllAccounts(): Promise<readonly TenantAccountRecord[]>
  findAccountById(userId: string): Promise<TenantAccountRecord | null>
  updateAccount(userId: string, patch: TenantAccountPatch): Promise<TenantAccountRecord | null>
  /** Mark a user as recently active and grant platform-operator rights to the bootstrap email. */
  recordLogin(userId: string): Promise<void>
  listSessions(filter?: { readonly tenantId?: string; readonly activeOnly?: boolean }): Promise<readonly TenantSessionListRecord[]>
  createSupportRequest(input: SupportRequestInput): Promise<SupportRequestRecord>
  listSupportRequests(filter?: { readonly status?: SupportRequestStatus; readonly tenantId?: string; readonly limit?: number }): Promise<readonly SupportRequestRecord[]>
  updateSupportRequest(requestId: string, patch: SupportRequestPatch): Promise<SupportRequestRecord | null>
  recordSalesEvent(input: SalesEventInput): Promise<void>
  listSalesEvents(limit?: number): Promise<readonly SalesEventRecord[]>
  /** Delete one customer tenant; its users, sessions, and support rows cascade. */
  deleteTenant(tenantId: string): Promise<boolean>
  /** Recoverable deletion: disable the tenant and stamp deleted_at without removing rows. */
  softDeleteTenant(tenantId: string): Promise<boolean>
  /** Append one immutable administrative audit record. */
  recordAuditEvent(input: AuditEventInput): Promise<void>
  /** Read newest audit records, optionally scoped to one target tenant. */
  listAuditEvents(filter?: { readonly tenantId?: string; readonly limit?: number }): Promise<readonly AuditEventRecord[]>
  /** Report schema readiness without requiring authentication. */
  health?(): Promise<TenantStoreHealth>
  /**
   * Claim one verified Stripe event for processing.
   * @param input - verified event identity.
   * @returns `claimed` when this delivery must apply state (including a retry
   * after failure), or `duplicate` when the event is already processed or in
   * flight and the webhook should acknowledge without reapplying it.
   */
  beginBillingEvent(input: BillingEventInput): Promise<'claimed' | 'duplicate'>
  /**
   * Record the terminal state of a claimed event.
   * @param eventId - verified event identity.
   * @param status - processed or failed.
   * @param error - failure detail stored without secrets.
   */
  finishBillingEvent(eventId: string, status: 'processed' | 'failed', error?: string): Promise<void>
  /** Attach the resolved tenant to a claimed billing event. */
  noteBillingEventTenant(eventId: string, tenantId: string): Promise<void>
  /**
   * Whether the tenant already has a processed event newer than this delivery.
   * @param tenantId - resolved customer tenant.
   * @param eventCreated - this event's Stripe creation time.
   * @returns true when the delivery is stale and must not change tenant state.
   */
  billingEventIsStale(tenantId: string, eventCreated: Date | null): Promise<boolean>
  /** Append one usage fact; a repeated idempotency key is ignored. */
  recordUsageEvent(input: UsageEventInput): Promise<void>
  /** Aggregate stored usage, optionally for one tenant and window. */
  usageSummary(filter?: UsageSummaryFilter): Promise<readonly UsageSummaryRow[]>
  /** Revoke every live login session, optionally for one tenant or account. */
  revokeSessions(filter?: { readonly tenantId?: string; readonly userId?: string }): Promise<number>
  /** Delete revoked login-session rows, optionally for one tenant. */
  purgeRevokedSessions(filter?: { readonly tenantId?: string }): Promise<number>

  /*
   * Tenant ownership of Sessions and Workspaces. Optional so an identity-only
   * store (and its test doubles) keeps satisfying this seam; a composition
   * that mounts tenant access requires the {@link TenantOwnershipStore}
   * members and fails loud at startup when they are absent.
   */
  /** @returns every persisted Session owner, in any order. */
  listSessionOwners?(): Promise<readonly TenantSessionOwnerRecord[]>
  /**
   * Record one Session owner; an existing claim keeps its owner.
   * @param input - the created Session and its tenant and user.
   */
  claimSessionOwner?(input: ClaimSessionOwnerInput): Promise<void>
  /** @returns every persisted Workspace owner, in any order. */
  listWorkspaceOwners?(): Promise<readonly TenantWorkspaceOwnerRecord[]>
  /**
   * Record one Workspace owner; an existing claim keeps its owner.
   * @param input - the created Workspace and its tenant and user.
   */
  claimWorkspaceOwner?(input: ClaimWorkspaceOwnerInput): Promise<void>
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
