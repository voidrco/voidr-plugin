import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  assertCompletedImmutableDeployment,
  assertMergedPullRequestEvidence,
  latestCodebaseVersion
} from '../scripts/lib/release-contract.mjs'
import { deployMergedPullRequest } from '../scripts/lib/release-deploy.mjs'

const mergeCommitSha = 'a'.repeat(40)
const codebaseVersion = 'b'.repeat(64)
const testPlanId = '0123456789abcdef01234567'

test('accepts only a clean checkout at a PR commit merged into default', () => {
  const evidence = mergedEvidence()
  assert.equal(
    assertMergedPullRequestEvidence(evidence).mergeCommitSha,
    mergeCommitSha
  )
  assert.throws(
    () =>
      assertMergedPullRequestEvidence({
        ...evidence,
        state: 'OPEN',
        mergedAt: null
      }),
    /not merged/
  )
  assert.throws(
    () =>
      assertMergedPullRequestEvidence({
        ...evidence,
        localHeadSha: 'c'.repeat(40)
      }),
    /HEAD is not the merged PR commit/
  )
})

test('deployment completes only when latest equals the immutable candidate', () => {
  const base = {
    prMerged: true,
    mergeCommitSha,
    immutableCandidateVerified: true,
    codebaseVersion,
    latestVerified: true,
    latestCodebaseVersion: codebaseVersion
  }
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

test('release tool binds build, immutable candidate, promotion, and latest to merged PR', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'voidr-release-'))
  const repositoryPath = join(workspace, 'tests')
  mkdirSync(join(repositoryPath, '.git'), { recursive: true })
  mkdirSync(join(repositoryPath, '.voidr', '.output'), { recursive: true })
  writeFileSync(
    join(repositoryPath, 'package.json'),
    JSON.stringify({ scripts: { 'voidr:build': 'voidr build' } })
  )
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

  const calls = []
  const posted = []
  const result = await deployMergedPullRequest({
    repositoryPath,
    repositoryUrl,
    pullRequestNumber: 42,
    testPlanId,
    workspaceRoot: workspace,
    cliEnvironment: {
      VOIDR_API_URL: 'https://preview.example.test/v1',
      VOIDR_CLIENT_ID: 'synthetic-client',
      VOIDR_CLIENT_SECRET: 'synthetic-secret'
    },
    run: async (file, args) => {
      calls.push([file, ...args])
      if (file === 'gh' && args[0] === 'repo') {
        return {
          stdout: JSON.stringify({
            nameWithOwner: 'acme/tests',
            defaultBranchRef: { name: 'main' }
          })
        }
      }
      if (file === 'gh' && args[0] === 'pr') {
        return {
          stdout: JSON.stringify({
            number: 42,
            url: 'https://github.com/acme/tests/pull/42',
            state: 'MERGED',
            mergedAt: '2026-07-28T12:00:00Z',
            mergeCommit: { oid: mergeCommitSha },
            baseRefName: 'main'
          })
        }
      }
      if (file === 'git' && args[0] === 'rev-parse') {
        return { stdout: `${mergeCommitSha}\n` }
      }
      if (file === 'git' && args[0] === 'status') return { stdout: '' }
      if (file === 'npx') {
        return {
          stdout: `${JSON.stringify({
            codebaseVersion,
            prefix: `versions/${codebaseVersion}`
          })}\n`
        }
      }
      return { stdout: '' }
    },
    restClient: {
      post: async (path, body) => {
        posted.push({ path, body })
        return { data: { codebaseVersion } }
      },
      get: async () => ({
        data: { manifestData: { codebaseVersion } }
      })
    }
  })

  assert.equal(result.completed, true)
  assert.equal(result.pullRequest.mergeCommitSha, mergeCommitSha)
  assert.equal(result.release.latestCodebaseVersion, codebaseVersion)
  assert.equal(
    calls.some(call => call.join(' ') === 'npx --no-install voidr build'),
    true
  )
  assert.equal(
    calls.some(call => call.join(' ').startsWith('npm run')),
    false,
    'release must not depend on repository voidr:* scripts'
  )
  assert.equal(
    calls.some(call =>
      call.join(' ').includes('voidr deploy-candidate --json')
    ),
    true
  )
  // The release is published by the CLI, from the same build the candidate was
  // cut from — and it is what syncs the automation manifest, so a plan whose
  // first preflight ships with this release learns about it here.
  assert.equal(
    calls.some(call => call.join(' ') === 'npx --no-install voidr deploy-latest'),
    true,
    'the merged release must be published with voidr deploy-latest'
  )
  assert.equal(
    posted.length,
    0,
    'promotion must not depend on a REST endpoint the platform does not expose'
  )
})

test('fast-forwards a clean checkout that is behind the merged PR commit', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'voidr-release-ff-'))
  const repositoryPath = join(workspace, 'tests')
  mkdirSync(join(repositoryPath, '.git'), { recursive: true })
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

  const staleSha = 'c'.repeat(40)
  let fastForwarded = false
  const calls = []
  const result = await deployMergedPullRequest({
    repositoryPath,
    repositoryUrl,
    pullRequestNumber: 42,
    testPlanId,
    workspaceRoot: workspace,
    cliEnvironment: {
      VOIDR_API_URL: 'https://preview.example.test/v1',
      VOIDR_CLIENT_ID: 'synthetic-client',
      VOIDR_CLIENT_SECRET: 'synthetic-secret'
    },
    run: async (file, args) => {
      calls.push([file, ...args])
      if (file === 'gh' && args[0] === 'repo') {
        return {
          stdout: JSON.stringify({
            nameWithOwner: 'acme/tests',
            defaultBranchRef: { name: 'main' }
          })
        }
      }
      if (file === 'gh' && args[0] === 'pr') {
        return {
          stdout: JSON.stringify({
            number: 42,
            url: 'https://github.com/acme/tests/pull/42',
            state: 'MERGED',
            mergedAt: '2026-07-30T12:00:00Z',
            mergeCommit: { oid: mergeCommitSha },
            baseRefName: 'main'
          })
        }
      }
      if (file === 'git' && args[0] === 'merge' && args[1] === '--ff-only') {
        fastForwarded = true
        return { stdout: '' }
      }
      if (file === 'git' && args[0] === 'rev-parse') {
        return { stdout: `${fastForwarded ? mergeCommitSha : staleSha}\n` }
      }
      if (file === 'git' && args[0] === 'status') return { stdout: '' }
      if (file === 'npx') {
        return {
          stdout: `${JSON.stringify({
            codebaseVersion,
            prefix: `versions/${codebaseVersion}`
          })}\n`
        }
      }
      return { stdout: '' }
    },
    restClient: {
      post: async () => ({ data: { codebaseVersion } }),
      get: async () => ({
        data: { manifestData: { codebaseVersion } }
      })
    }
  })

  assert.equal(result.completed, true)
  assert.equal(fastForwarded, true)
  assert.equal(
    calls.some(call => call.join(' ') === 'git checkout main'),
    true
  )
  assert.equal(
    calls.some(
      call => call.join(' ') === `git merge --ff-only ${mergeCommitSha}`
    ),
    true
  )
})

function mergedEvidence() {
  return {
    pullRequestNumber: 42,
    pullRequestUrl: 'https://github.com/acme/tests/pull/42',
    state: 'MERGED',
    mergedAt: '2026-07-28T12:00:00Z',
    defaultBranch: 'main',
    baseBranch: 'main',
    mergeCommitSha,
    localHeadSha: mergeCommitSha,
    mergeCommitOnRemoteDefault: true,
    worktreeClean: true
  }
}
