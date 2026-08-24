import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createValidationExecution,
  deployValidationCandidate
} from '../scripts/lib/validation-run.mjs'

const testPlanId = 'abcdef0123456789abcdef01'
const repositoryUrl = 'https://github.com/acme/voidr-tests.git'

function provisionedRepository() {
  const path = mkdtempSync(join(tmpdir(), 'voidr-validation-'))
  writeFileSync(join(path, 'package.json'), '{}')
  writeFileSync(join(path, 'project.json'), JSON.stringify({ testPlanId }))
  execFileSync('git', ['init', '--quiet'], { cwd: path })
  execFileSync('git', ['remote', 'add', 'origin', repositoryUrl], { cwd: path })
  return path
}

test('an old CLI without deploy-candidate is explained, not dumped raw', async () => {
  const repositoryPath = provisionedRepository()

  await assert.rejects(
    deployValidationCandidate({
      repositoryPath,
      repositoryUrl,
      testPlanId,
      run: async (file, args) => {
        if (args.includes('deploy-candidate')) {
          // What commander actually produces, through runCommand's wrapper.
          throw new Error(
            'npx --no-install failed (exit 1): "code": "commander.unknownCommand", | "exitCode": 1 | }'
          )
        }
        return { stdout: '', stderr: '', exitCode: 0 }
      }
    }),
    error => {
      assert.match(error.message, /has no deploy-candidate\s+command/)
      // Telling the user to update would waste their time: the command is on
      // an unmerged framework branch, not in any published release.
      assert.match(error.message, /not in any published/)
      assert.doesNotMatch(error.message, /npm install @voidrco/)
      // The wrong fix has to be named, or the agent reaches for deploy-latest.
      assert.match(error.message, /Do not fall back to deploy-latest/)
      assert.doesNotMatch(error.message, /commander\.unknownCommand/)
      return true
    }
  )
})

test('captures the repository patch beside the exact validation candidate', async () => {
  const repositoryPath = provisionedRepository()
  const codebaseVersion = 'd'.repeat(64)
  mkdirSync(join(repositoryPath, '.voidr', '.output'), { recursive: true })
  writeFileSync(
    join(repositoryPath, '.voidr', '.output', 'manifest.json'),
    JSON.stringify({ testPlanId, codebaseVersion, tests: [] })
  )

  const result = await deployValidationCandidate({
    repositoryPath,
    repositoryUrl,
    testPlanId,
    run: async (_file, args) =>
      args.includes('deploy-candidate')
        ? {
            stdout: JSON.stringify({ codebaseVersion, prefix: 'candidate/path' }),
            stderr: '',
            exitCode: 0
          }
        : { stdout: '', stderr: '', exitCode: 0 },
    patchBuilder: async () => ({
      needed: true,
      defaultBranch: 'main',
      baseCommitSha: 'a'.repeat(40),
      changedFiles: ['modules/checkout/new.spec.js'],
      patch: 'diff --git a/modules/checkout/new.spec.js b/modules/checkout/new.spec.js\n'
    })
  })

  const snapshot = JSON.parse(
    readFileSync(
      join(repositoryPath, '.voidr', '.output', 'repository-sync.json'),
      'utf8'
    )
  )
  assert.equal(result.repositorySyncPrepared, true)
  assert.equal(snapshot.codebaseVersion, codebaseVersion)
  assert.equal(snapshot.baseCommitSha, 'a'.repeat(40))
})

