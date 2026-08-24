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
  const patch = 'diff --git a/tests/case.spec.js b/tests/case.spec.js\n'
  const checkout = makeCheckout({
    needed: true,
    baseCommitSha,
    changedFiles: ['tests/case.spec.js'],
    patch
  })
  let submitted = null

  const result = await synchronizePublishedRepository({
    ...checkout,
    testPlanId,
    codebaseVersion,
    buildPatch: async () => ({
      needed: true,
      baseCommitSha,
      changedFiles: ['tests/case.spec.js'],
      patch
    }),
    publishLocal: async () => {
      throw new Error('local GitHub is unavailable')
    },
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
  assert.equal(result.delivery, 'VOIDR_BOT')
  assert.match(result.localDeliveryError, /unavailable/)
})

test('uses the user GitHub session before the Voidr Bot', async () => {
  const patch = 'diff --git a/tests/case.spec.js b/tests/case.spec.js\n'
  const checkout = makeCheckout({
    needed: true,
    baseCommitSha,
    changedFiles: ['tests/case.spec.js'],
    patch
  })

  const result = await synchronizePublishedRepository({
    ...checkout,
    testPlanId,
    codebaseVersion,
    buildPatch: async () => ({
      needed: true,
      baseCommitSha,
      changedFiles: ['tests/case.spec.js'],
      patch
    }),
    publishLocal: async () => ({
      branch: 'feat/case',
      commitSha: 'c'.repeat(40),
      pushed: true,
      merged: true,
      pullRequestUrl: 'https://github.com/acme/tests/pull/1'
    }),
    syncRepository: async () => {
      throw new Error('Voidr Bot must not run')
    }
  })

  assert.equal(result.status, 'SYNCED')
  assert.equal(result.delivery, 'LOCAL_GITHUB')
  assert.equal(result.pullRequestUrl, 'https://github.com/acme/tests/pull/1')
})

test('keeps an unmerged user pull request queued without invoking the bot', async () => {
  const patch = 'diff --git a/tests/case.spec.js b/tests/case.spec.js\n'
  const checkout = makeCheckout({
    needed: true,
    baseCommitSha,
    changedFiles: ['tests/case.spec.js'],
    patch
  })

  const result = await synchronizePublishedRepository({
    ...checkout,
    testPlanId,
    codebaseVersion,
    buildPatch: async () => ({
      needed: true,
      baseCommitSha,
      changedFiles: ['tests/case.spec.js'],
      patch
    }),
    publishLocal: async () => ({
      branch: 'feat/case',
      commitSha: 'c'.repeat(40),
      pushed: true,
      merged: false,
      pullRequestUrl: 'https://github.com/acme/tests/pull/1'
    }),
    syncRepository: async () => {
      throw new Error('Voidr Bot must not run')
    }
  })

  assert.equal(result.status, 'QUEUED')
  assert.equal(result.delivery, 'LOCAL_GITHUB')
})

test('reports a synchronization failure without invalidating LIVE', async () => {
  const patch = 'diff --git a/tests/case.spec.js b/tests/case.spec.js\n'
  const checkout = makeCheckout({
    needed: true,
    baseCommitSha,
    changedFiles: ['tests/case.spec.js'],
    patch
  })

  const result = await synchronizePublishedRepository({
    ...checkout,
    testPlanId,
    codebaseVersion,
    buildPatch: async () => ({
      needed: true,
      baseCommitSha,
      changedFiles: ['tests/case.spec.js'],
      patch
    }),
    publishLocal: async () => {
      throw new Error('local GitHub permission denied')
    },
    syncRepository: async () => {
      throw new Error('GitHub permission denied')
    }
  })

  assert.equal(result.status, 'FAILED')
  assert.equal(result.liveValid, true)
  assert.match(result.detail, /permission denied/i)
  assert.match(result.localDeliveryError, /permission denied/i)
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
