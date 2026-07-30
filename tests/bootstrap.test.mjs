import test from 'node:test'
import assert from 'node:assert/strict'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync
} from 'node:fs'
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

test('initializes the exact Git repository provisioned by Voidr', async () => {
  const parent = mkdtempSync(join(tmpdir(), 'voidr-bootstrap-provisioned-'))
  const target = join(parent, 'provisioned-tests')
  const repositoryUrl = 'https://github.com/acme/provisioned-tests'
  const initialized = spawnSync('git', ['init', target], { encoding: 'utf8' })
  assert.equal(initialized.status, 0, initialized.stderr)
  const remote = spawnSync(
    'git',
    ['-C', target, 'remote', 'add', 'origin', `${repositoryUrl}.git`],
    { encoding: 'utf8' }
  )
  assert.equal(remote.status, 0, remote.stderr)
  writeFileSync(join(target, 'README.md'), '# Provisioned by Voidr\n')

  const { bootstrapTestRepository } = await import(
    '../scripts/lib/bootstrap.mjs'
  )
  const result = bootstrapTestRepository({
    target,
    name: 'Provisioned Tests',
    organizationId: 'org-preview',
    applicationId: 'app-preview',
    testPlanId: '0123456789abcdef01234567',
    allowExistingGitRepository: true,
    repositoryUrl,
    workspaceRoot: parent
  })

  assert.equal(result.target, realpathSync(target))
  assert.equal(
    readFileSync(join(target, 'README.md'), 'utf8'),
    '# Provisioned by Voidr\n'
  )
  assert.equal(existsSync(join(target, 'playwright.config.js')), true)
})

test('rejects a checkout whose origin differs from the provisioned repository', async () => {
  const parent = mkdtempSync(join(tmpdir(), 'voidr-bootstrap-wrong-origin-'))
  const target = join(parent, 'wrong-origin')
  assert.equal(
    spawnSync('git', ['init', target], { encoding: 'utf8' }).status,
    0
  )
  assert.equal(
    spawnSync(
      'git',
      [
        '-C',
        target,
        'remote',
        'add',
        'origin',
        'https://github.com/acme/another-repository.git'
      ],
      { encoding: 'utf8' }
    ).status,
    0
  )

  const { bootstrapTestRepository } = await import(
    '../scripts/lib/bootstrap.mjs'
  )
  assert.throws(
    () =>
      bootstrapTestRepository({
        target,
        organizationId: 'org-preview',
        applicationId: 'app-preview',
        testPlanId: '0123456789abcdef01234567',
        allowExistingGitRepository: true,
        repositoryUrl: 'https://github.com/acme/provisioned-tests',
        workspaceRoot: parent
      }),
    /origin does not match/
  )
})
