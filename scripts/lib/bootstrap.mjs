import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalizePotentialPath, isInside } from './workspace.mjs'

const moduleDir = dirname(fileURLToPath(import.meta.url))
const templateRoot = resolve(moduleDir, '../../templates/test-repository')

export function bootstrapTestRepository({
  target,
  name,
  organizationId,
  applicationId,
  testPlanId,
  allowExistingGitRepository = false,
  repositoryUrl,
  workspaceRoot = process.cwd()
}) {
  for (const [field, value] of Object.entries({
    target,
    organizationId,
    applicationId,
    testPlanId
  })) {
    if (!value) throw new Error(`${field} is required.`)
  }

  const resolvedWorkspace = canonicalizePotentialPath(workspaceRoot)
  const resolvedTarget = canonicalizePotentialPath(
    resolve(resolvedWorkspace, target)
  )
  if (!isInside(resolvedTarget, resolvedWorkspace)) {
    throw new Error('The new test repository must be inside the current workspace.')
  }
  if (existsSync(resolvedTarget) && readdirSync(resolvedTarget).length > 0) {
    validateExistingProvisionedRepository({
      target: resolvedTarget,
      allowExistingGitRepository,
      repositoryUrl
    })
  }

  mkdirSync(resolvedTarget, { recursive: true })
  cpSync(templateRoot, resolvedTarget, {
    recursive: true,
    force: false,
    errorOnExist: true
  })

  const packagePath = resolve(resolvedTarget, 'package.json')
  const projectName = sanitizePackageName(name || basename(resolvedTarget))
  const packageText = readFileSync(packagePath, 'utf8').replace(
    '__PROJECT_NAME__',
    projectName
  )
  writeFileSync(packagePath, packageText, 'utf8')
  writeFileSync(
    resolve(resolvedTarget, 'project.json'),
    JSON.stringify(
      {
        orgId: organizationId,
        appId: applicationId,
        testPlanId
      },
      null,
      2
    ),
    'utf8'
  )

  return {
    created: true,
    target: resolvedTarget,
    projectName,
    files: [
      'package.json',
      'project.json',
      'playwright.config.js',
      'playwright.config.cjs',
      'voidr.runner.config.mjs',
      '.env.example',
      '.gitignore',
      'modules/.gitkeep'
    ],
    next: ['npm install', 'voidr_workspace_scaffold_test_cases']
  }
}

function validateExistingProvisionedRepository({
  target,
  allowExistingGitRepository,
  repositoryUrl
}) {
  if (!allowExistingGitRepository) {
    throw new Error(`Refusing to bootstrap a non-empty directory: ${target}`)
  }
  if (!repositoryUrl) {
    throw new Error(
      'repositoryUrl is required for an existing provisioned repository.'
    )
  }
  if (!existsSync(resolve(target, '.git'))) {
    throw new Error(
      'The provisioned repository destination must already be a Git checkout.'
    )
  }

  const managedPaths = [
    'package.json',
    'project.json',
    'playwright.config.js',
    'playwright.config.cjs',
    'voidr.runner.config.mjs',
    '.env.example',
    '.gitignore',
    'modules'
  ]
  const collisions = managedPaths.filter(path =>
    existsSync(resolve(target, path))
  )
  if (collisions.length > 0) {
    throw new Error(
      `Refusing to overwrite existing test repository files: ${collisions.join(', ')}`
    )
  }

  const remote = spawnSync(
    'git',
    ['-C', target, 'remote', 'get-url', 'origin'],
    { encoding: 'utf8' }
  )
  if (remote.status !== 0) {
    throw new Error('The provisioned repository has no readable origin remote.')
  }
  if (
    normalizeGitHubRepositoryUrl(remote.stdout) !==
    normalizeGitHubRepositoryUrl(repositoryUrl)
  ) {
    throw new Error(
      'The local origin does not match the repository provisioned by Voidr.'
    )
  }
}

function normalizeGitHubRepositoryUrl(value) {
  return String(value)
    .trim()
    .replace(/^git@github\.com:/i, 'https://github.com/')
    .replace(/\.git$/i, '')
    .replace(/\/+$/g, '')
    .toLowerCase()
}

function sanitizePackageName(value) {
  const sanitized = String(value)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return sanitized || 'voidr-tests'
}
