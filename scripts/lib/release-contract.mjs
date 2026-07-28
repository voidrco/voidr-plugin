const FULL_GIT_SHA = /^[a-f0-9]{40}$/i
const SHA256 = /^[a-f0-9]{64}$/

export function assertMergedPullRequestEvidence(evidence) {
  const required = [
    'pullRequestNumber',
    'pullRequestUrl',
    'state',
    'defaultBranch',
    'baseBranch',
    'mergeCommitSha',
    'localHeadSha'
  ]
  for (const field of required) {
    if (evidence?.[field] === undefined || evidence[field] === null) {
      throw new Error(`Missing merged PR evidence: ${field}.`)
    }
  }
  if (evidence.state !== 'MERGED' || !evidence.mergedAt) {
    throw new Error('The pull request is not merged.')
  }
  if (evidence.baseBranch !== evidence.defaultBranch) {
    throw new Error(
      `The pull request targets ${evidence.baseBranch}, not the default branch ${evidence.defaultBranch}.`
    )
  }
  if (!FULL_GIT_SHA.test(evidence.mergeCommitSha)) {
    throw new Error('The pull request has no valid merge commit SHA.')
  }
  if (evidence.localHeadSha !== evidence.mergeCommitSha) {
    throw new Error(
      'The selected repository HEAD is not the merged PR commit. Build and deploy must run from that exact commit.'
    )
  }
  if (!evidence.mergeCommitOnRemoteDefault) {
    throw new Error('The merged PR commit is not present on origin/default.')
  }
  if (!evidence.worktreeClean) {
    throw new Error('The selected repository has uncommitted or untracked changes.')
  }
  return {
    pullRequestNumber: Number(evidence.pullRequestNumber),
    pullRequestUrl: evidence.pullRequestUrl,
    defaultBranch: evidence.defaultBranch,
    mergeCommitSha: evidence.mergeCommitSha.toLowerCase(),
    mergedAt: evidence.mergedAt
  }
}

export function assertCompletedImmutableDeployment(evidence) {
  if (!evidence?.prMerged) {
    throw new Error('Deployment cannot complete without a merged pull request.')
  }
  if (!FULL_GIT_SHA.test(String(evidence.mergeCommitSha || ''))) {
    throw new Error('Deployment has no valid merged commit SHA.')
  }
  if (!evidence.immutableCandidateVerified) {
    throw new Error('The immutable candidate was not verified.')
  }
  if (!SHA256.test(String(evidence.codebaseVersion || ''))) {
    throw new Error('Deployment has no valid immutable codebaseVersion.')
  }
  if (!evidence.latestVerified) {
    throw new Error('The latest release pointer was not verified.')
  }
  if (evidence.latestCodebaseVersion !== evidence.codebaseVersion) {
    throw new Error('Latest does not point to the promoted immutable release.')
  }
  return {
    mergeCommitSha: evidence.mergeCommitSha.toLowerCase(),
    codebaseVersion: evidence.codebaseVersion,
    latestCodebaseVersion: evidence.latestCodebaseVersion
  }
}

export function latestCodebaseVersion(payload) {
  const value =
    payload?.data?.manifestData?.codebaseVersion ??
    payload?.data?.codebaseVersion ??
    payload?.manifestData?.codebaseVersion ??
    payload?.codebaseVersion
  return typeof value === 'string' ? value : null
}
