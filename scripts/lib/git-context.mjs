import { runCommand } from './command.mjs'
import {
  inspectWorkspace,
  resolveWorkspaceRoot,
  canonicalizePotentialPath
} from './workspace.mjs'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

// Read-only Git discovery through the bridge. Paths arrive as JSON strings,
// so workspace folders with spaces or dashes never hit shell quoting, and
// the sandbox never gets a chance to deny the read. This is the only
// sanctioned way to infer the developer's feature from branches and diffs.
export async function collectGitContext({
  workspaceRoot,
  repositoryPath,
  maxRepositories = 8,
  run = runCommand
}) {
  const root = resolveWorkspaceRoot({ explicit: workspaceRoot })
  const targets = []
  if (repositoryPath) {
    targets.push(canonicalizePotentialPath(resolve(root, repositoryPath)))
  } else {
    if (existsSync(join(root, '.git'))) targets.push(root)
    for (const candidate of inspectWorkspace(root, 3).candidates) {
      if (candidate.indicators.git) targets.push(candidate.path)
    }
  }

  const inspected = targets.slice(0, maxRepositories)
  const skipped = targets.slice(maxRepositories)
  const repositories = []
  for (const path of inspected) {
    repositories.push(await describeRepository({ path, run }))
  }
  if (!skipped.length) return { workspaceRoot: root, repositories }
  return {
    workspaceRoot: root,
    repositories,
    repositoriesNotInspected: skipped,
    note: `The workspace has more repositories than this tool inspects at once (${maxRepositories}). ${skipped.length} were not inspected and are listed in repositoriesNotInspected. If the feature repository is among them, call this tool again with repositoryPath set to its path.`
  }
}

async function describeRepository({ path, run }) {
  const git = async args => {
    try {
      return (
        await run('git', args, { cwd: path, timeout: 30_000 })
      ).stdout.trim()
    } catch {
      return null
    }
  }

  const currentBranch = await git(['branch', '--show-current'])
  const defaultBranch = await resolveDefaultBranch(git)
  const dirty = Boolean(await git(['status', '--porcelain']))
  const recentCommits = splitLines(
    await git(['log', '--oneline', '--no-decorate', '-5'])
  )

  let changedFilesVsDefault = []
  let commitsAheadOfDefault = null
  let changedHunksVsDefault = null
  if (defaultBranch && defaultBranch !== currentBranch) {
    changedFilesVsDefault = splitLines(
      await git(['diff', '--name-only', `${defaultBranch}...HEAD`])
    ).slice(0, 100)
    const ahead = await git([
      'rev-list',
      '--count',
      `${defaultBranch}..HEAD`
    ])
    commitsAheadOfDefault = ahead === null ? null : Number(ahead)
    changedHunksVsDefault = await collectChangedHunks(
      git,
      defaultBranch,
      changedFilesVsDefault
    )
  }

  return {
    path,
    currentBranch,
    defaultBranch,
    dirty,
    commitsAheadOfDefault,
    changedFilesVsDefault,
    changedHunksVsDefault,
    recentCommits,
    onFeatureBranch: Boolean(
      currentBranch && defaultBranch && currentBranch !== defaultBranch
    )
  }
}

const MAX_DIFF_CHARACTERS = 12_000
const MAX_DIFF_FILES = 20

// The changed hunks are the feature. Returning them here is what keeps the
// scenario derivation anchored to the actual change instead of to whatever
// arbitrary line window of the product code happens to get read.
async function collectChangedHunks(git, defaultBranch, files) {
  if (!files.length) return null
  const raw = await git([
    'diff',
    '--unified=2',
    '--no-color',
    `${defaultBranch}...HEAD`,
    '--',
    ...files.slice(0, MAX_DIFF_FILES)
  ])
  if (!raw) return null
  const omittedFiles = Math.max(0, files.length - MAX_DIFF_FILES)
  if (raw.length <= MAX_DIFF_CHARACTERS) {
    return {
      diff: raw,
      truncated: false,
      ...(omittedFiles
        ? {
            note: `${omittedFiles} changed file(s) beyond the first ${MAX_DIFF_FILES} are not in this diff; they are listed in changedFilesVsDefault.`
          }
        : {})
    }
  }
  return {
    // Cut on a line boundary: half of a diff line reads as different code
    // than the change actually made.
    diff: truncateToWholeLines(raw, MAX_DIFF_CHARACTERS),
    truncated: true,
    note: `Diff truncated at ${MAX_DIFF_CHARACTERS} characters${omittedFiles ? ` and limited to the first ${MAX_DIFF_FILES} changed files` : ''}. Read the remaining changed files listed in changedFilesVsDefault to see the rest of the change.`
  }
}

function truncateToWholeLines(value, maxCharacters) {
  const capped = value.slice(0, maxCharacters)
  const lastBreak = capped.lastIndexOf('\n')
  // A single line longer than the cap has no boundary to fall back to.
  return lastBreak > 0 ? capped.slice(0, lastBreak + 1) : capped
}

async function resolveDefaultBranch(git) {
  const remoteHead = await git([
    'symbolic-ref',
    '--short',
    'refs/remotes/origin/HEAD'
  ])
  if (remoteHead) return remoteHead.replace(/^origin\//, '')
  for (const candidate of ['main', 'master']) {
    const exists = await git([
      'rev-parse',
      '--verify',
      '--quiet',
      candidate
    ])
    if (exists) return candidate
  }
  return null
}

function splitLines(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
}
