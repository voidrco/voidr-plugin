import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCommand } from './command.mjs'

const MAX_PATCH_BYTES = 1024 * 1024
const MAX_CHANGED_FILES = 200
const EXCLUDED_PATCH_PATHS = [
  '.voidr',
  'node_modules',
  '.agents',
  '.claude',
  'AGENTS.md',
  'CLAUDE.md',
  '.env',
  '.env.*'
]

export async function createRepositorySyncPatch({
  repositoryPath,
  run = runCommand,
  environment = process.env
}) {
  const defaultBranch = await resolveDefaultBranch(repositoryPath, run)
  const remoteRef = `refs/remotes/origin/${defaultBranch}`
  const baseCommitSha = (
    await run('git', ['rev-parse', remoteRef], { cwd: repositoryPath })
  ).stdout.trim()
  if (!/^[a-f0-9]{40}$/i.test(baseCommitSha)) {
    throw new Error('Could not resolve the remote default branch commit.')
  }

  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'voidr-sync-patch-'))
  const indexPath = join(temporaryDirectory, 'index')
  const gitEnvironment = { ...environment, GIT_INDEX_FILE: indexPath }
  try {
    await run('git', ['read-tree', baseCommitSha], {
      cwd: repositoryPath,
      env: gitEnvironment
    })
    await run('git', ['add', '-A', '--', '.'], {
      cwd: repositoryPath,
      env: gitEnvironment,
      timeout: 120_000
    })
    await run(
      'git',
      ['reset', '-q', baseCommitSha, '--', ...EXCLUDED_PATCH_PATHS],
      { cwd: repositoryPath, env: gitEnvironment }
    )
    const changed = await run(
      'git',
      ['diff', '--cached', '--name-only', '-z', baseCommitSha],
      { cwd: repositoryPath, env: gitEnvironment }
    )
    const changedFiles = String(changed.stdout || '')
      .split('\0')
      .filter(Boolean)
    if (changedFiles.length === 0) {
      return { needed: false, defaultBranch, baseCommitSha, changedFiles: [] }
    }
    if (changedFiles.length > MAX_CHANGED_FILES) {
      throw new Error(
        `Repository synchronization supports at most ${MAX_CHANGED_FILES} changed files.`
      )
    }

    const generated = await run(
      'git',
      [
        '-c',
        'core.quotePath=false',
        'diff',
        '--cached',
        '--binary',
        '--full-index',
        '--no-color',
        '--no-ext-diff',
        '-M',
        baseCommitSha
      ],
      {
        cwd: repositoryPath,
        env: gitEnvironment,
        maxBuffer: MAX_PATCH_BYTES + 64 * 1024
      }
    )
    const patch = String(generated.stdout || '')
    if (!patch.trim()) throw new Error('Git reported changed files but produced no patch.')
    if (Buffer.byteLength(patch, 'utf8') > MAX_PATCH_BYTES) {
      throw new Error(
        `Repository synchronization patch exceeds ${MAX_PATCH_BYTES} bytes.`
      )
    }
    return {
      needed: true,
      defaultBranch,
      baseCommitSha,
      changedFiles,
      patch
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
}

async function resolveDefaultBranch(repositoryPath, run) {
  try {
    const symbolic = await run(
      'git',
      ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'],
      { cwd: repositoryPath }
    )
    const branch = String(symbolic.stdout || '').trim().replace(/^origin\//, '')
    if (branch) return branch
  } catch {
    // Older checkouts may not have origin/HEAD; inspect known remote branches.
  }

  const listed = await run(
    'git',
    ['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin'],
    { cwd: repositoryPath }
  )
  const branches = new Set(
    String(listed.stdout || '')
      .split(/\r?\n/)
      .map(value => value.trim().replace(/^origin\//, ''))
      .filter(Boolean)
  )
  for (const candidate of ['main', 'master', 'production']) {
    if (branches.has(candidate)) return candidate
  }
  throw new Error('Could not resolve the repository default branch from Git.')
}
