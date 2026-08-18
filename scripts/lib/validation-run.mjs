import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runCommand } from './command.mjs'
import { validateProvisionedRepositorySelection } from './workspace.mjs'
import { VoidrRestClient } from './voidr-rest.mjs'
import { voidrCliEnvironment } from './credentials.mjs'

// A validation run never touches the main pipeline: the candidate is uploaded
// under its own content-addressed codebaseVersion and is NOT promoted, so
// `latest` — what monitoring, self-healing, and LIVE runs execute — stays
// exactly as it was. No pull request or merge is required for it.
export async function deployValidationCandidate({
  repositoryPath,
  repositoryUrl,
  testPlanId,
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
  if (selected.project?.invalid) throw new Error('project.json is invalid.')
  if (
    !selected.project ||
    String(selected.project.testPlanId || '') !== String(testPlanId)
  ) {
    throw new Error(
      'project.json does not match the explicitly selected Test Plan.'
    )
  }

  const effectiveCliEnvironment = cliEnvironment || voidrCliEnvironment()

  await run('npx', ['--no-install', 'voidr', 'build'], {
    cwd: selected.path,
    timeout: 180_000,
    env: effectiveCliEnvironment
  })
  // An older CLI has no deploy-candidate at all: commander exits with
  // "unknownCommand" before printing anything, so the parse below never gets
  // to explain it. Without this the user reads raw commander JSON.
  let candidateOutput
  try {
    candidateOutput = await run(
      'npx',
      ['--no-install', 'voidr', 'deploy-candidate', '--json'],
      {
        cwd: selected.path,
        timeout: 180_000,
        env: effectiveCliEnvironment
      }
    )
  } catch (error) {
    if (/unknown\s*command/i.test(String(error?.message || error))) {
      throw new Error(
        'The Voidr CLI in this test repository has no deploy-candidate ' +
          'command, so a validation candidate cannot be uploaded without ' +
          'promoting it. Updating the framework does not help yet: the ' +
          'command is not in any published @voidrco/playwright release, so ' +
          'it has to be released first. Report this to the user and stop. Do ' +
          'not fall back to deploy-latest: it would overwrite the promoted ' +
          'release the main pipeline runs.'
      )
    }
    throw error
  }
  const candidate = parseCandidateOutput(candidateOutput.stdout)
  const manifest = JSON.parse(
    await readFile(
      join(selected.path, '.voidr', '.output', 'manifest.json'),
      'utf8'
    )
  )
  if (String(manifest.testPlanId) !== String(testPlanId)) {
    throw new Error(
      'Built manifest does not match the explicitly selected Test Plan.'
    )
  }
  if (manifest.codebaseVersion !== candidate.codebaseVersion) {
    throw new Error('Candidate output does not match the built immutable manifest.')
  }

  return {
    completed: true,
    validationDeploy: true,
    promoted: false,
    testPlanId: String(testPlanId),
    repositoryPath: selected.path,
    codebaseVersion: candidate.codebaseVersion,
    storagePrefix: candidate.prefix || null,
    // The candidate's own manifest is the only honest scope for a validation
    // run: the platform resolves an execution without targets as "the whole
    // plan", which means only the cases already automated — none of them, for
    // a plan being automated for the first time.
    targets: normalizeTargets(candidate.targets) || []
  }
}

// SHADOW + codebaseVersion is the platform contract for a run that validates
// a candidate without entering LIVE governance or monitoring. The remote MCP
// create tool does not expose these fields, so the bridge posts to the REST
// endpoint directly with the Service Account credentials it already holds.
export async function createValidationExecution({
  applicationId,
  testPlanId,
  environment,
  codebaseVersion,
  targets,
  restClient = new VoidrRestClient()
}) {
  if (!/^[a-f0-9]{24}$/i.test(String(applicationId || ''))) {
    throw new Error('A valid application ID is required.')
  }
  if (!/^[a-f0-9]{24}$/i.test(String(testPlanId || ''))) {
    throw new Error('A valid Test Plan ID is required.')
  }
  if (!/^[a-f0-9]{64}$/.test(String(codebaseVersion || ''))) {
    throw new Error(
      'A validation execution requires the codebaseVersion returned by the validation deploy.'
    )
  }
  if (!String(environment || '').trim()) {
    throw new Error('An environment slug is required.')
  }
  const selectedTargets = normalizeTargets(targets)
  if (!selectedTargets) {
    throw new Error(
      'A validation execution needs the targets of the deployed candidate. ' +
        'Pass the targets returned by voidr_release_deploy_validation: without ' +
        'them the platform runs "the whole plan", which covers only cases ' +
        'already automated and fails with "No test cases found for execution".'
    )
  }

  const idempotencyKey = createHash('sha256')
    .update(
      JSON.stringify({
        codebaseVersion,
        environment,
        targets: selectedTargets,
        testPlanId
      })
    )
    .digest('hex')
    .slice(0, 32)

  const execution = await restClient.post('/executions', {
    applicationId: String(applicationId),
    planId: String(testPlanId),
    environment: String(environment),
    provider: 'PLAYWRIGHT',
    source: 'STORAGE',
    run_type: 'SHADOW',
    codebaseVersion: String(codebaseVersion),
    // `test-generation` is not a label: it is the tag the platform requires to
    // execute targets that are not automated yet (canRunNonAutomatedTargets,
    // together with SHADOW + STORAGE + codebaseVersion). Without it a plan
    // being automated for the first time can never be validated — every target
    // is rejected with "Only automated test cases can be executed".
    tags: ['test-generation', 'validation-run'],
    ...(selectedTargets ? { targets: selectedTargets } : {}),
    idempotencyKey: `validation-${idempotencyKey}`
  })

  const created = execution?.data ?? execution
  return {
    completed: true,
    validationExecution: true,
    runType: 'SHADOW',
    codebaseVersion: String(codebaseVersion),
    execution: created
  }
}

function normalizeTargets(targets) {
  if (!Array.isArray(targets) || targets.length === 0) return null
  return targets.map(target => {
    const testCaseSlug = String(target?.testCaseSlug || '').trim()
    const suiteSlug = String(target?.suiteSlug || '').trim()
    const moduleSlug = String(target?.moduleSlug || '').trim()
    if (!testCaseSlug || !suiteSlug || !moduleSlug) {
      throw new Error(
        'Every execution target needs testCaseSlug, suiteSlug, and moduleSlug.'
      )
    }
    return { testCaseSlug, suiteSlug, moduleSlug }
  })
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
