import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const moduleDir = dirname(fileURLToPath(import.meta.url))

export function pluginInstallationRoot() {
  return canonicalizePotentialPath(resolve(moduleDir, '..', '..'))
}

export function assertOutsidePluginInstallation(path, label = 'path') {
  const installationRoot = pluginInstallationRoot()
  const candidate = canonicalizePotentialPath(path)
  if (isInside(candidate, installationRoot)) {
    throw new Error(
      `Refusing to use a ${label} inside the plugin installation directory ` +
        `(${installationRoot}). Test repositories live in the real VS Code ` +
        'workspace, never inside the installed plugin.'
    )
  }
  return candidate
}

export function resolveWorkspaceRoot({
  explicit,
  env = process.env,
  cwd = process.cwd()
} = {}) {
  const installationRoot = pluginInstallationRoot()
  for (const candidate of [explicit, env.VOIDR_WORKSPACE_ROOT, cwd]) {
    if (!candidate || typeof candidate !== 'string') continue
    let resolved
    try {
      resolved = realpathSync(resolve(candidate))
    } catch {
      continue
    }
    if (!lstatSync(resolved).isDirectory()) continue
    if (isInside(resolved, installationRoot)) continue
    return resolved
  }
  throw new Error(
    'Could not resolve the real workspace root: this MCP process is running ' +
      'inside the plugin installation directory. Call the tool again passing ' +
      'workspaceRoot with the absolute path of the open VS Code workspace ' +
      'folder. Never use the plugin installation as a workspace.'
  )
}

export function inspectWorkspace(root = process.cwd(), maxDepth = 2) {
  const resolvedRoot = realpathSync(resolve(root))
  const candidates = []
  walk(resolvedRoot, 0)

  return {
    workspaceRoot: resolvedRoot,
    candidates: candidates
      .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
      .slice(0, 50)
  }

  function walk(current, depth) {
    if (depth > maxDepth) return
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }

    const names = new Set(entries.map(entry => entry.name))
    const indicators = {
      git: names.has('.git'),
      packageJson: names.has('package.json'),
      projectJson: names.has('project.json'),
      playwrightConfig:
        names.has('playwright.config.js') ||
        names.has('playwright.config.ts') ||
        names.has('playwright.config.cjs') ||
        names.has('voidr.runner.config.mjs'),
      modules: names.has('modules')
    }
    const score =
      Number(indicators.git) +
      Number(indicators.packageJson) +
      Number(indicators.projectJson) * 2 +
      Number(indicators.playwrightConfig) * 3 +
      Number(indicators.modules)

    if (score > 0 && current !== resolvedRoot) {
      candidates.push({
        name: basename(current),
        path: current,
        relativePath: relative(resolvedRoot, current),
        score,
        indicators,
        originUrl: indicators.git ? readSafeOriginUrl(current) : null
      })
      if (indicators.git) return
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || shouldSkip(entry.name)) continue
      walk(join(current, entry.name), depth + 1)
    }
  }
}

