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

  return {
    completed: true,
    source: {
      kind: 'validated-candidate',
      repositoryPath: selected.path,
      codebaseVersion: candidate.codebaseVersion
    },
    release: {
      ...completed
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
