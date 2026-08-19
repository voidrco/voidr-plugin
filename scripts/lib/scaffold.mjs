import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { runCommand } from './command.mjs'
import {
  assertSupportedNodeRuntime,
  describeNodeRuntime,
  withToolchainPath
} from './node-runtime.mjs'
import {
  validateProvisionedRepositorySelection,
  validateRepositorySelection
} from './workspace.mjs'
import { voidrCliEnvironment } from './credentials.mjs'

const execFileAsync = promisify(execFile)

// Forward slashes match on every platform: on Windows Playwright also tests each
// filter against the slash-separated file URL of the spec.
export function playwrightSpecPath(relativePath, separator = sep) {
  return String(relativePath).split(separator).join('/')
}

// Playwright turns each positional filter into a regex without escaping it, so a
// path has to be spelled as one. A Windows separator would be read as an escape
// sequence — `tests\login.spec.js` stops matching and `tests\test-x.spec.js` even
// becomes a tab — and any regex metacharacter in a file name would change which
// files the filter selects. Only the arguments are escaped: the reported paths
// stay literal.
export function playwrightSpecFilter(relativePath, separator = sep) {
  return playwrightSpecPath(relativePath, separator).replace(
    /[.*+?^${}()|[\]\\]/g,
    '\\$&'
  )
}

export async function scaffoldTestCases({
  repositoryPath,
  repositoryUrl,
  testPlanId,
  cases,
  workspaceRoot = process.cwd(),
  cliEnvironment = voidrCliEnvironment(),
  run = runCommand
}) {
  if (!/^[a-f0-9]{24}$/i.test(String(testPlanId || ''))) {
    throw new Error('A valid Test Plan ID is required.')
  }
  const selected = repositoryUrl
    ? validateProvisionedRepositorySelection(repositoryPath, repositoryUrl)
    : validateRepositorySelection(repositoryPath, workspaceRoot)
  if (selected.project?.invalid) throw new Error('project.json is invalid.')
  if (
    !selected.project ||
    String(selected.project.testPlanId || '') !== String(testPlanId)
  ) {
    throw new Error(
      'project.json does not match the explicitly selected Test Plan.'
    )
  }

  const selectedCases = [...new Set((cases || []).map(String))]
  if (
    selectedCases.length === 0 ||
    selectedCases.some(value => !/^[a-z0-9][a-z0-9._-]*$/i.test(value))
  ) {
    throw new Error('At least one valid Test Plan case slug is required.')
  }

  // The Voidr CLI is invoked directly through npx because provisioned
  // skeletons may ship voidr:* scripts pointing at a .voidr/cli path that is
  // not committed to the repository.
  await run(
    'npx',
    [
      '--no-install',
      'voidr',
      'scaffold',
      '--split-per-case',
      '--cases',
      selectedCases.join(',')
    ],
    {
      cwd: selected.path,
      timeout: 180_000,
      env: cliEnvironment
    }
  )

  return {
    completed: true,
    repositoryPath: selected.path,
    testPlanId: String(testPlanId),
    cases: selectedCases
  }
}

// The local gate is the build alone: `voidr build` bundles every spec with
// esbuild, so a syntax error fails here with the file and line. Functional
// validation happens on the platform, as a SHADOW execution pinned to the
// deployed codebaseVersion — never as a local Playwright run.
export async function buildRepository({
  repositoryPath,
  repositoryUrl,
  testPlanId,
  cliEnvironment = voidrCliEnvironment(),
  run = runCommand
}) {
  if (!/^[a-f0-9]{24}$/i.test(String(testPlanId || ''))) {
    throw new Error('A valid Test Plan ID is required.')
  }
  const selected = validateProvisionedRepositorySelection(
    repositoryPath,
    repositoryUrl
  )
  if (selected.project?.invalid) throw new Error('project.json is invalid.')
  if (
    !selected.project ||
    String(selected.project.testPlanId || '') !== String(testPlanId)
  ) {
    throw new Error(
      'project.json does not match the explicitly selected Test Plan.'
    )
  }

  const runtime = await assertSupportedNodeRuntime({
    repositoryPath: selected.path,
    run
  })

  const buildResult = await run('npx', ['--no-install', 'voidr', 'build'], {
    cwd: selected.path,
    timeout: 180_000,
    env: withToolchainPath(cliEnvironment, runtime.toolchain)
  })
  if (buildResult?.exitCode !== undefined && buildResult.exitCode !== 0) {
    throw new Error(
      'voidr build failed. The build reported:\n' +
        commandOutputExcerpt(buildResult)
    )
  }

  return {
    completed: true,
    buildCompleted: true,
    repositoryPath: selected.path,
    testPlanId: String(testPlanId),
    nodeRuntime: describeNodeRuntime(runtime)
  }
}

// Exploration probes: run throwaway inspection specs against the deployed
// application to answer DOM questions the recorded sessions left open.
// Failures are expected and informative; nothing is gated, nothing is built,
// and an exploration never counts as validation.
export async function exploreSelectedPlaywrightTests(options) {
  const validation = await validateSelectedPlaywrightTests(options)
  return {
    completed: true,
    exploration: true,
    buildCompleted: false,
    repositoryPath: validation.repositoryPath,
    testPlanId: validation.testPlanId,
    validation
  }
}