function readSafeOriginUrl(repositoryPath) {
  const result = spawnSync(
    'git',
    ['-C', repositoryPath, 'remote', 'get-url', 'origin'],
    { encoding: 'utf8' }
  )
  if (result.status !== 0) return null
  const raw = String(result.stdout || '').trim()
  if (!raw) return null
  if (/^git@github\.com:[^/]+\/[^/]+(?:\.git)?$/i.test(raw)) return raw
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' || url.hostname !== 'github.com') return null
    url.username = ''
    url.password = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

// Locates an existing checkout of the given GitHub repository anywhere in
// the workspace by comparing normalized Git origins. This is the anti-
// hallucination primitive: tools call it before creating or cloning anything,
// so a model that wrongly believes "no checkout exists" cannot cause a
// duplicate clone or a bootstrap into the wrong place.
export function findCheckoutByOrigin(
  workspaceRoot,
  repositoryUrl,
  maxDepth = 3
) {
  const expected = normalizeGitHubRepositoryUrl(repositoryUrl)
  const resolvedRoot = realpathSync(resolve(workspaceRoot))
  const rootOrigin = existsSync(join(resolvedRoot, '.git'))
    ? readSafeOriginUrl(resolvedRoot)
    : null
  if (rootOrigin) {
    try {
      if (normalizeGitHubRepositoryUrl(rootOrigin) === expected) {
        return resolvedRoot
      }
    } catch {
      // The workspace root itself has a non-matching origin; keep scanning.
    }
  }
  const { candidates } = inspectWorkspace(resolvedRoot, maxDepth)
  for (const candidate of candidates) {
    if (!candidate.indicators.git || !candidate.originUrl) continue
    try {
      if (normalizeGitHubRepositoryUrl(candidate.originUrl) === expected) {
        return candidate.path
      }
    } catch {
      // Non-GitHub or malformed origins are never a match.
    }
  }
  return null
}

export function validateRepositorySelection(path, workspaceRoot = process.cwd()) {
  const selected = validateRepositoryDirectory(path)
  const root = realpathSync(resolve(workspaceRoot))
  if (!isInside(selected.path, root)) {
    throw new Error('The selected test repository must be inside the current workspace.')
  }
  return selected
}

export function validateProvisionedRepositorySelection(path, repositoryUrl) {
  if (!repositoryUrl) {
    throw new Error('repositoryUrl is required for a Voidr-provisioned repository.')
  }

  const selected = validateRepositoryDirectory(path)
  if (!selected.indicators.git) {
    throw new Error(
      'The Voidr-provisioned repository must be an existing Git checkout.'
    )
  }

  const remote = spawnSync(
    'git',
    ['-C', selected.path, 'remote', 'get-url', 'origin'],
    { encoding: 'utf8' }
  )
  if (remote.status !== 0 || !String(remote.stdout || '').trim()) {
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

  return selected
}

function validateRepositoryDirectory(path) {
  const requested = resolve(path)
  if (!existsSync(requested) || !lstatSync(requested).isDirectory()) {
    throw new Error(`Test repository does not exist: ${requested}`)
  }

  const selected = realpathSync(requested)
  assertOutsidePluginInstallation(selected, 'test repository')
  const indicators = {
    git: existsSync(join(selected, '.git')),
    packageJson: existsSync(join(selected, 'package.json')),
    projectJson: existsSync(join(selected, 'project.json')),
    playwrightConfig:
      existsSync(join(selected, 'playwright.config.js')) ||
      existsSync(join(selected, 'playwright.config.ts')) ||
      existsSync(join(selected, 'playwright.config.cjs')) ||
      existsSync(join(selected, 'voidr.runner.config.mjs'))
  }
  if (!indicators.git && !indicators.packageJson && !indicators.playwrightConfig) {
    throw new Error(
      'The selected directory is not recognizable as a repository or Node test project.'
    )
  }

  let project = null
  const projectPath = join(selected, 'project.json')
  if (existsSync(projectPath)) {
    try {
      project = JSON.parse(readFileSync(projectPath, 'utf8'))
    } catch {
      project = { invalid: true }
    }
  }

  return { path: selected, indicators, project }
}

export function normalizeGitHubRepositoryUrl(value) {
  const raw = String(value || '')
    .trim()
    .replace(/^git@github\.com:/i, 'https://github.com/')
    .replace(/\.git$/i, '')
    .replace(/\/+$/g, '')

  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error('A valid GitHub repository URL is required.')
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname.toLowerCase() !== 'github.com' ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error('A valid GitHub repository URL is required.')
  }
  const segments = parsed.pathname.split('/').filter(Boolean)
  if (segments.length !== 2) {
    throw new Error('A valid GitHub repository URL is required.')
  }

  return `https://github.com/${segments[0]}/${segments[1]}`.toLowerCase()
}

export function isInside(candidate, root) {
  const rel = relative(root, candidate)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..')
}

export function canonicalizePotentialPath(path) {
  const absolute = resolve(path)
  try {
    return realpathSync(absolute)
  } catch {
    const missingParts = []
    let cursor = absolute
    while (!existsSync(cursor)) {
      const parent = dirname(cursor)
      if (parent === cursor) return absolute
      missingParts.unshift(basename(cursor))
      cursor = parent
    }
    return resolve(realpathSync(cursor), ...missingParts)
  }
}

function shouldSkip(name) {
  return [
    '.git',
    'node_modules',
    '.voidr',
    'dist',
    'build',
    'coverage',
    '.cache'
  ].includes(name)
}
