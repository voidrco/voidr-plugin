import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs'
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
    throw new Error(
      `Refusing to bootstrap a non-empty directory: ${resolvedTarget}`
    )
  }

  mkdirSync(resolvedTarget, { recursive: true })
  cpSync(templateRoot, resolvedTarget, {
    recursive: true,
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
    next: ['npm install', 'npm run voidr:scaffold -- --split-per-case']
  }
}

function sanitizePackageName(value) {
  const sanitized = String(value)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return sanitized || 'voidr-tests'
}
