import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { synchronizePublishedRepository } from '../scripts/lib/repository-sync-release.mjs'

const testPlanId = '0123456789abcdef01234567'
const codebaseVersion = 'b'.repeat(64)
const baseCommitSha = 'a'.repeat(40)

test('submits the validation-time patch for the exact LIVE candidate', async () => {
  const checkout = makeCheckout({
    needed: true,
    baseCommitSha,
    patch: 'diff --git a/tests/case.spec.js b/tests/case.spec.js\n'
  })
  let submitted = null

  const result = await synchronizePublishedRepository({
    ...checkout,
    testPlanId,
    codebaseVersion,
    syncRepository: async input => {
      submitted = input
      return { status: 'QUEUED', liveValid: true, operationId: 'sync-1' }
    }
  })

  assert.deepEqual(submitted, {
    testPlanId,
    codebaseVersion,
    baseCommitSha,
    patch: 'diff --git a/tests/case.spec.js b/tests/case.spec.js\n'
  })
  assert.equal(result.status, 'QUEUED')
  assert.equal(result.liveValid, true)
})

test('reports a synchronization failure without invalidating LIVE', async () => {
  const checkout = makeCheckout({
    needed: true,
    baseCommitSha,
    patch: 'diff --git a/tests/case.spec.js b/tests/case.spec.js\n'
  })

  const result = await synchronizePublishedRepository({
    ...checkout,
    testPlanId,
    codebaseVersion,
    syncRepository: async () => {
      throw new Error('GitHub permission denied')
    }
  })

  assert.equal(result.status, 'FAILED')
  assert.equal(result.liveValid, true)
  assert.match(result.detail, /permission denied/i)
})

test('does not submit evidence from a different candidate', async () => {
  const checkout = makeCheckout(
    {
      needed: true,
      baseCommitSha,
      patch: 'diff --git a/tests/case.spec.js b/tests/case.spec.js\n'
    },
    'c'.repeat(64)
  )

  await assert.rejects(
    synchronizePublishedRepository({
      ...checkout,
      testPlanId,
      codebaseVersion,
      syncRepository: async () => {
        throw new Error('must not submit')
      }
    }),
    /local build does not match the published LIVE source/i
  )
})

test('returns synchronized when the remote source already matches', async () => {
  const checkout = makeCheckout({ needed: false })

  const result = await synchronizePublishedRepository({
    ...checkout,
    testPlanId,
    codebaseVersion,
    syncRepository: async () => {
      throw new Error('must not submit')
    }
  })

  assert.equal(result.status, 'SYNCED')
  assert.equal(result.liveValid, true)
})

function makeCheckout(snapshot, manifestVersion = codebaseVersion) {
  const repositoryPath = mkdtempSync(join(tmpdir(), 'voidr-sync-release-'))
  const outputPath = join(repositoryPath, '.voidr', '.output')
  mkdirSync(outputPath, { recursive: true })
  writeFileSync(join(repositoryPath, 'package.json'), '{}')
  writeFileSync(
    join(repositoryPath, 'project.json'),
    JSON.stringify({ testPlanId })
  )
  writeFileSync(
    join(outputPath, 'manifest.json'),
    JSON.stringify({ testPlanId, codebaseVersion: manifestVersion })
  )
  writeFileSync(
    join(outputPath, 'repository-sync.json'),
    JSON.stringify({ codebaseVersion, ...snapshot })
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