export async function validateSelectedPlaywrightTests({
  repositoryPath,
  repositoryUrl,
  testPlanId,
  specs,
  baseUrl,
  workspaceRoot = process.cwd(),
  run = runPlaywrightCommand
}) {
  if (!/^[a-f0-9]{24}$/i.test(String(testPlanId || ''))) {
    throw new Error('A valid Test Plan ID is required.')
  }
  const selectedBaseUrl = validateHttpUrl(baseUrl)
  const selected = validateProvisionedRepositorySelection(
    repositoryPath,
    repositoryUrl
  )
  if (selected.project?.invalid) throw new Error('project.json is invalid.')
  if (
    !selected.project ||
    String(selected.project.testPlanId || '') !== String(testPlanId)
  ) {
    throw new Error(
      'project.json does not match the explicitly selected Test Plan.'
    )
  }

  const selectedSpecs = [...new Set((specs || []).map(String))].map(spec => {
    if (
      !spec ||
      isAbsolute(spec) ||
      spec.split(/[\\/]/).includes('..') ||
      !/\.spec\.[cm]?[jt]sx?$/i.test(spec)
    ) {
      throw new Error('Every selected spec must be a relative Playwright spec path.')
    }
    const absolute = resolve(selected.path, spec)
    const insideRepository = relative(selected.path, absolute)
    if (
      !insideRepository ||
      insideRepository.startsWith('..') ||
      isAbsolute(insideRepository) ||
      !existsSync(absolute)
    ) {
      throw new Error(`Selected spec does not exist in the repository: ${spec}`)
    }
    return playwrightSpecPath(insideRepository)
  })
  if (selectedSpecs.length === 0) {
    throw new Error('At least one selected Playwright spec is required.')
  }
  const specFilters = selectedSpecs.map(spec => playwrightSpecFilter(spec, '/'))

  const runtime = await assertSupportedNodeRuntime({
    repositoryPath: selected.path,
    run
  })

  const listResult = await run(
    'npx',
    ['--no-install', 'playwright', 'test', ...specFilters, '--list'],
    {
      cwd: selected.path,
      timeout: 120_000,
      env: withToolchainPath(
        playwrightEnvironment(selectedBaseUrl),
        runtime.toolchain
      )
    }
  )
  if (listResult.exitCode !== 0) {
    // Playwright already names the broken file and line (a syntax error in a
    // spec is the common cause); without its words the failure reads as an
    // infrastructure problem nobody can act on.
    throw new Error(
      'Playwright could not list the selected specs. Playwright reported:\n' +
        commandOutputExcerpt(listResult)
    )
  }

  const testResult = await run(
    'npx',
    [
      '--no-install',
      'playwright',
      'test',
      ...specFilters,
      '--reporter=json',
      '--trace',
      'on'
    ],
    {
      cwd: selected.path,
      timeout: 300_000,
      env: withToolchainPath(
        playwrightEnvironment(selectedBaseUrl),
        runtime.toolchain
      )
    }
  )
  const report = parsePlaywrightReport(testResult.stdout)
  const stats = report?.stats || {}
  const failures = collectPlaywrightFailures(report)
  const failed = Number(stats.unexpected || failures.length || 0)
  const traces = collectPlaywrightTraces(report)

  return {
    completed:
      testResult.exitCode === 0 &&
      failed === 0 &&
      Number(stats.skipped || 0) === 0,
    repositoryPath: selected.path,
    testPlanId: String(testPlanId),
    nodeRuntime: describeNodeRuntime(runtime),
    specs: selectedSpecs,
    baseUrl: selectedBaseUrl,
    listCompleted: true,
    passed: Number(stats.expected || 0),
    failed,
    skipped: Number(stats.skipped || 0),
    flaky: Number(stats.flaky || 0),
    failures,
    traces,
    output: collectPlaywrightStdout(report),
    traceHint:
      'Analyze each run in the Playwright trace viewer: npx playwright show-trace <trace path>, executed from the test repository. Always share these commands with the user, failures first.'
  }
}

function commandOutputExcerpt({ stderr, stdout } = {}) {
  const text = `${stderr || ''}\n${stdout || ''}`.trim()
  if (!text) return 'Playwright produced no output.'
  const excerpt = text.split('\n').slice(0, 20).join('\n')
  return excerpt.length > 2000 ? `${excerpt.slice(0, 2000)}…` : excerpt
}

async function runPlaywrightCommand(file, args, options = {}) {
  try {
    const result = await execFileAsync(file, args, {
      cwd: options.cwd,
      timeout: options.timeout || 30_000,
      maxBuffer: 20 * 1024 * 1024,
      env: options.env
    })
    return { ...result, exitCode: 0 }
  } catch (error) {
    return {
      stdout: String(error?.stdout || ''),
      stderr: String(error?.stderr || ''),
      exitCode: Number.isInteger(error?.code) ? error.code : 1
    }
  }
}

