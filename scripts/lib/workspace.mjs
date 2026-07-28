import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync
} from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'

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
        indicators
      })
      if (indicators.git) return
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || shouldSkip(entry.name)) continue
      walk(join(current, entry.name), depth + 1)
    }
  }
}

export function validateRepositorySelection(path, workspaceRoot = process.cwd()) {
  const requested = resolve(path)
  if (!existsSync(requested) || !lstatSync(requested).isDirectory()) {
    throw new Error(`Test repository does not exist: ${requested}`)
  }

  const selected = realpathSync(requested)
  const root = realpathSync(resolve(workspaceRoot))
  if (!isInside(selected, root)) {
    throw new Error('The selected test repository must be inside the current workspace.')
  }

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
