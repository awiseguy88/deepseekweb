import { Pool } from 'pg'
import { PostgresTenantAuthStore } from './postgres.ts'

/** Create the Railway-backed tenant store and its pool disposer. */
export function createPostgresTenantAuthStore(connectionString: string): {
  readonly store: PostgresTenantAuthStore
  readonly close: () => Promise<void>
} {
  if (!connectionString.startsWith('postgres://') && !connectionString.startsWith('postgresql://')) throw new Error('DATABASE_URL must be a PostgreSQL URL')
  const pool = new Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000 })
  return {
    store: new PostgresTenantAuthStore({ query: async (sql, parameters) => pool.query(sql, parameters) }),
    close: () => pool.end(),
  }
}
