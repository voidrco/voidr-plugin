const FULL_GIT_SHA = /^[a-f0-9]{40}$/i
const SHA256 = /^[a-f0-9]{64}$/

// A release no longer needs a merged pull request. What it still needs is a
// source another person can find later: the exact commit the build came from,
// clean on disk and present on the remote.
export function assertDeployableSourceEvidence(evidence) {
  const required = ['commitSha', 'localHeadSha']
  for (const field of required) {
    if (evidence?.[field] === undefined || evidence[field] === null) {
      throw new Error(`Missing deploy source evidence: ${field}.`)
    }
  }
  if (!FULL_GIT_SHA.test(String(evidence.commitSha))) {
    throw new Error('The deploy source has no valid commit SHA.')
  }
  if (evidence.localHeadSha !== evidence.commitSha) {
    throw new Error(
      'The selected repository HEAD moved. Build and deploy must run from the same commit.'
    )
  }
  if (!evidence.commitOnRemote) {
    throw new Error(
      'The commit is not on the remote. Push it so the release stays traceable to a commit others can fetch.'
    )
  }
  if (!evidence.worktreeClean) {
    throw new Error('The selected repository has uncommitted or untracked changes.')
  }
  return {
    repository: evidence.repository ?? null,
    defaultBranch: evidence.defaultBranch ?? null,
    commitSha: String(evidence.commitSha).toLowerCase()
  }
}

export function assertCompletedImmutableDeployment(evidence) {
  if (!FULL_GIT_SHA.test(String(evidence?.commitSha || ''))) {
    throw new Error('Deployment has no valid source commit SHA.')
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
    commitSha: String(evidence.commitSha).toLowerCase(),
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
