import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildTestRepository,
  scaffoldTestCases,
  validateSelectedPlaywrightTests
} from '../scripts/lib/scaffold.mjs'

test('scaffolds selected cases with credentials confined to the child process', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'voidr-scaffold-'))
  const repositoryPath = join(workspace, 'tests')
  const testPlanId = '0123456789abcdef01234567'
  mkdirSync(repositoryPath)
  writeFileSync(
    join(repositoryPath, 'package.json'),
    JSON.stringify({ scripts: { 'voidr:scaffold': 'voidr scaffold' } })
  )
  writeFileSync(
    join(repositoryPath, 'project.json'),
    JSON.stringify({ testPlanId })
  )

  const secret = 'synthetic-preview-secret'
  const calls = []
  const result = await scaffoldTestCases({
    repositoryPath,
    testPlanId,
    cases: ['LOGIN-001', 'LOGIN-002', 'LOGIN-001'],
    workspaceRoot: workspace,
    cliEnvironment: {
      VOIDR_API_URL: 'https://preview.example.test/v1',
      VOIDR_CLIENT_ID: 'synthetic-preview-client',
      VOIDR_CLIENT_SECRET: secret
    },
    run: async (file, args, options) => {
      calls.push({ file, args, options })
      return { stdout: '' }
    }
  })

  assert.deepEqual(result.cases, ['LOGIN-001', 'LOGIN-002'])
  assert.equal(JSON.stringify(result).includes(secret), false)
  assert.equal(calls[0].file, 'npx')
  assert.deepEqual(calls[0].args, [
    '--no-install',
    'voidr',
    'scaffold',
    '--split-per-case',
    '--cases',
    'LOGIN-001,LOGIN-002'
  ])
  assert.equal(calls[0].options.env.VOIDR_CLIENT_SECRET, secret)
  assert.equal(
    calls[0].options.env.VOIDR_API_URL,
    'https://preview.example.test/v1'
  )
})

test('builds through the same isolated preview CLI environment', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'voidr-build-'))
  const repositoryPath = join(workspace, 'tests')
  const testPlanId = 'abcdef0123456789abcdef01'
  mkdirSync(repositoryPath)
  writeFileSync(
    join(repositoryPath, 'package.json'),
    JSON.stringify({ scripts: { 'voidr:build': 'voidr build' } })
  )
  writeFileSync(
    join(repositoryPath, 'project.json'),
    JSON.stringify({ testPlanId })
  )
  writeFileSync(join(repositoryPath, 'selected.spec.js'), 'export default true')
  const repositoryUrl = 'https://github.com/acme/voidr-tests.git'
  initializeOrigin(repositoryPath, repositoryUrl)

  const calls = []
  const result = await buildTestRepository({
    repositoryPath,
    repositoryUrl,
    testPlanId,
    specs: ['selected.spec.js'],
    baseUrl: 'https://app.example.test/',
    workspaceRoot: workspace,
    cliEnvironment: {
      VOIDR_API_URL: 'https://preview.example.test/v1',
      VOIDR_CLIENT_ID: 'synthetic-preview-client',
      VOIDR_CLIENT_SECRET: 'synthetic-preview-secret'
    },
    run: async (file, args, options) => {
      calls.push({ file, args, options })
      return { stdout: '' }
    },
    testRun: passingPlaywrightRun
  })

  assert.equal(result.completed, true)
  assert.equal(calls[0].file, 'npx')
  assert.deepEqual(calls[0].args, ['--no-install', 'voidr', 'build'])
  assert.equal(
    calls[0].options.env.VOIDR_API_URL,
    'https://preview.example.test/v1'
  )
})

