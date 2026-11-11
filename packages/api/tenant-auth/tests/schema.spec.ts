import { describe, expect, it } from 'vitest'
import { applyTenantAuthMigrations, type TenantAuthDatabase } from '../src/schema.ts'

/** Records every statement the loader executes. */
class RecordingDatabase implements TenantAuthDatabase {
  readonly statements: string[] = []

  async query<T extends Record<string, unknown>>(sql: string): Promise<{ readonly rows: readonly T[] }> {
    this.statements.push(sql)
    return { rows: [] }
  }
}

describe('tenant auth migrations', () => {
  it('executes semicolon-free DDL even when a comment contains a semicolon', async () => {
    const db = new RecordingDatabase()
    await applyTenantAuthMigrations(db)

    expect(db.statements.length).toBeGreaterThan(0)
    // A prose fragment from migration 003 must never reach PostgreSQL as SQL.
    expect(db.statements.some(statement => /^the\b/i.test(statement))).toBe(false)
    expect(db.statements.some(statement => statement.includes('wiseai_audit_events'))).toBe(true)
    expect(db.statements.some(statement => statement.includes('deleted_at'))).toBe(true)
    expect(db.statements.every(statement => !statement.startsWith('--'))).toBe(true)
  })
})
