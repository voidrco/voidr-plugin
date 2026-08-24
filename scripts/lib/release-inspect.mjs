import { runCommand } from './command.mjs'
import {
  normalizeGitHubRepositoryUrl,
  resolveWorkspaceRoot,
  validateRepositorySelection
} from './workspace.mjs'

// This inspection describes Git delivery only; LIVE uses the exercised candidate.
export async function inspectReleaseReadiness({
  repositoryPath,
  workspaceRoot,
  run = runCommand
}) {
  const root = resolveWorkspaceRoot({ explicit: workspaceRoot })
  const selected = validateRepositorySelection(repositoryPath, root)
  if (!selected.indicators.git) {
    throw new Error('The selected test repository must be a Git checkout.')
  }
  const project =
    selected.project && selected.project.invalid !== true
      ? selected.project
      : null

  const originRaw = (
    await run('git', ['remote', 'get-url', 'origin'], {
      cwd: selected.path,
      timeout: 30_000
    })
  ).stdout.trim()
  const repositoryUrl = normalizeGitHubRepositoryUrl(originRaw)

  const repoInfo = JSON.parse(
    (
      await run(
        'gh',
        ['repo', 'view', '--json', 'nameWithOwner,defaultBranchRef'],
        { cwd: selected.path, timeout: 60_000 }
      )
    ).stdout
  )
  const defaultBranch = repoInfo.defaultBranchRef?.name || null
  const nameWithOwner = repoInfo.nameWithOwner || null

  const headSha = (
    await run('git', ['rev-parse', 'HEAD'], { cwd: selected.path })
  ).stdout.trim()
  const worktreeClean =
    (
      await run(
        'git',
        ['status', '--porcelain', '--untracked-files=all'],
        { cwd: selected.path }
      )
    ).stdout.trim() === ''

  let commitOnRemote = false
  if (headSha) {
    try {
      await run('git', ['fetch', '--quiet', 'origin'], {
        cwd: selected.path,
        timeout: 120_000
      })
      const remoteBranches = await run(
        'git',
        ['branch', '--remotes', '--contains', headSha],
        { cwd: selected.path }
      )
      commitOnRemote = String(remoteBranches.stdout || '').trim() !== ''
    } catch {
      // Offline, or no remote access: report false and let the guidance below
      // name the next step.
    }
  }

  const ready = Boolean(worktreeClean && project?.testPlanId && commitOnRemote)

  return {
    repositoryPath: selected.path,
    repositoryUrl,
    project,
    defaultBranch,
    headSha,
    worktreeClean,
    commitOnRemote,
    ready,
    next: ready
      ? `Git delivery is traceable at ${headSha}. This is not a LIVE deploy gate: LIVE must promote the exact codebaseVersion exercised by a completed validation.`
      : !project?.testPlanId
        ? 'project.json is missing or has no testPlanId; prepare the repository through the linked Test Plan before validation.'
        : !worktreeClean
          ? 'The worktree has uncommitted changes. Try voidr_workspace_publish_tests with mergeToDefaultBranch true. Report any Git failure, but do not block promotion of the exercised candidate.'
          : 'The commit at HEAD is not on the remote. Try voidr_workspace_publish_tests with mergeToDefaultBranch true. Report any Git failure, but do not block promotion of the exercised candidate.'
  }
}