test('build accepts a provisioned checkout outside the MCP process cwd', async () => {
  const mcpRoot = mkdtempSync(join(tmpdir(), 'voidr-mcp-cwd-'))
  const repositoryPath = mkdtempSync(join(tmpdir(), 'voidr-build-external-'))
  const repositoryUrl = 'https://github.com/acme/external-tests'
  const testPlanId = 'abcdef0123456789abcdef01'
  writeFileSync(join(repositoryPath, 'package.json'), '{}')
  writeFileSync(
    join(repositoryPath, 'project.json'),
    JSON.stringify({ testPlanId })
  )
  writeFileSync(join(repositoryPath, 'selected.spec.js'), 'export default true')
  initializeOrigin(repositoryPath, `${repositoryUrl}.git`)

  const result = await buildTestRepository({
    repositoryPath,
    repositoryUrl,
    testPlanId,
    specs: ['selected.spec.js'],
    baseUrl: 'https://app.example.test/',
    workspaceRoot: mcpRoot,
    run: async () => ({ stdout: '' }),
    testRun: passingPlaywrightRun
  })

  assert.equal(result.completed, true)
})

test('does not build when a selected Playwright test fails', async () => {
  const repositoryPath = mkdtempSync(join(tmpdir(), 'voidr-build-failed-test-'))
  const repositoryUrl = 'https://github.com/acme/failed-tests.git'
  const testPlanId = 'abcdef0123456789abcdef01'
  writeFileSync(join(repositoryPath, 'package.json'), '{}')
  writeFileSync(
    join(repositoryPath, 'project.json'),
    JSON.stringify({ testPlanId })
  )
  writeFileSync(join(repositoryPath, 'selected.spec.js'), 'export default true')
  initializeOrigin(repositoryPath, repositoryUrl)

  let buildCalls = 0
  const result = await buildTestRepository({
    repositoryPath,
    repositoryUrl,
    testPlanId,
    specs: ['selected.spec.js'],
    baseUrl: 'https://app.example.test/',
    run: async () => {
      buildCalls += 1
      return { stdout: '' }
    },
    testRun: async (file, args) => {
      if (file === 'node' && args[0] === '--version') {
        return { stdout: 'v22.22.0\n', stderr: '', exitCode: 0 }
      }
      if (args.includes('--list')) {
        return { stdout: 'selected.spec.js', stderr: '', exitCode: 0 }
      }
      return {
        stdout: JSON.stringify({
          suites: [
            {
              file: 'selected.spec.js',
              specs: [
                {
                  file: 'selected.spec.js',
                  title: 'selected case',
                  tests: [
                    {
                      results: [
                        {
                          status: 'failed',
                          errors: [
                            {
                              message:
                                'page.waitForResponse: Timeout 30000ms exceeded'
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ],
          errors: [],
          stats: { expected: 0, unexpected: 1, skipped: 0, flaky: 0 }
        }),
        stderr: '',
        exitCode: 1
      }
    }
  })

  assert.equal(result.completed, false)
  assert.equal(result.buildCompleted, false)
  assert.equal(result.validation.failed, 1)
  assert.equal(
    result.validation.failures[0].category,
    'response-not-observed'
  )
  assert.equal(buildCalls, 0)
})

test('build rejects a checkout whose origin differs from the linked repository', async () => {
  const repositoryPath = mkdtempSync(join(tmpdir(), 'voidr-build-mismatch-'))
  const testPlanId = 'abcdef0123456789abcdef01'
  writeFileSync(join(repositoryPath, 'package.json'), '{}')
  writeFileSync(
    join(repositoryPath, 'project.json'),
    JSON.stringify({ testPlanId })
  )
  initializeOrigin(repositoryPath, 'https://github.com/acme/wrong.git')

  await assert.rejects(
    buildTestRepository({
      repositoryPath,
      repositoryUrl: 'https://github.com/acme/expected.git',
      testPlanId,
      baseUrl: 'https://app.example.test/',
      run: async () => ({ stdout: '' })
    }),
    /origin does not match/
  )
})

test('lists and runs only selected Playwright specs outside the agent shell', async () => {
  const repositoryPath = mkdtempSync(join(tmpdir(), 'voidr-playwright-'))
  const repositoryUrl = 'https://github.com/acme/selected-tests.git'
  const testPlanId = 'abcdef0123456789abcdef01'
  mkdirSync(join(repositoryPath, 'modules'), { recursive: true })
  writeFileSync(join(repositoryPath, 'package.json'), '{}')
  writeFileSync(
    join(repositoryPath, 'project.json'),
    JSON.stringify({ testPlanId })
  )
  writeFileSync(
    join(repositoryPath, 'modules', 'selected.spec.js'),
    'export default true'
  )
  initializeOrigin(repositoryPath, repositoryUrl)

  const calls = []
  const result = await validateSelectedPlaywrightTests({
    repositoryPath,
    repositoryUrl,
    testPlanId,
    specs: ['modules/selected.spec.js'],
    baseUrl: 'https://app.example.test/',
    run: async (file, args, options) => {
      calls.push({ file, args, options })
      if (file === 'node' && args[0] === '--version') {
        return { stdout: 'v22.22.0\n', stderr: '', exitCode: 0 }
      }
      if (args.includes('--list')) {
        return { stdout: 'selected.spec.js', stderr: '', exitCode: 0 }
      }
      return {
        stdout: JSON.stringify({
          suites: [
            {
              file: 'modules/selected.spec.js',
              specs: [
                {
                  file: 'modules/selected.spec.js',
                  title: 'selected case',
                  tests: [
                    {
                      results: [
                        {
                          status: 'passed',
                          attachments: [
                            {
                              name: 'trace',
                              path: '/tmp/test-results/selected/trace.zip'
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ],
          errors: [],
          stats: { expected: 1, unexpected: 0, skipped: 0, flaky: 0 }
        }),
        stderr: '',
        exitCode: 0
      }
    }
  })

  assert.equal(result.completed, true)
  assert.equal(result.passed, 1)
  assert.deepEqual(result.specs, ['modules/selected.spec.js'])
  assert.equal(calls.length, 3)
  assert.deepEqual(calls[0].args, ['--version'])
  assert.equal(calls[1].options.env.BASE_URL, 'https://app.example.test/')
  assert.equal(
    calls[2].options.env.APPLICATION_URL,
    'https://app.example.test/'
  )
  assert.deepEqual(calls[1].args, [
    '--no-install',
    'playwright',
    'test',
    'modules/selected.spec.js',
    '--list'
  ])
  assert.equal(calls[2].args.includes('--reporter=json'), true)
  assert.deepEqual(calls[2].args.slice(-2), ['--trace', 'on'])
  assert.deepEqual(result.traces, [
    {
      spec: 'modules/selected.spec.js',
      title: 'selected case',
      status: 'passed',
      path: '/tmp/test-results/selected/trace.zip'
    }
  ])
  assert.match(result.traceHint, /show-trace/)
})

test('rejects selected specs outside the linked repository', async () => {
  const repositoryPath = mkdtempSync(join(tmpdir(), 'voidr-playwright-path-'))
  const repositoryUrl = 'https://github.com/acme/selected-tests.git'
  const testPlanId = 'abcdef0123456789abcdef01'
  writeFileSync(join(repositoryPath, 'package.json'), '{}')
  writeFileSync(
    join(repositoryPath, 'project.json'),
    JSON.stringify({ testPlanId })
  )
  initializeOrigin(repositoryPath, repositoryUrl)

  await assert.rejects(
    validateSelectedPlaywrightTests({
      repositoryPath,
      repositoryUrl,
      testPlanId,
      specs: ['../outside.spec.js'],
      baseUrl: 'https://app.example.test/',
      run: async () => ({ stdout: '', stderr: '', exitCode: 0 })
    }),
    /relative Playwright spec path/
  )
})

function initializeOrigin(repositoryPath, repositoryUrl) {
  execFileSync('git', ['init', repositoryPath], { stdio: 'ignore' })
  execFileSync(
    'git',
    ['-C', repositoryPath, 'remote', 'add', 'origin', repositoryUrl],
    { stdio: 'ignore' }
  )
}

async function passingPlaywrightRun(file, args) {
  if (file === 'node' && args[0] === '--version') {
    return { stdout: 'v22.22.0\n', stderr: '', exitCode: 0 }
  }
  if (args.includes('--list')) {
    return { stdout: 'selected.spec.js', stderr: '', exitCode: 0 }
  }
  return {
    stdout: JSON.stringify({
      suites: [],
      errors: [],
      stats: { expected: 1, unexpected: 0, skipped: 0, flaky: 0 }
    }),
    stderr: '',
    exitCode: 0
  }
}
