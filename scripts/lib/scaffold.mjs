import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import {
  validateProvisionedRepositorySelection,
  validateRepositorySelection
} from './workspace.mjs'
import { voidrCliEnvironment } from './credentials.mjs'

const execFileAsync = promisify(execFile)

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

  await run(
    'npm',
    [
      'run',
      'voidr:scaffold',
      '--',
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

export async function buildTestRepository({
  repositoryPath,
  repositoryUrl,
  testPlanId,
  specs,
  baseUrl,
  workspaceRoot = process.cwd(),
  cliEnvironment = voidrCliEnvironment(),
  run = runCommand,
  testRun = runPlaywrightCommand
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

  const validation = await validateSelectedPlaywrightTests({
    repositoryPath: selected.path,
    repositoryUrl,
    testPlanId,
    specs,
    baseUrl,
    workspaceRoot,
    run: testRun
  })
  if (!validation.completed) {
    return {
      completed: false,
      buildCompleted: false,
      repositoryPath: selected.path,
      testPlanId: String(testPlanId),
      validation
    }
  }

  await run('npm', ['run', 'voidr:build'], {
    cwd: selected.path,
    timeout: 180_000,
    env: cliEnvironment
  })

  return {
    completed: true,
    buildCompleted: true,
    repositoryPath: selected.path,
    testPlanId: String(testPlanId),
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
    return insideRepository
  })
  if (selectedSpecs.length === 0) {
    throw new Error('At least one selected Playwright spec is required.')
  }

  const listResult = await run(
    'npx',
    ['--no-install', 'playwright', 'test', ...selectedSpecs, '--list'],
    {
      cwd: selected.path,
      timeout: 120_000,
      env: playwrightEnvironment(selectedBaseUrl)
    }
  )
  if (listResult.exitCode !== 0) {
    throw new Error('Playwright could not list the selected specs.')
  }

  const testResult = await run(
    'npx',
    [
      '--no-install',
      'playwright',
      'test',
      ...selectedSpecs,
      '--reporter=json'
    ],
    {
      cwd: selected.path,
      timeout: 300_000,
      env: playwrightEnvironment(selectedBaseUrl)
    }
  )
  const report = parsePlaywrightReport(testResult.stdout)
  const stats = report?.stats || {}
  const failures = collectPlaywrightFailures(report)
  const failed = Number(stats.unexpected || failures.length || 0)

  return {
    completed:
      testResult.exitCode === 0 &&
      failed === 0 &&
      Number(stats.skipped || 0) === 0,
    repositoryPath: selected.path,
    testPlanId: String(testPlanId),
    specs: selectedSpecs,
    baseUrl: selectedBaseUrl,
    listCompleted: true,
    passed: Number(stats.expected || 0),
    failed,
    skipped: Number(stats.skipped || 0),
    flaky: Number(stats.flaky || 0),
    failures
  }
}

async function runCommand(file, args, options = {}) {
  try {
    return await execFileAsync(file, args, {
      cwd: options.cwd,
      timeout: options.timeout || 30_000,
      maxBuffer: 10 * 1024 * 1024,
      env: options.env
    })
  } catch (error) {
    const code = Number.isInteger(error?.code) ? ` (exit ${error.code})` : ''
    throw new Error(`${file} ${args[0]} failed${code}.`)
  }
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
            category: classifyPlaywrightFailure(messages)
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
      category: classifyPlaywrightFailure(error?.message)
    })
  }
  return failures
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
