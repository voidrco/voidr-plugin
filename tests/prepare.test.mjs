import test from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  writeFileSync
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prepareTestRepository } from '../scripts/lib/prepare.mjs'

const context = {
  organizationId: 'org-synthetic',
  applicationId: 'app-synthetic',
  testPlanId: '0123456789abcdef01234567',
  environmentSlug: 'staging',
  cases: ['LOGIN-001', 'LOGIN-002', 'LOGIN-001']
}

test('prepares a cloned repository in the mandatory order without interactive login', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'voidr-prepare-'))
  const repositoryPath = createRepository(workspace)
  const secret = 'synthetic-prepare-secret'
  const calls = []

  const result = await prepareTestRepository({
    repositoryPath,
    ...context,
    workspaceRoot: workspace,
    cliEnvironment: {
      VOIDR_CLIENT_ID: 'sa_synthetic_prepare',
      VOIDR_CLIENT_SECRET: secret,
      VOIDR_ORG_ID: context.organizationId,
      VOIDR_API_URL: 'https://preview.example.test/v1'
    },
    run: fakeVoidrRun({ repositoryPath, calls, context })
  })

  assert.deepEqual(
    calls.map(call => [call.file, ...call.args]),
    [
      ['npm', 'install'],
      [
        'npx',
        '--no-install',
        'voidr',
        'link',
        '--org-id',
        context.organizationId,
        '--app-id',
        context.applicationId,
        '--plan-id',
        context.testPlanId,
        '--yes'
      ],
      [
        'npx',
        '--no-install',
        'voidr',
        'scaffold',
        '--split-per-case',
        '--cases',
        'LOGIN-001,LOGIN-002'
      ],
      [
        'npx',
        '--no-install',
        'voidr',
        'env',
        'pull',
        '--env',
        context.environmentSlug,
        '--output',
        '.env'
      ]
    ]
  )
  assert.equal(
    calls.some(call => call.args.includes('login')),
    false,
    'interactive voidr login must never run'
  )
  assert.equal(calls[1].options.env.VOIDR_CLIENT_SECRET, secret)
  assert.equal(calls[2].options.env.VOIDR_CLIENT_SECRET, secret)
  assert.equal(calls[3].options.env.VOIDR_CLIENT_SECRET, secret)
  assert.equal(JSON.stringify(result).includes(secret), false)
  assert.equal(result.steps.authenticationResolvedFromPluginServiceAccount, true)
  assert.equal(result.steps.interactiveLoginExecuted, false)
  assert.equal(result.steps.linked, true)
  assert.equal(result.specCount, 1)
})

test('validates an existing project and skips link', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'voidr-prepare-linked-'))
  const repositoryPath = createRepository(workspace)
  writeProject(repositoryPath, context)
  const calls = []

  const result = await prepareTestRepository({
    repositoryPath,
    ...context,
    workspaceRoot: workspace,
    cliEnvironment: {
      VOIDR_CLIENT_ID: 'sa_synthetic_linked',
      VOIDR_CLIENT_SECRET: 'synthetic-linked-secret',
      VOIDR_ORG_ID: context.organizationId
    },
    run: fakeVoidrRun({ repositoryPath, calls, context })
  })

  assert.deepEqual(
    calls.map(call => [call.file, ...call.args.slice(0, 3)]),
    [
      ['npm', 'install'],
      ['npx', '--no-install', 'voidr', 'scaffold'],
      ['npx', '--no-install', 'voidr', 'env']
    ]
  )
  assert.equal(result.steps.linked, false)
  assert.equal(result.steps.existingProjectValidated, true)
})

test('fails closed on a mismatched project before running setup commands', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'voidr-prepare-mismatch-'))
  const repositoryPath = createRepository(workspace)
  writeProject(repositoryPath, {
    ...context,
    applicationId: 'another-application'
  })
  const calls = []

  await assert.rejects(
    prepareTestRepository({
      repositoryPath,
      ...context,
      workspaceRoot: workspace,
      cliEnvironment: {
        VOIDR_CLIENT_ID: 'sa_synthetic_mismatch',
        VOIDR_CLIENT_SECRET: 'synthetic-mismatch-secret',
        VOIDR_ORG_ID: context.organizationId
      },
      run: fakeVoidrRun({ repositoryPath, calls, context })
    }),
    /appId/
  )
  assert.deepEqual(calls, [])
})

