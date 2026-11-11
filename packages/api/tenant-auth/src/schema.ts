/**
 * Schema bootstrap for the hosted WiseAI administration surface.
 *
 * The deployment's PostgreSQL database is created from `migrations/*.sql`. The
 * plugin applies the full, idempotent set on startup so a fresh Railway
 * database and an existing tenant database converge without a manual step.
 *
 * @module @deepseek-ai/dsh-api-tenant-auth/schema
 */

import { readdir, readFile } from 'node:fs/promises'
import type { TenantAuthDatabase } from './postgres.ts'

const MIGRATIONS_DIR = new URL('../migrations/', import.meta.url)

/**
 * Execute every migration file in lexical order.
 *
 * Statements are split on `;` because the migration set contains only plain
 * DDL; a future migration with a function body or a quoted semicolon must be
 * split by its author instead of relying on this helper.
 * @param db - query surface of the deployment database.
 * @returns when every migration has been applied.
 */
export async function applyTenantAuthMigrations(db: TenantAuthDatabase): Promise<void> {
  const names = (await readdir(MIGRATIONS_DIR))
    .filter(name => name.endsWith('.sql'))
    .sort((left, right) => left.localeCompare(right))
  for (const name of names) {
    const sql = await readFile(new URL(name, MIGRATIONS_DIR), 'utf8')
    // Strip line comments before splitting: prose comments may contain a
    // semicolon (for example "wins; the policy ..."), and the splitter below
    // only understands semicolon-separated DDL.
    const withoutComments = sql.split('\n')
      .filter(line => !line.trimStart().startsWith('--'))
      .join('\n')
    for (const statement of withoutComments.split(';').map(part => part.trim()).filter(part => part.length > 0)) {
      await db.query(statement, [])
    }
  }
}
