import test from 'node:test'
import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
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
      // The clone is attempted and fails, which is the access check: the
      // handover then carries the commands and the authorization instructions.
      run: async file => {
        if (file === 'git') throw new Error('fatal: repository not found')
        return { stdout: '' }
      }
    }),
    /could not be cloned[\s\S]*git clone/
  )
})

test('hands the clone commands over when git cannot clone it', async () => {
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
        // The clone is attempted first; this machine cannot read the repository,
        // so the handover takes over with the commands and the authorization
        // instructions.
        if (file === 'git') throw new Error('fatal: repository not found')
        return file === 'gh' ? { stdout: 'synthetic-dev\n' } : { stdout: '' }
      }
    }),
    error => {
      // Both protocols, because a corporate Windows machine uses the credential
      // manager over HTTPS while other developers already have an SSH key.
      // Both commands carry an absolute destination inside the workspace: a
      // relative one would land wherever the user's terminal happens to be, and
      // the retry only finds a checkout inside the workspace.
      for (const [protocol, source] of [
        ['HTTPS', 'https://github.com/voidrco/voidr-tp-synthetic-01234567.git'],
        ['SSH', 'git@github.com:voidrco/voidr-tp-synthetic-01234567.git']
      ]) {
        const command = error.message
          .split('\n')
          .find(line => line.startsWith(`${protocol}: `))
        assert.ok(command, protocol)
        assert.ok(command.includes(`git clone ${source} `), protocol)
        assert.ok(command.includes(workspace), protocol)
        assert.match(command, /"[^"]+"$/, protocol)
      }
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
      return true
    }
  )

  // The clone was attempted, and no setup ran on a repository that is not there.
  // The destination is compared by suffix: macOS resolves the temp workspace
  // through /private, so an equality check would assert the platform.
  assert.equal(calls.length, 2)
  const [gitCall, ghCall] = calls
  assert.deepEqual(gitCall.slice(0, 3), [
    'git',
    'clone',
    'https://github.com/voidrco/voidr-tp-synthetic-01234567.git'
  ])
  assert.ok(gitCall[3].endsWith('voidr-tp-synthetic-01234567'), gitCall[3])
  assert.deepEqual(ghCall, ['gh', 'api', 'user', '--jq', '.login'])
  assert.equal(existsSync(destination), false)
})

test('raises a test budget that is tied to the action budget, so a failed run keeps its trace', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'voidr-prepare-'))
  const repositoryPath = createRepository(workspace)
  writeRunnerConfig(repositoryPath, { timeout: 40000, actionTimeout: 40000, navigationTimeout: 40000 })

  const result = await prepareTestRepository({
    repositoryPath,
    ...context,
    workspaceRoot: workspace,
    cliEnvironment: syntheticCliEnvironment(),
    run: fakeVoidrRun({ repositoryPath, calls: [], context })
  })

  assert.equal(result.steps.runnerTimeouts.adjusted, true)
  assert.equal(result.steps.runnerTimeouts.previousTestTimeout, 40000)
  assert.equal(result.steps.runnerTimeouts.testTimeout, 80000)

  const written = readFileSync(join(repositoryPath, 'voidr.runner.config.mjs'), 'utf8')
  assert.match(written, /^ {2}timeout: 80000,$/m)
  assert.match(written, /actionTimeout: 40000/)
  assert.match(written, /navigationTimeout: 40000/)
})

test('leaves a repository alone when its test budget already clears the step budgets', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'voidr-prepare-'))
  const repositoryPath = createRepository(workspace)
  writeRunnerConfig(repositoryPath, { timeout: 90000, actionTimeout: 30000, navigationTimeout: 45000 })
  const before = readFileSync(join(repositoryPath, 'voidr.runner.config.mjs'), 'utf8')

  const result = await prepareTestRepository({
    repositoryPath,
    ...context,
    workspaceRoot: workspace,
    cliEnvironment: syntheticCliEnvironment(),
    run: fakeVoidrRun({ repositoryPath, calls: [], context })
  })

  assert.equal(result.steps.runnerTimeouts.adjusted, false)
  assert.equal(result.steps.runnerTimeouts.reason, 'already-diagnosable')
  assert.equal(readFileSync(join(repositoryPath, 'voidr.runner.config.mjs'), 'utf8'), before)
})

function syntheticCliEnvironment() {
  return {
    VOIDR_CLIENT_ID: 'sa_synthetic_prepare',
    VOIDR_CLIENT_SECRET: 'synthetic-prepare-secret',
    VOIDR_ORG_ID: context.organizationId,
    VOIDR_API_URL: 'https://preview.example.test/v1'
  }
}

