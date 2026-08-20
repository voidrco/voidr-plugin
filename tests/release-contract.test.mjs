import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  assertCompletedImmutableDeployment,
  assertDeployableSourceEvidence,
  latestCodebaseVersion
} from '../scripts/lib/release-contract.mjs'
import { deployRelease } from '../scripts/lib/release-deploy.mjs'

const commitSha = 'a'.repeat(40)
const codebaseVersion = 'b'.repeat(64)
const testPlanId = '0123456789abcdef01234567'

test('accepts a clean checkout at a commit that exists on the remote', () => {
  const evidence = deployableEvidence()
  assert.equal(assertDeployableSourceEvidence(evidence).commitSha, commitSha)
  assert.throws(
    () =>
      assertDeployableSourceEvidence({
        ...evidence,
        commitOnRemote: false
      }),
    /not on the remote/
  )
  assert.throws(
    () =>
      assertDeployableSourceEvidence({
        ...evidence,
        worktreeClean: false
      }),
    /uncommitted or untracked/
  )
  assert.throws(
    () =>
      assertDeployableSourceEvidence({
        ...evidence,
        localHeadSha: 'c'.repeat(40)
      }),
    /HEAD moved/
  )
})

// No pull request is consulted anywhere in the contract: a commit pushed on any
// branch is a releasable source.
test('a pull request is not part of the deploy contract', () => {
  const evidence = deployableEvidence()
  assert.equal(assertDeployableSourceEvidence(evidence).commitSha, commitSha)
  assert.equal(
    assertCompletedImmutableDeployment(completedEvidence()).commitSha,
    commitSha
  )
})

test('deployment completes only when latest equals the immutable candidate', () => {
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
  assert.throws(
    () => assertCompletedImmutableDeployment({ ...base, commitSha: 'nope' }),
    /no valid source commit SHA/
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

test('release tool binds build, immutable candidate, promotion, and latest to the commit', async () => {
  const { repositoryPath, repositoryUrl, workspace } = makeCheckout('release')

  const calls = []
  const posted = []
  const result = await deployRelease({
    repositoryPath,
    repositoryUrl,
    testPlanId,
    workspaceRoot: workspace,
    cliEnvironment: {
      VOIDR_API_URL: 'https://preview.example.test/v1',
      VOIDR_CLIENT_ID: 'synthetic-client',
      VOIDR_CLIENT_SECRET: 'synthetic-secret'
    },
    run: async (file, args) => {
      calls.push([file, ...args])
      return stubbedSource(file, args)
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
  assert.equal(result.source.commitSha, commitSha)
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
    'the release must be published with voidr deploy-latest'
  )
  assert.equal(
    calls.some(call => call[0] === 'gh' && call[1] === 'pr'),
    false,
    'no pull request is consulted'
  )
  assert.equal(
    posted.length,
    0,
    'promotion must not depend on a REST endpoint the platform does not expose'
  )
})

test('a commit that was never pushed is refused', async () => {
  const { repositoryPath, repositoryUrl, workspace } = makeCheckout('unpushed')

  await assert.rejects(
    deployRelease({
      repositoryPath,
      repositoryUrl,
      testPlanId,
      workspaceRoot: workspace,
      cliEnvironment: { VOIDR_API_URL: 'https://preview.example.test/v1' },
      run: async (file, args) => {
        if (file === 'git' && args[0] === 'branch') return { stdout: '' }
        return stubbedSource(file, args)
      },
      restClient: {
        post: async () => ({ data: { codebaseVersion } }),
        get: async () => ({ data: { manifestData: { codebaseVersion } } })
      }
    }),
    /not on the remote/
  )
})

test('reports what the CLI said when the release never left the machine', async () => {
  const { repositoryPath, repositoryUrl, workspace } = makeCheckout('fail')

  await assert.rejects(
    deployRelease({
      repositoryPath,
      repositoryUrl,
      testPlanId,
      workspaceRoot: workspace,
      cliEnvironment: { VOIDR_API_URL: 'https://preview.example.test/v1' },
      run: async (file, args) => {
        if (file === 'npx' && args.includes('deploy-latest')) {
          return {
            stdout: '',
            stderr: 'Upload failed: 403 Forbidden',
            exitCode: 1
          }
        }
        return stubbedSource(file, args)
      },
      restClient: {
        post: async () => ({ data: { codebaseVersion } }),
        get: async () => ({ data: { manifestData: { codebaseVersion } } })
      }
    }),
    error => {
      // The CLI's words, not "the pointer was not verified".
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
  return { repositoryPath, repositoryUrl, workspace }
}

function stubbedSource(file, args) {
  if (file === 'gh' && args[0] === 'repo') {
    return {
      stdout: JSON.stringify({
        nameWithOwner: 'acme/tests',
        defaultBranchRef: { name: 'main' }
      })
    }
  }
  if (file === 'git' && args[0] === 'rev-parse') {
    return { stdout: `${commitSha}\n` }
  }
  if (file === 'git' && args[0] === 'status') return { stdout: '' }
  if (file === 'git' && args[0] === 'branch') {
    return { stdout: '  origin/feat/new-tests\n' }
  }
  if (file === 'npx') {
    return {
      stdout: `${JSON.stringify({
        codebaseVersion,
        prefix: `versions/${codebaseVersion}`
      })}\n`
    }
  }
  return { stdout: '' }
}

function deployableEvidence() {
  return {
    repository: 'acme/tests',
    defaultBranch: 'main',
    commitSha,
    localHeadSha: commitSha,
    commitOnRemote: true,
    worktreeClean: true
  }
}

function completedEvidence() {
  return {
    commitSha,
    immutableCandidateVerified: true,
    codebaseVersion,
    latestVerified: true,
    latestCodebaseVersion: codebaseVersion
  }
}
