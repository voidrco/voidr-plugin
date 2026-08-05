import test from 'node:test'
import assert from 'node:assert/strict'
import {
  existsSync,
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
      ['node', '--version'],
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
  assert.equal(calls[2].options.env.VOIDR_CLIENT_SECRET, secret)
  assert.equal(calls[3].options.env.VOIDR_CLIENT_SECRET, secret)
  assert.equal(calls[4].options.env.VOIDR_CLIENT_SECRET, secret)
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
      ['node', '--version'],
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
    [
      ['node', '--version'],
      ['npm', 'install']
    ],
    'dependency installation happens before framework authentication resolution'
  )
})

test('locates the provisioned checkout by origin anywhere inside the workspace', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'voidr-provisioned-'))
  const repositoryPath = createRepository(workspace)
  const repositoryUrl =
    'https://github.com/voidrco/voidr-tp-synthetic-01234567.git'
  initializeOrigin(repositoryPath, repositoryUrl)
  const calls = []

  const result = await prepareTestRepository({
    // The model's belief about the path is irrelevant: the tool locates the
    // checkout by Git origin.
    repositoryPath: join(workspace, 'some-wrong-guess'),
    ...context,
    repositoryUrl,
    workspaceRoot: workspace,
    cliEnvironment: {
      VOIDR_CLIENT_ID: 'sa_synthetic_provisioned',
      VOIDR_CLIENT_SECRET: 'synthetic-provisioned-secret',
      VOIDR_ORG_ID: context.organizationId
    },
    run: fakeVoidrRun({ repositoryPath, calls, context })
  })

  assert.equal(result.completed, true)
  assert.equal(result.repositoryPath, realpathSync(repositoryPath))
  assert.equal(result.checkoutSource, 'existing-checkout')
  assert.equal(
    calls.some(call => call.args.includes('clone')),
    false
  )
})

test('rejects a provisioned checkout outside the open workspace', async () => {
  const outsideParent = mkdtempSync(join(tmpdir(), 'voidr-outside-'))
  const workspace = mkdtempSync(join(tmpdir(), 'voidr-real-root-'))
  const repositoryPath = createRepository(outsideParent)
  const repositoryUrl =
    'https://github.com/voidrco/voidr-tp-synthetic-01234567.git'
  initializeOrigin(repositoryPath, repositoryUrl)

  await assert.rejects(
    prepareTestRepository({
      repositoryPath,
      ...context,
      repositoryUrl,
      workspaceRoot: workspace,
      cliEnvironment: {
        VOIDR_CLIENT_ID: 'sa_synthetic_outside',
        VOIDR_CLIENT_SECRET: 'synthetic-outside-secret',
        VOIDR_ORG_ID: context.organizationId
      },
      run: async () => {
        throw new Error('setup must not run for an external checkout')
      }
    }),
    /inside the open workspace/
  )
})

test('rejects a stale destination that is not a checkout of the linked repository', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'voidr-stale-'))
  const repositoryPath = createRepository(workspace)
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
      workspaceRoot: workspace,
      cliEnvironment: {
        VOIDR_CLIENT_ID: 'sa_synthetic_wrong_origin',
        VOIDR_CLIENT_SECRET: 'synthetic-wrong-origin-secret',
        VOIDR_ORG_ID: context.organizationId
      },
      run: async () => {
        throw new Error('setup must not run for a stale destination')
      }
    }),
    /never clones it[\s\S]*git clone/
  )
})

test('asks the user to clone the linked repository instead of cloning it', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'voidr-clone-'))
  const destination = join(workspace, 'tests')
  const repositoryUrl =
    'https://github.com/voidrco/voidr-tp-synthetic-01234567.git'
  const calls = []

  await assert.rejects(
    prepareTestRepository({
      repositoryPath: destination,
      ...context,
      repositoryUrl,
      workspaceRoot: workspace,
      cliEnvironment: {
        VOIDR_CLIENT_ID: 'sa_synthetic_clone',
        VOIDR_CLIENT_SECRET: 'synthetic-clone-secret',
        VOIDR_ORG_ID: context.organizationId
      },
      run: async (file, args) => {
        calls.push([file, ...args])
        // The only command a missing checkout may run is the read-only lookup of
        // the GitHub account the administrator has to authorize.
        return file === 'gh' ? { stdout: 'synthetic-dev\n' } : { stdout: '' }
      }
    }),
    error => {
      // Both protocols, because a corporate Windows machine uses the credential
      // manager over HTTPS while other developers already have an SSH key.
      assert.match(
        error.message,
        /HTTPS: git clone https:\/\/github\.com\/voidrco\/voidr-tp-synthetic-01234567\.git/
      )
      assert.match(
        error.message,
        /SSH: git clone git@github\.com:voidrco\/voidr-tp-synthetic-01234567\.git/
      )
      // The retry only works when the checkout lands where it is looked for.
      assert.match(error.message, /inside the open workspace/)
      // A failed clone is the access answer, and it is requested from Voidr.
      assert.match(error.message, /not authorized on this repository/)
      // The person who unblocks it is named, and so is the account to authorize.
      assert.match(
        error.message,
        /granted by an administrator of the user's own organization in the Voidr platform/
      )
      assert.match(error.message, /GitHub account synthetic-dev/)
      assert.match(error.message, /Never clone it from the agent terminal/)
      return true
    }
  )

  // Nothing else ran: no clone, and no setup on a repository that is not there.
  assert.deepEqual(calls, [['gh', 'api', 'user', '--jq', '.login']])
  assert.equal(existsSync(destination), false)
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
    if (file === 'node' && args[0] === '--version') {
      return { stdout: 'v22.22.0\n' }
    }
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
