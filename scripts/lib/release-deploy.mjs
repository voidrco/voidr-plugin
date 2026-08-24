import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runCommand } from './command.mjs'
import { validateProvisionedRepositorySelection } from './workspace.mjs'
import {
  assertCompletedImmutableDeployment,
  assertPromotableCandidate,
  latestCodebaseVersion
} from './release-contract.mjs'
import { VoidrRestClient } from './voidr-rest.mjs'
import { voidrCliEnvironment } from './credentials.mjs'

export async function deployRelease({
  repositoryPath,
  repositoryUrl,
  testPlanId,
  codebaseVersion,
  restClient = new VoidrRestClient(),
  cliEnvironment,
  syncRepository,
  run = runCommand
}) {
  if (!/^[a-f0-9]{24}$/i.test(String(testPlanId || ''))) {
    throw new Error('A valid Test Plan ID is required.')
  }

  const selected = validateProvisionedRepositorySelection(
    repositoryPath,
    repositoryUrl
  )
  if (selected.project?.invalid) {
    throw new Error('project.json is invalid.')
  }
  if (
    selected.project &&
    String(selected.project.testPlanId || '') !== String(testPlanId)
  ) {
    throw new Error('project.json does not match the explicitly selected Test Plan.')
  }

  const effectiveCliEnvironment = cliEnvironment || voidrCliEnvironment()

  const manifest = JSON.parse(
    await readFile(join(selected.path, '.voidr', '.output', 'manifest.json'), 'utf8')
  )
  if (String(manifest.testPlanId) !== String(testPlanId)) {
    throw new Error('Built manifest does not match the explicitly selected Test Plan.')
  }
  const candidate = assertPromotableCandidate({
    exercisedCodebaseVersion: codebaseVersion,
    manifestCodebaseVersion: manifest.codebaseVersion
  })
  const repositorySync = await readRepositorySyncSnapshot(
    selected.path,
    candidate.codebaseVersion
  )

  const published = await run('npx', ['--no-install', 'voidr', 'deploy-latest'], {
    cwd: selected.path,
    timeout: 300_000,
    env: effectiveCliEnvironment
  })
  if (published?.exitCode !== undefined && published.exitCode !== 0) {
    throw new Error(
      'voidr deploy-latest failed, so nothing was published. It reported:\n' +
        releaseCommandExcerpt(published)
    )
  }

  const latest = await restClient.get(
    `/test-plans/${testPlanId}/automation/deploys/latest`
  )
  const currentVersion = latestCodebaseVersion(latest)
  if (currentVersion !== candidate.codebaseVersion) {
    throw new Error(
      'The published release was not registered on the platform: ' +
        `deploys/latest reports ${currentVersion || 'no codebaseVersion'}, ` +
        `the build published was ${candidate.codebaseVersion}. ` +
        'voidr deploy-latest reported:\n' +
        releaseCommandExcerpt(published)
    )
  }
  const completed = assertCompletedImmutableDeployment({
    immutableCandidateVerified: true,
    codebaseVersion: candidate.codebaseVersion,
    latestVerified: currentVersion === candidate.codebaseVersion,
    latestCodebaseVersion: currentVersion
  })
  const gitSync = await synchronizePublishedSource({
    repositorySync,
    testPlanId: String(testPlanId),
    codebaseVersion: candidate.codebaseVersion,
    syncRepository
  })

  return {
    completed: true,
    source: {
      kind: 'validated-candidate',
      repositoryPath: selected.path,
      codebaseVersion: candidate.codebaseVersion
    },
    release: {
      ...completed
    },
    gitSync
  }
}

async function readRepositorySyncSnapshot(repositoryPath, codebaseVersion) {
  try {
    const snapshot = JSON.parse(
      await readFile(
        join(repositoryPath, '.voidr', '.output', 'repository-sync.json'),
        'utf8'
      )
    )
    if (snapshot.codebaseVersion !== codebaseVersion) {
      throw new Error('Repository sync snapshot belongs to a different candidate.')
    }
    return snapshot
  } catch (error) {
    return {
      needed: null,
      error:
        error instanceof Error
          ? error.message
          : 'Repository sync snapshot is unavailable.'
    }
  }
}

async function synchronizePublishedSource({
  repositorySync,
  testPlanId,
  codebaseVersion,
  syncRepository
}) {
  if (repositorySync?.needed === false) {
    return {
      status: 'SYNCED',
      liveValid: true,
      codebaseVersion,
      message: 'The remote default branch already contains the published source.'
    }
  }
  if (!repositorySync?.needed || typeof syncRepository !== 'function') {
    return {
      status: 'FAILED',
      liveValid: true,
      codebaseVersion,
      message:
        'LIVE is published, but the repository synchronization patch was not available.',
      detail: repositorySync?.error || null
    }
  }
  try {
    return await syncRepository({
      testPlanId,
      codebaseVersion,
      baseCommitSha: repositorySync.baseCommitSha,
      patch: repositorySync.patch
    })
  } catch (error) {
    return {
      status: 'FAILED',
      liveValid: true,
      codebaseVersion,
      message: 'LIVE is published, but repository synchronization could not be started.',
      detail: error instanceof Error ? error.message : String(error)
    }
  }
}

// Keep server-reported reasons because the useful error can precede the command tail.
function releaseCommandExcerpt({ stderr, stdout } = {}) {
  const text = `${stderr || ''}\n${stdout || ''}`.trim()
  if (!text) return 'The command produced no output.'
  const lines = text.split('\n')
  const reasons = lines.filter(line =>
    /"?(message|error|errors|detail|details)"?\s*[:=]|Validation failed|status code \d{3}/i.test(
      line
    )
  )
  const selected = [...new Set([...reasons.slice(0, 12), ...lines.slice(-12)])]
  const excerpt = selected.join('\n')
  return excerpt.length > 2500 ? `${excerpt.slice(0, 2500)}…` : excerpt
}
