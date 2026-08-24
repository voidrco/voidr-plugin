const SHA256 = /^[a-f0-9]{64}$/

export function assertPromotableCandidate(evidence) {
  const exercised = String(evidence?.exercisedCodebaseVersion || '')
  const manifest = String(evidence?.manifestCodebaseVersion || '')
  if (!SHA256.test(exercised)) {
    throw new Error('A valid codebaseVersion from a completed validation is required.')
  }
  if (manifest !== exercised) {
    throw new Error(
      'The local build is not the version exercised by the completed validation. Run this build before deploying it to LIVE.'
    )
  }
  return {
    codebaseVersion: exercised
  }
}

export function assertCompletedImmutableDeployment(evidence) {
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
