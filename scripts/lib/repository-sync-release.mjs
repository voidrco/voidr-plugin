import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { publishCurrentCommit } from './publish.mjs'
import { createRepositorySyncPatch } from './repository-sync.mjs'
import { validateProvisionedRepositorySelection } from './workspace.mjs'

export async function synchronizePublishedRepository({
  repositoryPath,
  repositoryUrl,
  testPlanId,
  codebaseVersion,
  publishLocal = publishCurrentCommit,
  buildPatch = createRepositorySyncPatch,
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
    !snapshot.patch.trim()
  ) {
    return {
      status: 'FAILED',
      liveValid: true,
      codebaseVersion,
      message: 'LIVE remains published, but its repository patch is unavailable.'
    }
  }

  let localDeliveryError = null
  try {
    const current = await buildPatch({ repositoryPath: selected.path })
    if (!sameSnapshot(current, snapshot)) {
      throw new Error(
        'The local checkpoint does not contain exactly the source published in LIVE.'
      )
    }
    const local = await publishLocal({
      repositoryPath: selected.path,
      repositoryUrl
    })
    if (local.merged === true) {
      return {
        status: 'SYNCED',
        liveValid: true,
        codebaseVersion,
        delivery: 'LOCAL_GITHUB',
        branchName: local.branch,
        commitSha: local.commitSha,
        pullRequestUrl: local.pullRequestUrl,
        message:
          'LIVE is published and the same source was merged using the user GitHub session.'
      }
    }
    if (local.pushed === true && local.pullRequestUrl) {
      return {
        status: 'QUEUED',
        liveValid: true,
        codebaseVersion,
        delivery: 'LOCAL_GITHUB',
        branchName: local.branch,
        commitSha: local.commitSha,
        pullRequestUrl: local.pullRequestUrl,
        message:
          'LIVE is published and the user pull request is waiting to merge.'
      }
    }
    throw new Error('The local GitHub delivery did not reach a pull request.')
  } catch (error) {
    localDeliveryError = error instanceof Error ? error.message : String(error)
  }

  if (typeof syncRepository !== 'function') {
    return {
      status: 'FAILED',
      liveValid: true,
      codebaseVersion,
      message:
        'LIVE remains published, but neither local GitHub delivery nor Voidr Bot synchronization could start.',
      localDeliveryError
    }
  }

  try {
    const synchronized = await syncRepository({
      testPlanId: String(testPlanId),
      codebaseVersion,
      baseCommitSha: snapshot.baseCommitSha,
      patch: snapshot.patch
    })
    return {
      ...synchronized,
      delivery: 'VOIDR_BOT',
      localDeliveryError
    }
  } catch (error) {
    return {
      status: 'FAILED',
      liveValid: true,
      codebaseVersion,
      message: 'LIVE remains published, but GitHub synchronization could not start.',
      detail: error instanceof Error ? error.message : String(error),
      localDeliveryError
    }
  }
}

function sameSnapshot(current, snapshot) {
  if (
    current?.needed !== true ||
    current.baseCommitSha !== snapshot.baseCommitSha ||
    current.patch !== snapshot.patch
  ) {
    return false
  }
  const currentFiles = [...(current.changedFiles || [])].sort()
  const snapshotFiles = [...(snapshot.changedFiles || [])].sort()
  return JSON.stringify(currentFiles) === JSON.stringify(snapshotFiles)
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    throw new Error(`Required release evidence is unavailable: ${path}`)
  }
}
