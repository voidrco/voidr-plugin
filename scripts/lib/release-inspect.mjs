import { runCommand } from './command.mjs'
import {
  normalizeGitHubRepositoryUrl,
  resolveWorkspaceRoot,
  validateRepositorySelection
} from './workspace.mjs'

// Read-only release readiness inspection. Everything the deploy needs — Test
// Plan ID, repository URL, default branch, and the commit being released — is
// discovered from the checkout itself (project.json, Git origin, gh) so the
// model never has to ask the user for identifiers.
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

  // A release is traceable when the commit it was built from is on the remote,
  // so someone else can fetch it later. That is what a merged pull request used
  // to prove, and it is all that is required now.
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
      ? `Show this summary to the user and, after confirmation, call voidr_release_deploy_live with testPlanId ${project.testPlanId} and repositoryUrl ${repositoryUrl}. Do not ask the user for these values.`
      : !project?.testPlanId
        ? 'project.json is missing or has no testPlanId; prepare the repository through the linked Test Plan before deploying.'
        : !worktreeClean
          ? 'The worktree has uncommitted changes; publish them through voidr_workspace_publish_tests before deploying, so the release matches a commit.'
          : 'The commit at HEAD is not on the remote. Push it through voidr_workspace_publish_tests and inspect again, so the release stays traceable to a commit others can fetch.'
  }
}
