/** Tenant authentication contracts shared by the WiseAI host and API layers. */
export type { TenantAuthStore, TenantRoots, TenantSessionRecord, TenantUserRecord } from './types.ts'
export { tenantRoots } from './types.ts'
export { PostgresTenantAuthStore } from './postgres.ts'
export type { TenantAuthDatabase } from './postgres.ts'
