import { runCommand } from './command.mjs'
import { validateProvisionedRepositorySelection } from './workspace.mjs'

// Publishes the implemented tests from the linked checkout: feature branch,
// commit, push, and pull request. Runs in the bridge process — outside the
// Copilot shell sandbox — so the user's own git credentials and gh session
// apply. Pushing to the default branch is refused because the immutable
// deploy requires a merged pull request.
export async function publishTests({
  repositoryPath,
  repositoryUrl,
  branch,
  commitMessage,
  pullRequestTitle,
  pullRequestBody,
  createPullRequest = true,
  run = runCommand
}) {
  const selected = validateProvisionedRepositorySelection(
    repositoryPath,
    repositoryUrl
  )
  const branchName = String(branch || '').trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branchName)) {
    throw new Error('A valid feature branch name is required.')
  }
  const message = String(commitMessage || '').trim()
  if (!message) throw new Error('A commit message is required.')

  const repoInfo = JSON.parse(
    (
      await run('gh', ['repo', 'view', '--json', 'defaultBranchRef'], {
        cwd: selected.path,
        timeout: 60_000
      })
    ).stdout
  )
  const defaultBranch = repoInfo.defaultBranchRef?.name
  if (!defaultBranch) {
    throw new Error('Could not resolve the repository default branch.')
  }
  if (branchName === defaultBranch) {
    throw new Error(
      `Never push directly to the default branch (${defaultBranch}). Publish a feature branch and open a pull request; the immutable deploy requires a merged PR.`
    )
  }

  await run('git', ['checkout', '-B', branchName], {
    cwd: selected.path,
    timeout: 60_000
  })
  await run('git', ['add', '-A'], { cwd: selected.path, timeout: 60_000 })
  const status = await run(
    'git',
    ['status', '--porcelain', '--untracked-files=all'],
    { cwd: selected.path }
  )
  let committed = false
  if (String(status.stdout || '').trim()) {
    await run('git', ['commit', '-m', message], {
      cwd: selected.path,
      timeout: 60_000
    })
    committed = true
  }
  const commitSha = (
    await run('git', ['rev-parse', 'HEAD'], { cwd: selected.path })
  ).stdout.trim()

  await run('git', ['push', '-u', 'origin', `${branchName}:${branchName}`], {
    cwd: selected.path,
    timeout: 180_000
  })

  let pullRequestUrl = null
  if (createPullRequest) {
    pullRequestUrl = await createOrFindPullRequest({
      repositoryPath: selected.path,
      branchName,
      defaultBranch,
      title: String(pullRequestTitle || '').trim() || message,
      body:
        String(pullRequestBody || '').trim() ||
        'Testes gerados com o plugin Voidr Copilot.',
      run
    })
  }

  return {
    completed: true,
    branch: branchName,
    defaultBranch,
    committed,
    commitSha,
    pushed: true,
    pullRequestUrl,
    next: pullRequestUrl
      ? 'Ask the user to review and merge the pull request; deployment requires the merged PR.'
      : 'Push completed without a pull request; one is required before deployment.'
  }
}

async function createOrFindPullRequest({
  repositoryPath,
  branchName,
  defaultBranch,
  title,
  body,
  run
}) {
  try {
    const created = await run(
      'gh',
      [
        'pr',
        'create',
        '--head',
        branchName,
        '--base',
        defaultBranch,
        '--title',
        title,
        '--body',
        body
      ],
      { cwd: repositoryPath, timeout: 120_000 }
    )
    return extractPullRequestUrl(created.stdout)
  } catch (error) {
    // gh pr create fails when a PR for the branch already exists; reuse it.
    const existing = await run(
      'gh',
      ['pr', 'view', branchName, '--json', 'url'],
      { cwd: repositoryPath, timeout: 60_000 }
    ).catch(() => null)
    const url = existing
      ? String(JSON.parse(existing.stdout || '{}').url || '')
      : ''
    if (url) return url
    throw error
  }
}

function extractPullRequestUrl(stdout) {
  const match = String(stdout || '').match(
    /https:\/\/github\.com\/\S+\/pull\/\d+/
  )
  return match ? match[0] : null
}