test('a validation execution declares the preflight its candidate ships', async () => {
  // The Test Plan describes the promoted release; the manifest describes the
  // build actually being run. A candidate that introduces a preflight can only
  // be validated if the run is told about it.
  const repositoryPath = mkdtempSync(join(tmpdir(), 'voidr-candidate-'))
  mkdirSync(join(repositoryPath, '.voidr', '.output'), { recursive: true })
  writeFileSync(
    join(repositoryPath, '.voidr', '.output', 'manifest.json'),
    JSON.stringify({ preflight: { enabled: true } })
  )
  const posted = []

  await createValidationExecution({
    applicationId: '0123456789abcdef01234567',
    testPlanId,
    environment: 'principal',
    codebaseVersion: 'b'.repeat(64),
    targets: [
      { testCaseSlug: 'TROCA-02', suiteSlug: 'FLUXO', moduleSlug: 'troca' }
    ],
    repositoryPath,
    restClient: {
      post: async (path, body) => {
        posted.push({ path, body })
        return { data: { _id: 'exec-preflight' } }
      }
    }
  })

  assert.equal(posted[0].body.candidatePreflightEnabled, true)
})

test('a candidate without a readable manifest leaves the decision to the platform', async () => {
  const posted = []

  await createValidationExecution({
    applicationId: '0123456789abcdef01234567',
    testPlanId,
    environment: 'principal',
    codebaseVersion: 'c'.repeat(64),
    targets: [
      { testCaseSlug: 'TROCA-02', suiteSlug: 'FLUXO', moduleSlug: 'troca' }
    ],
    repositoryPath: join(tmpdir(), 'voidr-absent-candidate'),
    restClient: {
      post: async (path, body) => {
        posted.push({ path, body })
        return { data: { _id: 'exec-no-manifest' } }
      }
    }
  })

  // Absent rather than false: the platform keeps falling back to the plan,
  // which is the behaviour every existing caller relies on.
  assert.equal('candidatePreflightEnabled' in posted[0].body, false)
})

test('a validation execution is SHADOW and pinned to the candidate version', async () => {
  const codebaseVersion = 'a'.repeat(64)
  const posted = []
  const result = await createValidationExecution({
    applicationId: '0123456789abcdef01234567',
    testPlanId,
    environment: 'principal',
    codebaseVersion,
    targets: [
      { testCaseSlug: 'TROCA-01', suiteSlug: 'FLUXO', moduleSlug: 'troca' }
    ],
    restClient: {
      post: async (path, body) => {
        posted.push({ path, body })
        return { data: { _id: 'exec-1' } }
      }
    }
  })

  assert.equal(posted.length, 1)
  assert.equal(posted[0].path, '/executions')
  assert.equal(posted[0].body.run_type, 'SHADOW')
  assert.equal(posted[0].body.source, 'STORAGE')
  assert.equal(posted[0].body.codebaseVersion, codebaseVersion)
  // The platform only lets a not-yet-automated target run when the request
  // carries this tag together with SHADOW + STORAGE + codebaseVersion
  // (canRunNonAutomatedTargets). Dropping it makes a first automation
  // impossible to validate.
  assert.deepEqual(posted[0].body.tags, ['test-generation', 'validation-run'])
  assert.equal(posted[0].body.provider, 'PLAYWRIGHT')
  assert.match(posted[0].body.idempotencyKey, /^validation-[a-f0-9]{32}$/)
  assert.equal(result.runType, 'SHADOW')
  assert.equal(result.execution._id, 'exec-1')
})

test('a validation execution refuses a version it was not given', async () => {
  const restClient = {
    post: async () => {
      throw new Error('must not reach the platform')
    }
  }
  await assert.rejects(
    createValidationExecution({
      applicationId: '0123456789abcdef01234567',
      testPlanId,
      environment: 'principal',
      codebaseVersion: 'not-a-version',
      restClient
    }),
    /requires the codebaseVersion returned by the validation deploy/
  )
})

test('a validation execution without targets is refused before the platform', async () => {
  await assert.rejects(
    createValidationExecution({
      applicationId: '0123456789abcdef01234567',
      testPlanId,
      environment: 'principal',
      codebaseVersion: 'b'.repeat(64),
      restClient: {
        post: async () => {
          throw new Error('must not reach the platform')
        },
      },
    }),
    // Without targets the platform runs "the whole plan" — only the cases it
    // already lists as automated, which is none on a first automation.
    /needs the targets of the deployed candidate/,
  )
})