function validateHttpUrl(value) {
  try {
    const parsed = new URL(String(value || ''))
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error()
    return parsed.toString()
  } catch {
    throw new Error('A confirmed HTTP(S) local smoke base URL is required.')
  }
}

function playwrightEnvironment(baseUrl) {
  return {
    ...process.env,
    BASE_URL: baseUrl,
    MAIN_URL: baseUrl,
    APPLICATION_URL: baseUrl
  }
}

function parsePlaywrightReport(stdout) {
  try {
    return JSON.parse(String(stdout || ''))
  } catch {
    return undefined
  }
}

// A category names the KIND of failure; only Playwright's own message names the
// failure. Its call log is what distinguishes a locator that is missing from
// one that is present but never became actionable — the two share a category
// and need opposite corrections. Without it a probe that ran and failed is
// indistinguishable from one that never ran, and the next attempt is a guess.
function failureMessageExcerpt(messages) {
  const text = String(messages || '').trim()
  if (!text) return ''
  return text.length > 2000 ? `${text.slice(0, 2000)}…` : text
}

function collectPlaywrightFailures(report) {
  const failures = []
  const visitSuite = suite => {
    for (const spec of suite?.specs || []) {
      for (const test of spec?.tests || []) {
        for (const result of test?.results || []) {
          if (!['failed', 'timedOut', 'interrupted'].includes(result?.status)) {
            continue
          }
          const messages = [
            result?.error?.message,
            ...(result?.errors || []).map(error => error?.message)
          ]
            .filter(Boolean)
            .join('\n')
          failures.push({
            spec: String(spec.file || suite.file || ''),
            title: String(spec.title || test.title || ''),
            category: classifyPlaywrightFailure(messages),
            message: failureMessageExcerpt(messages)
          })
        }
      }
    }
    for (const child of suite?.suites || []) visitSuite(child)
  }
  for (const suite of report?.suites || []) visitSuite(suite)
  for (const error of report?.errors || []) {
    failures.push({
      spec: '',
      title: 'Playwright infrastructure',
      category: classifyPlaywrightFailure(error?.message),
      message: failureMessageExcerpt(error?.message)
    })
  }
  return failures
}

// Per-test stdout, bounded: this is how exploration probes report their DOM
// and console findings back to the agent without any artifact round trip.
const STDOUT_LIMIT_PER_TEST = 6000

function collectPlaywrightStdout(report) {
  const outputs = []
  const visitSuite = suite => {
    for (const spec of suite?.specs || []) {
      for (const test of spec?.tests || []) {
        for (const result of test?.results || []) {
          const text = (result?.stdout || [])
            .map(chunk => String(chunk?.text || ''))
            .join('')
            .trim()
          if (!text) continue
          outputs.push({
            spec: String(spec.file || suite.file || ''),
            title: String(spec.title || test.title || ''),
            status: String(result.status || ''),
            stdout:
              text.length > STDOUT_LIMIT_PER_TEST
                ? `${text.slice(0, STDOUT_LIMIT_PER_TEST)}\n[stdout truncated]`
                : text
          })
        }
      }
    }
    for (const child of suite?.suites || []) visitSuite(child)
  }
  for (const suite of report?.suites || []) visitSuite(suite)
  return outputs
}

function collectPlaywrightTraces(report) {
  const traces = []
  const visitSuite = suite => {
    for (const spec of suite?.specs || []) {
      for (const test of spec?.tests || []) {
        for (const result of test?.results || []) {
          for (const attachment of result?.attachments || []) {
            if (attachment?.name === 'trace' && attachment?.path) {
              traces.push({
                spec: String(spec.file || suite.file || ''),
                title: String(spec.title || ''),
                status: String(result.status || ''),
                path: String(attachment.path)
              })
            }
          }
        }
      }
    }
    for (const child of suite?.suites || []) visitSuite(child)
  }
  for (const suite of report?.suites || []) visitSuite(suite)
  return traces
}

function classifyPlaywrightFailure(message) {
  const value = String(message || '').toLowerCase()
  if (
    value.includes('browsertype.launch') ||
    value.includes('machport') ||
    value.includes('browser launch')
  ) {
    return 'browser-launch'
  }
  if (value.includes('waitforresponse')) return 'response-not-observed'
  if (value.includes('waitforurl')) return 'redirect-not-observed'
  if (
    value.includes('locator.fill') ||
    value.includes('locator.click') ||
    value.includes('waiting for locator') ||
    value.includes('page.fill') ||
    value.includes('page.click')
  ) {
    return 'selector-or-page-state'
  }
  if (
    value.includes('apirequestcontext') ||
    value.includes('response.status') ||
    value.includes('status code')
  ) {
    return 'api-response'
  }
  if (value.includes('timeout')) return 'timeout'
  if (
    value.includes('net::') ||
    value.includes('econnrefused') ||
    value.includes('navigation') ||
    value.includes('page.goto')
  ) {
    return 'network-or-navigation'
  }
  if (value.includes('expect(') || value.includes('assert')) {
    return 'assertion'
  }
  return 'test-logic-or-product'
}
