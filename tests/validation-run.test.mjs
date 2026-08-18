import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
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
      assert.match(error.message, /has no\s+deploy-candidate command/)
      assert.match(error.message, /@voidrco\/playwright@latest/)
      // The wrong fix has to be named, or the agent reaches for deploy-latest.
      assert.match(error.message, /Do not fall back to deploy-latest/)
      assert.doesNotMatch(error.message, /commander\.unknownCommand/)
      return true
    }
  )
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
  assert.deepEqual(posted[0].body.tags, ['validation-run'])
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
