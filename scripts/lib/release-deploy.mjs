import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runCommand } from './command.mjs'
import { validateProvisionedRepositorySelection } from './workspace.mjs'
import {
  assertCompletedImmutableDeployment,
  assertMergedPullRequestEvidence,
  latestCodebaseVersion
} from './release-contract.mjs'
import { VoidrRestClient } from './voidr-rest.mjs'
import { voidrCliEnvironment } from './credentials.mjs'

export async function deployMergedPullRequest({
  repositoryPath,
  repositoryUrl,
  pullRequestNumber,
  testPlanId,
  workspaceRoot = process.cwd(),
  restClient = new VoidrRestClient(),
  cliEnvironment,
  run = runCommand
}) {
  if (!Number.isInteger(Number(pullRequestNumber)) || Number(pullRequestNumber) < 1) {
    throw new Error('A valid pull request number is required.')
  }
  if (!/^[a-f0-9]{24}$/i.test(String(testPlanId || ''))) {
    throw new Error('A valid Test Plan ID is required.')
  }

  const selected = validateProvisionedRepositorySelection(
    repositoryPath,
    repositoryUrl
  )
  if (!selected.indicators.git) {
    throw new Error('The selected test repository must be a Git repository.')
  }
  if (
    selected.project?.invalid
  ) {
    throw new Error('project.json is invalid.')
  }
  if (
    selected.project &&
    String(selected.project.testPlanId || '') !== String(testPlanId)
  ) {
    throw new Error('project.json does not match the explicitly selected Test Plan.')
  }

  let source = await inspectMergedSource({
    repositoryPath: selected.path,
    pullRequestNumber: Number(pullRequestNumber),
    run
  })
  // A clean checkout that is merely behind the merged PR commit is healed
  // here: inspectMergedSource already fetched with the user's credentials
  // (the bridge runs outside the sandbox), so a fast-forward to the exact
  // merge commit is safe and deterministic. Divergent or dirty checkouts
  // still fail closed.
  if (
    source.state === 'MERGED' &&
    source.worktreeClean &&
    source.mergeCommitOnRemoteDefault &&
    source.mergeCommitSha &&
    source.localHeadSha !== source.mergeCommitSha &&
    (await fastForwardToMergeCommit({
      repositoryPath: selected.path,
      source,
      run
    }))
  ) {
    source = await inspectMergedSource({
      repositoryPath: selected.path,
      pullRequestNumber: Number(pullRequestNumber),
      run
    })
  }
  const merged = assertMergedPullRequestEvidence(source)
  const effectiveCliEnvironment =
    cliEnvironment || voidrCliEnvironment()

  await run('npx', ['--no-install', 'voidr', 'build'], {
    cwd: selected.path,
    timeout: 180_000,
    env: effectiveCliEnvironment
  })
  assertSameMergedSource(
    merged,
    await inspectMergedSource({
      repositoryPath: selected.path,
      pullRequestNumber: Number(pullRequestNumber),
      run
    })
  )
  const candidateOutput = await run(
    'npx',
    ['--no-install', 'voidr', 'deploy-candidate', '--json'],
    {
      cwd: selected.path,
      timeout: 180_000,
      env: effectiveCliEnvironment
    }
  )
  const candidate = parseCandidateOutput(candidateOutput.stdout)
  const manifest = JSON.parse(
    await readFile(join(selected.path, '.voidr', '.output', 'manifest.json'), 'utf8')
  )
  if (String(manifest.testPlanId) !== String(testPlanId)) {
    throw new Error('Built manifest does not match the explicitly selected Test Plan.')
  }
  if (manifest.codebaseVersion !== candidate.codebaseVersion) {
    throw new Error('Candidate output does not match the built immutable manifest.')
  }
  assertSameMergedSource(
    merged,
    await inspectMergedSource({
      repositoryPath: selected.path,
      pullRequestNumber: Number(pullRequestNumber),
      run
    })
  )

  const promotion = await restClient.post(
    `/test-plans/${testPlanId}/automation/versions/${candidate.codebaseVersion}/promote`,
    {}
  )
  const promotedVersion =
    promotion?.data?.codebaseVersion ?? promotion?.codebaseVersion
  if (promotedVersion !== candidate.codebaseVersion) {
    throw new Error('Voidr did not confirm promotion of the expected immutable release.')
  }

  const latest = await restClient.get(
    `/test-plans/${testPlanId}/automation/deploys/latest`
  )
  const currentVersion = latestCodebaseVersion(latest)
  const completed = assertCompletedImmutableDeployment({
    prMerged: true,
    mergeCommitSha: merged.mergeCommitSha,
    immutableCandidateVerified: true,
    codebaseVersion: candidate.codebaseVersion,
    latestVerified: currentVersion === candidate.codebaseVersion,
    latestCodebaseVersion: currentVersion
  })

  return {
    completed: true,
    pullRequest: merged,
    release: {
      ...completed,
      storagePrefix: candidate.prefix || null
    }
  }
}

