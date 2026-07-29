import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { validateRepositorySelection } from './workspace.mjs'
import { voidrCliEnvironment } from './credentials.mjs'

const execFileAsync = promisify(execFile)

export async function scaffoldTestCases({
  repositoryPath,
  testPlanId,
  cases,
  workspaceRoot = process.cwd(),
  cliEnvironment = voidrCliEnvironment(),
  run = runCommand
}) {
  if (!/^[a-f0-9]{24}$/i.test(String(testPlanId || ''))) {
    throw new Error('A valid Test Plan ID is required.')
  }
  const selected = validateRepositorySelection(repositoryPath, workspaceRoot)
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
  testPlanId,
  workspaceRoot = process.cwd(),
  cliEnvironment = voidrCliEnvironment(),
  run = runCommand
}) {
  if (!/^[a-f0-9]{24}$/i.test(String(testPlanId || ''))) {
    throw new Error('A valid Test Plan ID is required.')
  }
  const selected = validateRepositorySelection(repositoryPath, workspaceRoot)
  if (selected.project?.invalid) throw new Error('project.json is invalid.')
  if (
    !selected.project ||
    String(selected.project.testPlanId || '') !== String(testPlanId)
  ) {
    throw new Error(
      'project.json does not match the explicitly selected Test Plan.'
    )
  }

  await run('npm', ['run', 'voidr:build'], {
    cwd: selected.path,
    timeout: 180_000,
    env: cliEnvironment
  })

  return {
    completed: true,
    repositoryPath: selected.path,
    testPlanId: String(testPlanId)
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
