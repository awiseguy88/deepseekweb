/** Tenant authentication contracts shared by the WiseAI host and API layers. */
export type {
  SalesEventInput,
  SalesEventRecord,
  SupportRequestInput,
  SupportRequestPatch,
  SupportRequestPriority,
  SupportRequestRecord,
  SupportRequestStatus,
  TenantAccountPatch,
  TenantAccountRecord,
  TenantAuthStore,
  TenantProfilePatch,
  TenantRecord,
  TenantRoots,
  TenantSessionListRecord,
  TenantSessionRecord,
  TenantUserRecord,
} from './types.ts'
export { tenantRoots } from './types.ts'
export { hashPassword, verifyPassword } from './password.ts'
export { issueSession, resolveSession, logoutSession } from './session-tokens.ts'
export { recordTenantFailure, retryTransient } from './failure-log.ts'
export type { RetryPolicy, TenantFailureRecord } from './failure-log.ts'
export { handleNodeAuthRequest, tenantAuthHandler } from './http.ts'
export type { TenantSessionRegistrar } from './http.ts'
export { apply, Config, inject, name } from './plugin.ts'
export type { Config as TenantAuthPluginConfig } from './plugin.ts'
export { createPostgresTenantAuthStore } from './pg-client.ts'
export { PostgresTenantAuthStore } from './postgres.ts'
export type { TenantAuthDatabase } from './postgres.ts'
export { applyTenantAuthMigrations } from './schema.ts'
export {
  adminApiResponse,
  handleAdminApi,
  handleSupportApi,
  resolveAdmin,
  resolvePlatformAdmin,
  resolveTenantAccount,
  supportApiResponse,
} from './admin-http.ts'
export { renderAdminPage } from './admin-page.ts'
export { handleAccountApi } from './account-http.ts'
export { renderAccountPage } from './account-page.ts'
export { createTenantAccess } from './tenant-access.ts'
export type { TenantAccess, TenantAccessOptions } from './tenant-access.ts'
export {
  createCheckoutLink,
  parseStripeEvent,
  stripeConfig,
  summarizeStripeEvent,
  verifyStripeSignature,
} from './stripe.ts'
