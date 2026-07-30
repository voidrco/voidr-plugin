import { execFile } from 'node:child_process'
import {
  existsSync,
  readdirSync,
  readFileSync
} from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { voidrCliEnvironment } from './credentials.mjs'
import {
  validateProvisionedRepositorySelection,
  validateRepositorySelection
} from './workspace.mjs'

const execFileAsync = promisify(execFile)

export async function prepareTestRepository({
  repositoryPath,
  organizationId,
  applicationId,
  testPlanId,
  environmentSlug,
  cases,
  repositoryUrl,
  workspaceRoot = process.cwd(),
  cliEnvironment,
  run = runCommand
}) {
  const selected = repositoryUrl
    ? validateProvisionedRepositorySelection(repositoryPath, repositoryUrl)
    : validateRepositorySelection(repositoryPath, workspaceRoot)
  const identifiers = validateIdentifiers({
    organizationId,
    applicationId,
    testPlanId,
    environmentSlug
  })
  const selectedCases = validateCases(cases)
  const projectPath = join(selected.path, 'project.json')
  const hadProject = existsSync(projectPath)

  if (hadProject) {
    validateProject(projectPath, identifiers)
  }

  await run('npm', ['install'], {
    cwd: selected.path,
    timeout: 300_000,
    env: process.env
  })

  // The selected plugin Service Account is injected only into Voidr CLI child
  // processes. This deliberately replaces the interactive `voidr login` step.
  const resolvedCliEnvironment =
    cliEnvironment || voidrCliEnvironment()
  if (
    resolvedCliEnvironment.VOIDR_ORG_ID &&
    resolvedCliEnvironment.VOIDR_ORG_ID !== identifiers.organizationId
  ) {
    throw new Error(
      'The selected plugin Service Account belongs to a different organization.'
    )
  }
  const childEnvironment = {
    ...resolvedCliEnvironment,
    VOIDR_ORG_ID: identifiers.organizationId
  }

  if (!hadProject) {
    await run(
      'npx',
      [
        '--no-install',
        'voidr',
        'link',
        '--org-id',
        identifiers.organizationId,
        '--app-id',
        identifiers.applicationId,
        '--plan-id',
        identifiers.testPlanId,
        '--yes'
      ],
      {
        cwd: selected.path,
        timeout: 180_000,
        env: childEnvironment
      }
    )
  }

  validateProject(projectPath, identifiers)

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
      env: childEnvironment
    }
  )

  await run(
    'npx',
    [
      '--no-install',
      'voidr',
      'env',
      'pull',
      '--env',
      identifiers.environmentSlug,
      '--output',
      '.env'
    ],
    {
      cwd: selected.path,
      timeout: 180_000,
      env: childEnvironment
    }
  )

  const specCount = countSpecs(join(selected.path, 'modules'))
  if (specCount === 0) {
    throw new Error(
      'Voidr scaffold completed without creating any Playwright spec under modules/.'
    )
  }
  if (!existsSync(join(selected.path, '.env'))) {
    throw new Error(
      'Voidr environment pull completed without creating the repository .env file.'
    )
  }

  return {
    completed: true,
    repositoryPath: selected.path,
    organizationId: identifiers.organizationId,
    applicationId: identifiers.applicationId,
    testPlanId: identifiers.testPlanId,
    environmentSlug: identifiers.environmentSlug,
    cases: selectedCases,
    specCount,
    steps: {
      dependenciesInstalled: true,
      authenticationResolvedFromPluginServiceAccount: true,
      interactiveLoginExecuted: false,
      linked: !hadProject,
      existingProjectValidated: hadProject,
      scaffolded: true,
      secretsPulled: true
    }
  }
}

function validateIdentifiers({
  organizationId,
  applicationId,
  testPlanId,
  environmentSlug
}) {
  const values = {
    organizationId: String(organizationId || '').trim(),
    applicationId: String(applicationId || '').trim(),
    testPlanId: String(testPlanId || '').trim(),
    environmentSlug: String(environmentSlug || '').trim()
  }
  if (!values.organizationId) throw new Error('organizationId is required.')
  if (!values.applicationId) throw new Error('applicationId is required.')
  if (!/^[a-f0-9]{24}$/i.test(values.testPlanId)) {
    throw new Error('A valid Test Plan ID is required.')
  }
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(values.environmentSlug)) {
    throw new Error('A valid Voidr environment slug is required.')
  }
  return values
}

function validateCases(cases) {
  const values = [...new Set((cases || []).map(value => String(value).trim()))]
  if (
    values.length === 0 ||
    values.some(value => !/^[a-z0-9][a-z0-9._-]*$/i.test(value))
  ) {
    throw new Error('At least one valid Test Plan case slug is required.')
  }
  return values
}

function validateProject(projectPath, identifiers) {
  if (!existsSync(projectPath)) {
    throw new Error('Voidr link completed without creating project.json.')
  }

  let project
  try {
    project = JSON.parse(readFileSync(projectPath, 'utf8'))
  } catch {
    throw new Error('project.json is invalid.')
  }

  const expected = {
    orgId: identifiers.organizationId,
    appId: identifiers.applicationId,
    testPlanId: identifiers.testPlanId
  }
  const mismatches = Object.entries(expected)
    .filter(([field, value]) => String(project?.[field] || '') !== value)
    .map(([field]) => field)
  if (mismatches.length > 0) {
    throw new Error(
      `project.json does not match the selected Voidr context: ${mismatches.join(', ')}.`
    )
  }
}

function countSpecs(directory) {
  if (!existsSync(directory)) return 0
  let count = 0
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) count += countSpecs(path)
    else if (/\.spec\.[cm]?[jt]s$/i.test(entry.name)) count += 1
  }
  return count
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
