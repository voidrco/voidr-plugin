import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const bootstrap = join(root, 'scripts/bootstrap-test-repository.mjs')

test('bootstraps a new test repository with explicit selected IDs', () => {
  const parent = mkdtempSync(join(tmpdir(), 'voidr-bootstrap-'))
  const target = join(parent, 'checkout-tests')
  const result = spawnSync(
    process.execPath,
    [
      bootstrap,
      '--target',
      target,
      '--name',
      'Checkout Tests',
      '--org-id',
      'org-explicit',
      '--app-id',
      'app-explicit',
      '--plan-id',
      '0123456789abcdef01234567',
      '--workspace-root',
      parent
    ],
    { encoding: 'utf8' }
  )
  assert.equal(result.status, 0, result.stderr)
  assert.equal(existsSync(join(target, 'playwright.config.js')), true)
  assert.equal(existsSync(join(target, 'playwright.config.cjs')), true)
  assert.equal(existsSync(join(target, 'modules', '.gitkeep')), true)
  assert.deepEqual(JSON.parse(readFileSync(join(target, 'project.json'))), {
    orgId: 'org-explicit',
    appId: 'app-explicit',
    testPlanId: '0123456789abcdef01234567'
  })
  const packageJson = JSON.parse(readFileSync(join(target, 'package.json')))
  assert.equal(packageJson.name, 'checkout-tests')
  assert.equal(
    packageJson.type,
    'commonjs',
    'Playwright 1.48 deadlocks on ESM test loading under Node 22.22'
  )
})

test('refuses to overwrite a non-empty destination', () => {
  const parent = mkdtempSync(join(tmpdir(), 'voidr-bootstrap-safe-'))
  const target = join(parent, 'existing-repo')
  const first = spawnSync(
    process.execPath,
    [
      bootstrap,
      '--target',
      target,
      '--org-id',
      'org-a',
      '--app-id',
      'app-a',
      '--plan-id',
      '0123456789abcdef01234567',
      '--workspace-root',
      parent
    ],
    { encoding: 'utf8' }
  )
  assert.equal(first.status, 0, first.stderr)
  writeFileSync(join(target, 'user-file.txt'), 'preserve me')

  const second = spawnSync(
    process.execPath,
    [
      bootstrap,
      '--target',
      target,
      '--org-id',
      'org-b',
      '--app-id',
      'app-b',
      '--plan-id',
      'abcdef0123456789abcdef01',
      '--workspace-root',
      parent
    ],
    { encoding: 'utf8' }
  )
  assert.notEqual(second.status, 0)
  assert.match(second.stderr, /Refusing to bootstrap a non-empty directory/)
  assert.equal(readFileSync(join(target, 'user-file.txt'), 'utf8'), 'preserve me')
})
