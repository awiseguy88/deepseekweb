import { mkdtemp, mkdir, rm, stat, symlink, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createTenantPaths } from '../src/tenant-paths.ts'

const roots: string[] = []

async function fixture() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'wiseai-tenants-')))
  roots.push(base)
  return { base, paths: createTenantPaths(base) }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('tenant path policy', () => {
  it('maps tenant ids to a directory below the configured root', async () => {
    const { base, paths } = await fixture()
    expect(paths.root('tenant_a')).toBe(join(base, 'tenant_a'))
    const unsafe = paths.root('a/../../escape')
    expect(unsafe.startsWith(base)).toBe(true)
    expect(unsafe).not.toContain('..')
    expect(unsafe.slice(base.length + 1)).toMatch(/^[a-f0-9]{32}$/)
  })

  it('creates the root with owner-only permissions off Windows', async () => {
    const { paths } = await fixture()
    const root = await paths.ensure('tenant_a')
    const info = await stat(root)
    expect(info.isDirectory()).toBe(true)
    if (process.platform !== 'win32') expect(info.mode & 0o777).toBe(0o700)
  })

  it('accepts paths inside the tenant root and rejects siblings and traversal', async () => {
    const { base, paths } = await fixture()
    const root = await paths.ensure('tenant_a')
    await mkdir(join(root, 'project'))
    expect(await paths.contains('tenant_a', join(root, 'project', 'file.txt'))).toBe(true)
    expect(await paths.contains('tenant_a', join(base, 'tenant_b'))).toBe(false)
    expect(await paths.contains('tenant_a', join(root, '..', 'tenant_b'))).toBe(false)
  })

  it('resolves a symlink pointing outside the tenant root and rejects it', async () => {
    if (process.platform === 'win32') return
    const { base, paths } = await fixture()
    const root = await paths.ensure('tenant_a')
    const outside = join(base, 'outside')
    await mkdir(outside)
    await symlink(outside, join(root, 'escape'))
    expect(await paths.contains('tenant_a', join(root, 'escape'))).toBe(false)
  })
})
