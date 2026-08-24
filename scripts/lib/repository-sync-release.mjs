import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { validateProvisionedRepositorySelection } from './workspace.mjs'

export async function synchronizePublishedRepository({
  repositoryPath,
  repositoryUrl,
  testPlanId,
  codebaseVersion,
  syncRepository
}) {
  if (!/^[a-f0-9]{24}$/i.test(String(testPlanId || ''))) {
    throw new Error('A valid Test Plan ID is required.')
  }
  if (!/^[a-f0-9]{64}$/.test(String(codebaseVersion || ''))) {
    throw new Error('A valid published codebaseVersion is required.')
  }

  const selected = validateProvisionedRepositorySelection(
    repositoryPath,
    repositoryUrl
  )
  if (selected.project?.invalid) throw new Error('project.json is invalid.')
  if (
    selected.project &&
    String(selected.project.testPlanId || '') !== String(testPlanId)
  ) {
    throw new Error('project.json does not match the explicitly selected Test Plan.')
  }

  const manifest = await readJson(
    join(selected.path, '.voidr', '.output', 'manifest.json')
  )
  if (
    String(manifest.testPlanId || '') !== String(testPlanId) ||
    manifest.codebaseVersion !== codebaseVersion
  ) {
    throw new Error('The local build does not match the published LIVE source.')
  }

  const snapshot = await readJson(
    join(selected.path, '.voidr', '.output', 'repository-sync.json')
  )
  if (snapshot.codebaseVersion !== codebaseVersion) {
    throw new Error('Repository sync snapshot belongs to a different candidate.')
  }
  if (snapshot.needed === false) {
    return {
      status: 'SYNCED',
      liveValid: true,
      codebaseVersion,
      message: 'The remote default branch already contains the published source.'
    }
  }
  if (
    snapshot.needed !== true ||
    !/^[a-f0-9]{40}$/i.test(String(snapshot.baseCommitSha || '')) ||
    typeof snapshot.patch !== 'string' ||
    !snapshot.patch.trim() ||
    typeof syncRepository !== 'function'
  ) {
    return {
      status: 'FAILED',
      liveValid: true,
      codebaseVersion,
      message: 'LIVE remains published, but its repository patch is unavailable.'
    }
  }

  try {
    return await syncRepository({
      testPlanId: String(testPlanId),
      codebaseVersion,
      baseCommitSha: snapshot.baseCommitSha,
      patch: snapshot.patch
    })
  } catch (error) {
    return {
      status: 'FAILED',
      liveValid: true,
      codebaseVersion,
      message: 'LIVE remains published, but GitHub synchronization could not start.',
      detail: error instanceof Error ? error.message : String(error)
    }
  }
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    throw new Error(`Required release evidence is unavailable: ${path}`)
  }
}
