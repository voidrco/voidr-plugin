import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  assertCompletedImmutableDeployment,
  assertPromotableCandidate,
  latestCodebaseVersion
} from '../scripts/lib/release-contract.mjs'
import { deployRelease } from '../scripts/lib/release-deploy.mjs'

const codebaseVersion = 'b'.repeat(64)
const testPlanId = '0123456789abcdef01234567'

test('accepts the exact candidate exercised by a completed validation', () => {
  assert.deepEqual(
    assertPromotableCandidate({
      exercisedCodebaseVersion: codebaseVersion,
      manifestCodebaseVersion: codebaseVersion
    }),
    { codebaseVersion }
  )
  assert.throws(
    () =>
      assertPromotableCandidate({
        exercisedCodebaseVersion: 'not-a-version',
        manifestCodebaseVersion: 'not-a-version'
      }),
    /completed validation/
  )
  assert.throws(
    () =>
      assertPromotableCandidate({
        exercisedCodebaseVersion: codebaseVersion,
        manifestCodebaseVersion: 'c'.repeat(64)
      }),
    /not the version exercised/
  )
})

test('deployment completes only when latest equals the exercised candidate', () => {
  const base = completedEvidence()
  assert.equal(
    assertCompletedImmutableDeployment(base).latestCodebaseVersion,
    codebaseVersion
  )
  assert.throws(
    () =>
      assertCompletedImmutableDeployment({
        ...base,
        latestCodebaseVersion: 'c'.repeat(64)
      }),
    /Latest does not point/
  )
})

test('extracts latest codebaseVersion from platform deploy read-back', () => {
  assert.equal(
    latestCodebaseVersion({
      data: { manifestData: { codebaseVersion } }
    }),
    codebaseVersion
  )
  assert.equal(latestCodebaseVersion({ data: null }), null)
})

test('promotes the exercised build without rebuilding or checking remote Git state', async () => {
  const { repositoryPath, repositoryUrl } = makeCheckout('release')
  const calls = []
  const result = await deployRelease({
    repositoryPath: realpathSync(repositoryPath),
    repositoryUrl,
    testPlanId,
    codebaseVersion,
    cliEnvironment: {
      VOIDR_API_URL: 'https://preview.example.test/v1',
      VOIDR_CLIENT_ID: 'synthetic-client',
      VOIDR_CLIENT_SECRET: 'synthetic-secret'
    },
    run: async (file, args) => {
      calls.push([file, ...args])
      return { stdout: '', stderr: '', exitCode: 0 }
    },
    restClient: {
      get: async () => ({
        data: { manifestData: { codebaseVersion } }
      })
    }
  })

  assert.equal(result.completed, true)
  assert.deepEqual(result.source, {
    kind: 'validated-candidate',
    repositoryPath: realpathSync(repositoryPath),
    codebaseVersion
  })
  assert.equal(result.release.latestCodebaseVersion, codebaseVersion)
  assert.deepEqual(calls, [
    ['npx', '--no-install', 'voidr', 'deploy-latest']
  ])
})

test('refuses a local build that differs from the exercised candidate', async () => {
  const { repositoryPath, repositoryUrl } = makeCheckout('mismatch')

  await assert.rejects(
    deployRelease({
      repositoryPath,
      repositoryUrl,
      testPlanId,
      codebaseVersion: 'c'.repeat(64),
      run: async () => {
        throw new Error('deploy-latest must not run for an unvalidated build')
      },
      restClient: { get: async () => ({}) }
    }),
    /not the version exercised/
  )
})

test('reports what the CLI said when LIVE publication fails', async () => {
  const { repositoryPath, repositoryUrl } = makeCheckout('fail')

  await assert.rejects(
    deployRelease({
      repositoryPath,
      repositoryUrl,
      testPlanId,
      codebaseVersion,
      cliEnvironment: { VOIDR_API_URL: 'https://preview.example.test/v1' },
      run: async () => ({
        stdout: '',
        stderr: 'Upload failed: 403 Forbidden',
        exitCode: 1
      }),
      restClient: {
        get: async () => ({ data: { manifestData: { codebaseVersion } } })
      }
    }),
    error => {
      assert.match(error.message, /deploy-latest failed/)
      assert.match(error.message, /403 Forbidden/)
      return true
    }
  )
})

function makeCheckout(label) {
  const workspace = mkdtempSync(join(tmpdir(), `voidr-release-${label}-`))
  const repositoryPath = join(workspace, 'tests')
  mkdirSync(join(repositoryPath, '.voidr', '.output'), { recursive: true })
  writeFileSync(join(repositoryPath, 'package.json'), '{}')
  writeFileSync(
    join(repositoryPath, 'project.json'),
    JSON.stringify({ testPlanId })
  )
  writeFileSync(
    join(repositoryPath, '.voidr', '.output', 'manifest.json'),
    JSON.stringify({ testPlanId, codebaseVersion })
  )
  const repositoryUrl = 'https://github.com/acme/tests.git'
  execFileSync('git', ['init', repositoryPath], { stdio: 'ignore' })
  execFileSync(
    'git',
    ['-C', repositoryPath, 'remote', 'add', 'origin', repositoryUrl],
    { stdio: 'ignore' }
  )
  return { repositoryPath, repositoryUrl }
}

function completedEvidence() {
  return {
    immutableCandidateVerified: true,
    codebaseVersion,
    latestVerified: true,
    latestCodebaseVersion: codebaseVersion
  }
}