function writeRunnerConfig(repositoryPath, { timeout, actionTimeout, navigationTimeout }) {
  writeFileSync(
    join(repositoryPath, 'voidr.runner.config.mjs'),
    [
      "import { defineConfig } from '@playwright/test'",
      '',
      'export default defineConfig({',
      "  testMatch: ['**/*.spec.js'],",
      '  retries: 0,',
      `  timeout: ${timeout},`,
      '  expect: { timeout: 15000 },',
      '  workers: 1,',
      '  use: {',
      "    trace: 'on',",
      `    actionTimeout: ${actionTimeout},`,
      `    navigationTimeout: ${navigationTimeout},`,
      '  }',
      '})',
      ''
    ].join('\n'),
    'utf8'
  )
}

test('installs dependencies when the tree does not match the lockfile', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'voidr-prepare-'))
  const repositoryPath = createRepository(workspace)
  writeFileSync(join(repositoryPath, 'package-lock.json'), '{}')
  const calls = []

  const result = await prepareTestRepository({
    repositoryPath,
    ...context,
    workspaceRoot: workspace,
    cliEnvironment: syntheticCliEnvironment(),
    run: fakeVoidrRun({ repositoryPath, calls, context })
  })

  assert.equal(
    calls.some(call => call.file === 'npm' && call.args?.includes('install')),
    true
  )
  assert.equal(result.steps.dependenciesInstalled, true)
  assert.equal(result.steps.dependenciesAlreadyCurrent, false)
})

test('skips the install when npm already recorded this lockfile', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'voidr-prepare-'))
  const repositoryPath = createRepository(workspace)
  writeFileSync(join(repositoryPath, 'package-lock.json'), '{}')
  // npm writes this record after installing; newer than the lockfile means the
  // tree already matches it.
  mkdirSync(join(repositoryPath, 'node_modules'), { recursive: true })
  writeFileSync(join(repositoryPath, 'node_modules', '.package-lock.json'), '{}')
  const calls = []

  const result = await prepareTestRepository({
    repositoryPath,
    ...context,
    workspaceRoot: workspace,
    cliEnvironment: syntheticCliEnvironment(),
    run: fakeVoidrRun({ repositoryPath, calls, context })
  })

  assert.equal(
    calls.some(call => call.file === 'npm' && call.args?.includes('install')),
    false,
    'the slowest step must not run when nothing changed'
  )
  assert.equal(result.steps.dependenciesInstalled, false)
  assert.equal(result.steps.dependenciesAlreadyCurrent, true)
})

test('scaffolds only the selected cases that have no spec yet', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'voidr-prepare-'))
  const repositoryPath = createRepository(workspace)
  // LOGIN-001 is already implemented; LOGIN-002 is not there at all.
  const suite = join(repositoryPath, 'modules', 'login', 'login')
  mkdirSync(suite, { recursive: true })
  writeFileSync(
    join(suite, 'login-001.spec.js'),
    "test('[LOGIN-001] signs in', async () => {})"
  )
  const calls = []

  const result = await prepareTestRepository({
    repositoryPath,
    ...context,
    workspaceRoot: workspace,
    cliEnvironment: syntheticCliEnvironment(),
    run: fakeVoidrRun({ repositoryPath, calls, context })
  })

  const scaffold = calls.find(call => call.args?.includes('scaffold'))
  assert.ok(scaffold, 'the missing case still has to be scaffolded')
  assert.equal(scaffold.args[scaffold.args.indexOf('--cases') + 1], 'LOGIN-002')
  assert.deepEqual(result.steps.scaffoldedCases, ['LOGIN-002'])
  assert.deepEqual(result.steps.alreadyScaffolded, ['LOGIN-001'])
})

test('does not scaffold at all when every selected case already has a spec', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'voidr-prepare-'))
  const repositoryPath = createRepository(workspace)
  const suite = join(repositoryPath, 'modules', 'login', 'login')
  mkdirSync(suite, { recursive: true })
  // The slug in the title is what identifies the case — the file name and the
  // suite it sits in are free to change.
  writeFileSync(
    join(suite, 'anything.spec.js'),
    "test('[LOGIN-001] signs in', async () => {})\ntest('[LOGIN-002] fails', async () => {})"
  )
  const calls = []

  const result = await prepareTestRepository({
    repositoryPath,
    ...context,
    workspaceRoot: workspace,
    cliEnvironment: syntheticCliEnvironment(),
    run: fakeVoidrRun({ repositoryPath, calls, context })
  })

  assert.equal(
    calls.some(call => call.args?.includes('scaffold')),
    false,
    'the CLI must not be spawned when there is nothing to create'
  )
  assert.equal(result.steps.scaffolded, false)
  assert.deepEqual(result.steps.scaffoldedCases, [])
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
