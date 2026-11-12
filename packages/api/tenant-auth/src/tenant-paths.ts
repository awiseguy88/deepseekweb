/**
 * Per-tenant filesystem roots on the shared Railway volume. The policy keeps
 * every tenant inside its own directory, rejects traversal and symlink escapes,
 * and creates each root with owner-only permissions. The container user is the
 * same UID for all tenants, so this is application-level scoping; OS-level
 * separation needs per-tenant workers (see ROADMAP.md C2).
 * @module @deepseek-ai/dsh-api-tenant-auth/tenant-paths
 */

import { createHash } from 'node:crypto'
import { chmod, mkdir, realpath } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'

/** One deployment's per-tenant root policy. */
export interface TenantPaths {
  /** Absolute root for one tenant; the spelling is safe for a path segment. */
  root(tenantId: string): string
  /** Create (mode 700) and return the tenant's root. */
  ensure(tenantId: string): Promise<string>
  /**
   * Whether one path stays inside the tenant's root.
   * @param tenantId - authenticated tenant identity.
   * @param candidate - path to check; existing components are resolved through
   *   realpath so a symlink cannot escape the root.
   * @returns true when the path is inside the tenant root.
   */
  contains(tenantId: string, candidate: string): Promise<boolean>
}

const SAFE_SEGMENT = /^[A-Za-z0-9_-]{1,128}$/

/** Map an arbitrary tenant id to one safe directory segment. */
function segment(tenantId: string): string {
  return SAFE_SEGMENT.test(tenantId) ? tenantId : createHash('sha256').update(tenantId).digest('hex').slice(0, 32)
}

/**
 * Build the per-tenant root policy.
 * @param base - deployment volume directory; defaults to WISEAI_TENANT_ROOT.
 * @returns the root policy.
 */
export function createTenantPaths(base: string = process.env.WISEAI_TENANT_ROOT?.trim() || '/data/workspaces/tenants'): TenantPaths {
  const rootBase = resolve(base)
  const root = (tenantId: string): string => join(rootBase, segment(tenantId))
  return {
    root,
    async ensure(tenantId: string): Promise<string> {
      const directory = root(tenantId)
      await mkdir(directory, { recursive: true, mode: 0o700 })
      await chmod(directory, 0o700)
      return directory
    },
    async contains(tenantId: string, candidate: string): Promise<boolean> {
      const directory = root(tenantId)
      const target = resolve(candidate)
      try {
        const [resolvedTarget, resolvedRoot] = await Promise.all([realpath(target), realpath(directory)])
        return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(resolvedRoot + sep)
      } catch {
        // The target may not exist yet; lexical containment still blocks `..`.
        return target === directory || target.startsWith(directory + sep)
      }
    },
  }
}