test('rejects a Service Account selected for another organization', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'voidr-prepare-org-'))
  const repositoryPath = createRepository(workspace)
  const calls = []

  await assert.rejects(
    prepareTestRepository({
      repositoryPath,
      ...context,
      workspaceRoot: workspace,
      cliEnvironment: {
        VOIDR_CLIENT_ID: 'sa_synthetic_other_org',
        VOIDR_CLIENT_SECRET: 'synthetic-other-org-secret',
        VOIDR_ORG_ID: 'org-other'
      },
      run: fakeVoidrRun({ repositoryPath, calls, context })
    }),
    /different organization/
  )
  assert.deepEqual(
    calls.map(call => [call.file, ...call.args]),
    [['npm', 'install']],
    'dependency installation happens before framework authentication resolution'
  )
})

test('accepts a provisioned checkout outside the MCP process cwd when origin matches', async () => {
  const checkoutParent = mkdtempSync(join(tmpdir(), 'voidr-provisioned-'))
  const unrelatedServerCwd = mkdtempSync(join(tmpdir(), 'voidr-server-cwd-'))
  const repositoryPath = createRepository(checkoutParent)
  const repositoryUrl =
    'https://github.com/voidrco/voidr-tp-synthetic-01234567.git'
  initializeOrigin(repositoryPath, repositoryUrl)
  const calls = []

  const result = await prepareTestRepository({
    repositoryPath,
    ...context,
    repositoryUrl,
    workspaceRoot: unrelatedServerCwd,
    cliEnvironment: {
      VOIDR_CLIENT_ID: 'sa_synthetic_provisioned',
      VOIDR_CLIENT_SECRET: 'synthetic-provisioned-secret',
      VOIDR_ORG_ID: context.organizationId
    },
    run: fakeVoidrRun({ repositoryPath, calls, context })
  })

  assert.equal(result.completed, true)
  assert.equal(result.repositoryPath, realpathSync(repositoryPath))
})

test('rejects a checkout whose origin does not match the Voidr repository', async () => {
  const checkoutParent = mkdtempSync(join(tmpdir(), 'voidr-wrong-origin-'))
  const repositoryPath = createRepository(checkoutParent)
  initializeOrigin(
    repositoryPath,
    'https://github.com/voidrco/a-different-repository.git'
  )

  await assert.rejects(
    prepareTestRepository({
      repositoryPath,
      ...context,
      repositoryUrl:
        'https://github.com/voidrco/voidr-tp-synthetic-01234567.git',
      workspaceRoot: mkdtempSync(join(tmpdir(), 'voidr-server-cwd-')),
      cliEnvironment: {
        VOIDR_CLIENT_ID: 'sa_synthetic_wrong_origin',
        VOIDR_CLIENT_SECRET: 'synthetic-wrong-origin-secret',
        VOIDR_ORG_ID: context.organizationId
      },
      run: async () => {
        throw new Error('setup must not run for a mismatched origin')
      }
    }),
    /origin does not match/
  )
})

function createRepository(workspace) {
  const repositoryPath = join(workspace, 'tests')
  mkdirSync(repositoryPath)
  writeFileSync(
    join(repositoryPath, 'package.json'),
    JSON.stringify({
      name: 'synthetic-tests',
      devDependencies: { '@voidr/playwright-framework': '0.0.0-test' }
    })
  )
  return repositoryPath
}

function initializeOrigin(repositoryPath, repositoryUrl) {
  const initialized = spawnSync('git', ['init', repositoryPath], {
    encoding: 'utf8'
  })
  assert.equal(initialized.status, 0, initialized.stderr)
  const remote = spawnSync(
    'git',
    ['-C', repositoryPath, 'remote', 'add', 'origin', repositoryUrl],
    { encoding: 'utf8' }
  )
  assert.equal(remote.status, 0, remote.stderr)
}

function writeProject(repositoryPath, values) {
  writeFileSync(
    join(repositoryPath, 'project.json'),
    JSON.stringify({
      orgId: values.organizationId,
      appId: values.applicationId,
      testPlanId: values.testPlanId
    })
  )
}

function fakeVoidrRun({ repositoryPath, calls, context: selected }) {
  return async (file, args, options) => {
    calls.push({ file, args, options })
    if (args.includes('link')) writeProject(repositoryPath, selected)
    if (args.includes('scaffold')) {
      const suite = join(repositoryPath, 'modules', 'login', 'login')
      mkdirSync(suite, { recursive: true })
      writeFileSync(join(suite, 'login-001.spec.js'), 'test.skip("LOGIN-001")')
    }
    if (args.includes('pull')) {
      writeFileSync(join(repositoryPath, '.env'), 'SYNTHETIC_KEY=placeholder')
    }
    return { stdout: '' }
  }
}
