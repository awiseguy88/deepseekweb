import { Pool } from 'pg'
import { PostgresTenantAuthStore } from './postgres.ts'
import { applyTenantAuthMigrations } from './schema.ts'
import type { TenantAuthDatabase } from './postgres.ts'

/** Create the Railway-backed tenant store, its pool disposer, and schema bootstrap. */
export function createPostgresTenantAuthStore(connectionString: string): {
  readonly store: PostgresTenantAuthStore
  readonly close: () => Promise<void>
  readonly migrate: () => Promise<void>
} {
  if (!connectionString.startsWith('postgres://') && !connectionString.startsWith('postgresql://')) throw new Error('DATABASE_URL must be a PostgreSQL URL')
  const pool = new Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000 })
  const database: TenantAuthDatabase = {
    query: (sql, parameters) => pool.query(sql, [...parameters]),
  }
  return {
    store: new PostgresTenantAuthStore(database),
    close: () => pool.end(),
    migrate: () => applyTenantAuthMigrations(database),
  }
}
