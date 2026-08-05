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
import {
  assertOutsidePluginInstallation,
  canonicalizePotentialPath,
  findCheckoutByOrigin,
  isInside,
  normalizeGitHubRepositoryUrl
} from './workspace.mjs'

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
  assertOutsidePluginInstallation(resolvedTarget, 'test repository destination')

  // The workspace scan, not the model's belief, decides whether a checkout of
  // the linked repository already exists. A failed shell listing must never
  // lead to a duplicate clone or bootstrap.
  if (repositoryUrl) {
    const existingCheckout = findCheckoutByOrigin(
      resolvedWorkspace,
      repositoryUrl
    )
    if (existingCheckout && existingCheckout !== resolvedTarget) {
      return {
        created: false,
        reusedExistingCheckout: true,
        target: existingCheckout,
        repositoryUrl,
        next: ['voidr_workspace_prepare_test_repository'],
        note:
          'A checkout of the linked repository already exists in the workspace. Use this path; do not clone or bootstrap again.'
      }
    }
    if (
      existingCheckout === resolvedTarget &&
      existsSync(resolvedTarget) &&
      readdirSync(resolvedTarget).some(entry =>
        ['package.json', 'project.json', 'modules'].includes(entry)
      )
    ) {
      return {
        created: false,
        reusedExistingCheckout: true,
        target: resolvedTarget,
        repositoryUrl,
        next: ['voidr_workspace_prepare_test_repository'],
        note:
          'The destination is already a prepared checkout of the linked repository. Use it as-is.'
      }
    }
  }
  // A plan whose repository Voidr already provisioned must be materialized by
  // cloning it, never by writing a skeleton next to a fabricated origin: the
  // remote already holds the framework, and a local skeleton that merely points
  // at it is not that repository. Without this, the destination produced here
  // is one the preparation gate rejects forever as "not a checkout".
  if (repositoryUrl && !existsSync(resolve(resolvedTarget, '.git'))) {
    throw new Error(
      `The Test Plan already has a repository provisioned by Voidr (${normalizeGitHubRepositoryUrl(repositoryUrl)}), so it must be cloned, not bootstrapped. Call voidr_workspace_prepare_test_repository with this path as the clone destination — it clones the linked repository and prepares it in one step. Never create a skeleton here and never add the origin by hand: that produces a directory that is not a checkout of the linked repository.`
    )
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

function sanitizePackageName(value) {
  const sanitized = String(value)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return sanitized || 'voidr-tests'
}
