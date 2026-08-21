import { runCommand } from './command.mjs'
import { validateProvisionedRepositorySelection } from './workspace.mjs'

// Publishes the implemented tests from the linked checkout: feature branch,
// commit, push, pull request, and the merge into the default branch. Runs in
// the bridge process — outside the Copilot shell sandbox — so the user's own
// git credentials and gh session apply.
//
// The work has to land on the default branch. A pushed branch nobody merges is
// not a delivered test: the next agent clones the default branch, does not find
// the test there, and writes it a second time. So the pull request is not
// optional and the merge is not somebody else's follow-up — this function is
// finished when the default branch contains the tests.
//
// Pushing straight to the default branch is still refused. The branch and the
// pull request are what make the change reviewable after the fact, and skipping
// them buys nothing, because this function merges anyway.
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

  const pullRequestUrl = await createOrFindPullRequest({
    repositoryPath: selected.path,
    branchName,
    defaultBranch,
    title: String(pullRequestTitle || '').trim() || message,
    body:
      String(pullRequestBody || '').trim() ||
      'Testes gerados com o plugin Voidr Copilot.',
    run
  })

  let merged = false
  if (mergeToDefaultBranch) {
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
    next: merged
      ? `Merged into ${defaultBranch}. The tests are on the default branch, so the next clone finds them and this commit is ready to deploy.`
      : `Pushed, and the pull request is open, but ${defaultBranch} does NOT have the tests yet. Until someone merges it, a fresh clone of ${defaultBranch} will not contain them. Do not report this work as delivered: say the pull request is waiting and name it — ${pullRequestUrl || branchName}.`
  }
}

// Merges the pull request into the default branch. Returns false — never
// throws — when GitHub refuses: a required review, a failing check, a conflict,
// or a protected branch are all the repository working as configured, and the
// push and the pull request survive either way. The caller has to be able to
// tell the difference, so the reason is spelled out in the returned message
// rather than left for whoever reads the logs.
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
  // gh reports success before the merge is visible on the ref often enough that
  // trusting it produces a "merged" that a later clone contradicts.
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
