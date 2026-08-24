const SHA256 = /^[a-f0-9]{64}$/

export function assertPromotableCandidate(evidence) {
  const validated = String(evidence?.validatedCodebaseVersion || '')
  const manifest = String(evidence?.manifestCodebaseVersion || '')
  if (!SHA256.test(validated)) {
    throw new Error('A valid codebaseVersion from a passing validation is required.')
  }
  if (manifest !== validated) {
    throw new Error(
      'The local build is not the version that passed validation. Validate this build before deploying it to LIVE.'
    )
  }
  return {
    codebaseVersion: validated
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
