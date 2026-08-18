import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildRepository,
  exploreSelectedPlaywrightTests,
  playwrightSpecFilter,
  scaffoldTestCases,
  validateSelectedPlaywrightTests
} from '../scripts/lib/scaffold.mjs'

test('selects specs with a filter Playwright can match on Windows', () => {
  const windowsPath = 'tests\\test-checkout\\login.spec.js'
  const filter = playwrightSpecFilter(windowsPath, '\\')
  assert.equal(filter, 'tests/test-checkout/login\\.spec\\.js')

  // Playwright compiles each positional filter with new RegExp(pattern, 'gi')
  // and, on Windows, also tests it against the file URL of the spec.
  const asPlaywrightWould = pattern => new RegExp(pattern, 'gi')
  const fileUrl = 'file:///C:/repo/tests/test-checkout/login.spec.js'
  assert.equal(asPlaywrightWould(filter).test(fileUrl), true)
  // The raw Windows path matches neither form: \t became a tab character.
  assert.equal(asPlaywrightWould(windowsPath).test(fileUrl), false)
  assert.equal(
    asPlaywrightWould(windowsPath).test('C:\\repo\\' + windowsPath),
    false
  )
  // A metacharacter in a file name must select that file, not a pattern.
  const brackets = playwrightSpecFilter('tests/[checkout].spec.js', '/')
  assert.equal(asPlaywrightWould(brackets).test('/repo/tests/[checkout].spec.js'), true)
  assert.equal(asPlaywrightWould(brackets).test('/repo/tests/c.spec.js'), false)
  // Escaping never loosens an ordinary path: the literal still matches, and a
  // neighbour that only differs by a dot does not.
  const plain = playwrightSpecFilter('tests/login.spec.js', '/')
  assert.equal(asPlaywrightWould(plain).test('/repo/tests/login.spec.js'), true)
  assert.equal(asPlaywrightWould(plain).test('/repo/tests/loginXspecXjs'), false)
})

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
  const result = await buildRepository({
    repositoryPath,
    repositoryUrl,
    testPlanId,
    cliEnvironment: {
      VOIDR_API_URL: 'https://preview.example.test/v1',
      VOIDR_CLIENT_ID: 'synthetic-preview-client',
      VOIDR_CLIENT_SECRET: 'synthetic-preview-secret'
    },
    run: async (file, args, options) => {
      calls.push({ file, args, options })
      if (file === 'node' && args[0] === '--version') {
        return { stdout: 'v22.22.0\n', stderr: '', exitCode: 0 }
      }
      return { stdout: '', stderr: '', exitCode: 0 }
    }
  })

  assert.equal(result.completed, true)
  assert.equal(result.buildCompleted, true)
  const build = calls.find(call => call.file === 'npx')
  assert.deepEqual(build.args, ['--no-install', 'voidr', 'build'])
  assert.equal(
    build.options.env.VOIDR_API_URL,
    'https://preview.example.test/v1'
  )
  // The build gate never touches Playwright: no local test run of any kind.
  assert.equal(
    calls.some(call => call.args.includes('playwright')),
    false
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

  const result = await buildRepository({
    repositoryPath,
    repositoryUrl,
    testPlanId,
    run: async (file, args) =>
      file === 'node' && args[0] === '--version'
        ? { stdout: 'v22.22.0\n', stderr: '', exitCode: 0 }
        : { stdout: '', stderr: '', exitCode: 0 }
  })

  assert.equal(result.completed, true)
})

test('exploration tolerates failing probes and never builds', async () => {
  const repositoryPath = mkdtempSync(join(tmpdir(), 'voidr-explore-failed-'))
  const repositoryUrl = 'https://github.com/acme/failed-tests.git'
  const testPlanId = 'abcdef0123456789abcdef01'
  writeFileSync(join(repositoryPath, 'package.json'), '{}')
  writeFileSync(
    join(repositoryPath, 'project.json'),
    JSON.stringify({ testPlanId })
  )
  writeFileSync(join(repositoryPath, 'selected.spec.js'), 'export default true')
  initializeOrigin(repositoryPath, repositoryUrl)

  const commands = []
  const result = await exploreSelectedPlaywrightTests({
    repositoryPath,
    repositoryUrl,
    testPlanId,
    specs: ['selected.spec.js'],
    baseUrl: 'https://app.example.test/',
    run: async (file, args) => {
      commands.push([file, ...args])
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

  // A failing probe is information, not a gate: the exploration completes,
  // reports the failure, and never reaches voidr build.
  assert.equal(result.completed, true)
  assert.equal(result.exploration, true)
  assert.equal(result.buildCompleted, false)
  assert.equal(result.validation.failed, 1)
  assert.equal(
    result.validation.failures[0].category,
    'response-not-observed'
  )
  assert.equal(
    commands.some(command => command.includes('build')),
    false
  )
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
    buildRepository({
      repositoryPath,
      repositoryUrl: 'https://github.com/acme/expected.git',
      testPlanId,
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
  // The reported path stays literal; only the Playwright filter is escaped.
  assert.deepEqual(calls[1].args, [
    '--no-install',
    'playwright',
    'test',
    'modules/selected\\.spec\\.js',
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

test('a failed spec listing surfaces Playwright words instead of a bare verdict', async () => {
  const repositoryPath = mkdtempSync(join(tmpdir(), 'voidr-playwright-list-'))
  const repositoryUrl = 'https://github.com/acme/selected-tests.git'
  const testPlanId = 'abcdef0123456789abcdef01'
  mkdirSync(join(repositoryPath, 'modules'), { recursive: true })
  writeFileSync(join(repositoryPath, 'package.json'), '{}')
  writeFileSync(
    join(repositoryPath, 'project.json'),
    JSON.stringify({ testPlanId })
  )
  writeFileSync(
    join(repositoryPath, 'modules', 'broken.spec.js'),
    'const stateParam = null; stateParam!.length'
  )
  initializeOrigin(repositoryPath, repositoryUrl)

  await assert.rejects(
    validateSelectedPlaywrightTests({
      repositoryPath,
      repositoryUrl,
      testPlanId,
      specs: ['modules/broken.spec.js'],
      baseUrl: 'https://app.example.test/',
      run: async (file, args) => {
        if (file === 'node' && args[0] === '--version') {
          return { stdout: 'v22.22.0\n', stderr: '', exitCode: 0 }
        }
        return {
          stdout: '',
          stderr:
            'Error: modules/broken.spec.js:1:41: Unexpected token "!"\n' +
            '> 1 | const stateParam = null; stateParam!.length\n',
          exitCode: 1
        }
      }
    }),
    error => {
      assert.match(error.message, /could not list the selected specs/)
      assert.match(error.message, /broken\.spec\.js:1:41/)
      assert.match(error.message, /Unexpected token/)
      return true
    }
  )
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
