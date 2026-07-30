import { runCommand } from './command.mjs'
import {
  normalizeGitHubRepositoryUrl,
  resolveWorkspaceRoot,
  validateRepositorySelection
} from './workspace.mjs'

// Read-only release readiness inspection. Everything the deploy needs —
// Test Plan ID, repository URL, default branch, and the merged PR for the
// current HEAD — is discovered from the checkout itself (project.json, Git
// origin, gh) so the model never has to ask the user for identifiers.
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

  let mergedPullRequest = null
  if (nameWithOwner) {
    try {
      const pulls = JSON.parse(
        (
          await run(
            'gh',
            ['api', `repos/${nameWithOwner}/commits/${headSha}/pulls`],
            { cwd: selected.path, timeout: 60_000 }
          )
        ).stdout
      )
      const candidates = (Array.isArray(pulls) ? pulls : []).filter(
        pull => pull?.merged_at && pull?.base?.ref === defaultBranch
      )
      const exact = candidates.find(
        pull => pull?.merge_commit_sha === headSha
      )
      const chosen = exact || candidates[0] || null
      if (chosen) {
        mergedPullRequest = {
          number: chosen.number,
          url: chosen.html_url,
          mergedAt: chosen.merged_at,
          mergeCommitSha: chosen.merge_commit_sha,
          headIsMergeCommit: chosen.merge_commit_sha === headSha
        }
      }
    } catch {
      // gh may be unauthenticated or offline; report null and let the
      // guidance below explain the next step.
    }
  }

  const ready = Boolean(
    worktreeClean &&
      project?.testPlanId &&
      mergedPullRequest?.headIsMergeCommit
  )

  return {
    repositoryPath: selected.path,
    repositoryUrl,
    project,
    defaultBranch,
    headSha,
    worktreeClean,
    mergedPullRequest,
    ready,
    next: ready
      ? `Show this summary to the user and, after confirmation, call voidr_release_deploy_merged_pr with testPlanId ${project.testPlanId}, repositoryUrl ${repositoryUrl}, and pullRequestNumber ${mergedPullRequest.number}. Do not ask the user for these values.`
      : !project?.testPlanId
        ? 'project.json is missing or has no testPlanId; prepare the repository through the linked Test Plan before deploying.'
        : !worktreeClean
          ? 'The worktree has uncommitted changes; publish them through voidr_workspace_publish_tests and merge the pull request before deploying.'
          : !mergedPullRequest
            ? 'No merged pull request was found for the current HEAD. Publish the tests with voidr_workspace_publish_tests, merge the PR, run git pull on the default branch, and inspect again.'
            : 'HEAD is not the merge commit of the merged PR. Check out the default branch and git pull so HEAD matches the merge commit, then inspect again.'
  }
}
