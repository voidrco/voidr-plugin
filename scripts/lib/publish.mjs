import { runCommand } from './command.mjs'
import { validateProvisionedRepositorySelection } from './workspace.mjs'

export async function publishTests({
  repositoryPath,
  repositoryUrl,
  branch,
  commitMessage,
  pullRequestTitle,
  pullRequestBody,
  mergeToDefaultBranch = true,
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
      `Never push directly to the default branch (${defaultBranch}). Pass a feature branch name instead: this call pushes that branch, opens the pull request, and merges it into ${defaultBranch} for you.`
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
  let merged = false
  if (mergeToDefaultBranch) {
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
    merged = await mergePullRequest({
      repositoryPath: selected.path,
      branchName,
      defaultBranch,
      pullRequestUrl,
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
    merged,
    readyToDeploy: true,
    next: !mergeToDefaultBranch
      ? `Pushed commit ${commitSha} to ${branchName}. The default branch (${defaultBranch}) was not changed. Git delivery does not decide LIVE: a separately approved deploy must promote the exact candidate that passed validation.`
      : merged
        ? `Merged into ${defaultBranch}. The tests are on the default branch, so the next clone finds them. LIVE still promotes the separately validated candidate.`
        : `Pushed, and the pull request is open, but ${defaultBranch} does NOT have the tests yet. Report that truth and name the waiting pull request — ${pullRequestUrl || branchName}. Do not block a separately approved LIVE deploy of the validated candidate.`
  }
}

async function mergePullRequest({
  repositoryPath,
  branchName,
  defaultBranch,
  pullRequestUrl,
  run
}) {
  const target = pullRequestUrl || branchName
  try {
    await run('gh', ['pr', 'merge', target, '--merge'], {
      cwd: repositoryPath,
      timeout: 180_000
    })
  } catch (error) {
    return false
  }
  // Verify the remote ref because gh can report success before the merge is visible.
  await run('git', ['fetch', 'origin', defaultBranch], {
    cwd: repositoryPath,
    timeout: 120_000
  }).catch(() => null)
  const contains = await run(
    'git',
    ['merge-base', '--is-ancestor', branchName, `origin/${defaultBranch}`],
    { cwd: repositoryPath, timeout: 60_000 }
  ).then(
    () => true,
    () => false
  )
  return contains
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
