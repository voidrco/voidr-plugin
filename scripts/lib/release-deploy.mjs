import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runCommand } from './command.mjs'
import { validateProvisionedRepositorySelection } from './workspace.mjs'
import {
  assertCompletedImmutableDeployment,
  assertDeployableSourceEvidence,
  latestCodebaseVersion
} from './release-contract.mjs'
import { VoidrRestClient } from './voidr-rest.mjs'
import { voidrCliEnvironment } from './credentials.mjs'

export async function deployRelease({
  repositoryPath,
  repositoryUrl,
  testPlanId,
  workspaceRoot = process.cwd(),
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

  const sourceEvidence = await inspectDeploySource({
    repositoryPath: selected.path,
    run
  })
  const deployed = assertDeployableSourceEvidence(sourceEvidence)
  const effectiveCliEnvironment =
    cliEnvironment || voidrCliEnvironment()

  await run('npx', ['--no-install', 'voidr', 'build'], {
    cwd: selected.path,
    timeout: 180_000,
    env: effectiveCliEnvironment
  })
  assertSameSource(
    deployed,
    await inspectDeploySource({ repositoryPath: selected.path, run })
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
  assertSameSource(
    deployed,
    await inspectDeploySource({ repositoryPath: selected.path, run })
  )

  // `deploy-latest` publishes the SAME build the candidate was cut from: it
  // reads the manifest already on disk, whose codebaseVersion `deploy-candidate`
  // computed and wrote, so the released version stays verifiable against the one
  // that was validated. It also syncs the automation manifest with the platform,
  // which is what carries `preflight.enabled` onto the Test Plan — a candidate
  // deploy never does that, so a plan whose first preflight arrives with this
  // release only learns about it here.
  const published = await run('npx', ['--no-install', 'voidr', 'deploy-latest'], {
    cwd: selected.path,
    timeout: 300_000,
    env: effectiveCliEnvironment
  })
  // Without this the CLI's own words are lost, and a release that never left
  // the machine reports itself as an unverified pointer — a verdict that names
  // the check instead of the cause, and sends the next attempt guessing.
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
  // `deploy-latest` treats the manifest sync as optional: it prints the failure
  // and still exits zero. When that happens the files are uploaded but no deploy
  // record is written, so the pointer cannot verify and the plan keeps reporting
  // nothing automated. The CLI already said why — this is where it gets read.
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
    commitSha: deployed.commitSha,
    immutableCandidateVerified: true,
    codebaseVersion: candidate.codebaseVersion,
    latestVerified: currentVersion === candidate.codebaseVersion,
    latestCodebaseVersion: currentVersion
  })

  return {
    completed: true,
    source: deployed,
    release: {
      ...completed,
      storagePrefix: candidate.prefix || null
    }
  }
}

// The source of a release is the commit the checkout is on. No pull request is
// consulted: the questions are whether the build matches what is committed
// (clean worktree) and whether anyone else can fetch that commit later (it is
// on the remote) — the traceability a merged PR used to carry.
export async function inspectDeploySource({ repositoryPath, run = runCommand }) {
  const repo = JSON.parse(
    (
      await run('gh', ['repo', 'view', '--json', 'nameWithOwner,defaultBranchRef'], {
        cwd: repositoryPath
      })
    ).stdout
  )
  await run('git', ['fetch', '--quiet', 'origin'], {
    cwd: repositoryPath,
    timeout: 120_000
  })
  const [head, status] = await Promise.all([
    run('git', ['rev-parse', 'HEAD'], { cwd: repositoryPath }),
    run('git', ['status', '--porcelain', '--untracked-files=all'], {
      cwd: repositoryPath
    })
  ])
  const commitSha = head.stdout.trim()
  let commitOnRemote = false
  if (commitSha) {
    const remoteBranches = await run(
      'git',
      ['branch', '--remotes', '--contains', commitSha],
      { cwd: repositoryPath }
    ).catch(() => ({ stdout: '' }))
    commitOnRemote = String(remoteBranches.stdout || '').trim() !== ''
  }

  return {
    repository: repo.nameWithOwner || null,
    defaultBranch: repo.defaultBranchRef?.name || null,
    commitSha,
    localHeadSha: commitSha,
    commitOnRemote,
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

function assertSameSource(expected, evidence) {
  const actual = assertDeployableSourceEvidence(evidence)
  if (actual.commitSha !== expected.commitSha) {
    throw new Error('The deploy source changed while preparing the release.')
  }
}

// The CLI dumps the whole failing request before printing its own summary, so
// the server's explanation sits in the MIDDLE of the output: a plain tail loses
// it, which is how a 400 from the platform reached the user as "no
// codebaseVersion" three times in a row. Lines that carry a reason are kept
// first, and the tail is appended for context.
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