async function fastForwardToMergeCommit({ repositoryPath, source, run }) {
  try {
    await run('git', ['checkout', source.defaultBranch], {
      cwd: repositoryPath,
      timeout: 60_000
    })
    await run('git', ['merge', '--ff-only', source.mergeCommitSha], {
      cwd: repositoryPath,
      timeout: 60_000
    })
    return true
  } catch {
    // Not fast-forwardable (diverged local branch); the evidence check
    // below reports the precise failure.
    return false
  }
}

export async function inspectMergedSource({
  repositoryPath,
  pullRequestNumber,
  run = runCommand
}) {
  const repo = JSON.parse(
    (
      await run('gh', ['repo', 'view', '--json', 'nameWithOwner,defaultBranchRef'], {
        cwd: repositoryPath
      })
    ).stdout
  )
  const defaultBranch = repo.defaultBranchRef?.name
  if (!defaultBranch) throw new Error('Could not resolve the repository default branch.')

  const pr = JSON.parse(
    (
      await run(
        'gh',
        [
          'pr',
          'view',
          String(pullRequestNumber),
          '--json',
          'number,url,state,mergedAt,mergeCommit,baseRefName'
        ],
        { cwd: repositoryPath }
      )
    ).stdout
  )
  await run('git', ['fetch', '--quiet', 'origin', defaultBranch], {
    cwd: repositoryPath,
    timeout: 120_000
  })
  const [head, status] = await Promise.all([
    run('git', ['rev-parse', 'HEAD'], { cwd: repositoryPath }),
    run('git', ['status', '--porcelain', '--untracked-files=all'], {
      cwd: repositoryPath
    })
  ])
  const mergeCommitSha = pr.mergeCommit?.oid || ''
  let mergeCommitOnRemoteDefault = false
  if (mergeCommitSha) {
    try {
      await run(
        'git',
        [
          'merge-base',
          '--is-ancestor',
          mergeCommitSha,
          `refs/remotes/origin/${defaultBranch}`
        ],
        { cwd: repositoryPath }
      )
      mergeCommitOnRemoteDefault = true
    } catch {
      mergeCommitOnRemoteDefault = false
    }
  }

  return {
    repository: repo.nameWithOwner,
    pullRequestNumber: pr.number,
    pullRequestUrl: pr.url,
    state: pr.state,
    mergedAt: pr.mergedAt,
    defaultBranch,
    baseBranch: pr.baseRefName,
    mergeCommitSha,
    localHeadSha: head.stdout.trim(),
    mergeCommitOnRemoteDefault,
    worktreeClean: status.stdout.trim() === ''
  }
}

function parseCandidateOutput(stdout) {
  const line = String(stdout || '')
    .split(/\r?\n/)
    .map(value => value.trim())
    .reverse()
    .find(value => value.startsWith('{') && value.endsWith('}'))
  if (!line) {
    throw new Error(
      'The installed Voidr CLI does not support immutable candidate deployment.'
    )
  }
  const parsed = JSON.parse(line)
  if (!/^[a-f0-9]{64}$/.test(String(parsed.codebaseVersion || ''))) {
    throw new Error('Voidr CLI returned no valid immutable codebaseVersion.')
  }
  return parsed
}

function assertSameMergedSource(expected, evidence) {
  const actual = assertMergedPullRequestEvidence(evidence)
  if (
    actual.pullRequestNumber !== expected.pullRequestNumber ||
    actual.defaultBranch !== expected.defaultBranch ||
    actual.mergeCommitSha !== expected.mergeCommitSha
  ) {
    throw new Error('Merged PR evidence changed while preparing the release.')
  }
}
