import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { publishCurrentCommit, publishTests } from '../scripts/lib/publish.mjs'

const repositoryUrl = 'https://github.com/voidrco/voidr-tp-publish.git'

function createCheckout() {
  const repositoryPath = mkdtempSync(join(tmpdir(), 'voidr-publish-'))
  spawnSync('git', ['init', repositoryPath], { stdio: 'ignore' })
  spawnSync(
    'git',
    ['-C', repositoryPath, 'remote', 'add', 'origin', repositoryUrl],
    { stdio: 'ignore' }
  )
  writeFileSync(join(repositoryPath, 'package.json'), '{}')
  return repositoryPath
}

function fakePublishRun({
  calls = [],
  prCreateError = null,
  prMergeError = null,
  ancestorOfDefault = true,
  statusOutput = ' M modules/recarga/recarga-01.spec.js\n',
  branchName = 'feat/recarga-creditos-tests'
}) {
  return async (file, args, options) => {
    calls.push({ file, args, options })
    if (file === 'gh' && args[0] === 'repo') {
      return { stdout: JSON.stringify({ defaultBranchRef: { name: 'main' } }) }
    }
    if (file === 'git' && args[0] === 'status') {
      return { stdout: statusOutput }
    }
    if (file === 'git' && args[0] === 'branch') {
      return { stdout: `${branchName}\n` }
    }
    if (file === 'git' && args[0] === 'rev-parse') {
      return { stdout: `${'a'.repeat(40)}\n` }
    }
    if (file === 'git' && args[0] === 'merge-base') {
      if (!ancestorOfDefault) throw new Error('not an ancestor')
      return { stdout: '' }
    }
    if (file === 'gh' && args[0] === 'pr' && args[1] === 'create') {
      if (prCreateError) throw new Error(prCreateError)
      return {
        stdout: 'https://github.com/voidrco/voidr-tp-publish/pull/7\n'
      }
    }
    if (file === 'gh' && args[0] === 'pr' && args[1] === 'merge') {
      if (prMergeError) throw new Error(prMergeError)
      return { stdout: '' }
    }
    if (file === 'gh' && args[0] === 'pr' && args[1] === 'view') {
      return {
        stdout: JSON.stringify({
          url: 'https://github.com/voidrco/voidr-tp-publish/pull/7'
        })
      }
    }
    return { stdout: '' }
  }
}

test('publishes the existing clean checkpoint without creating another commit', async () => {
  const repositoryPath = createCheckout()
  const calls = []

  const result = await publishCurrentCommit({
    repositoryPath,
    repositoryUrl,
    run: fakePublishRun({ calls, statusOutput: '' })
  })

  assert.equal(result.branch, 'feat/recarga-creditos-tests')
  assert.equal(result.pushed, true)
  assert.equal(result.merged, true)
  assert.equal(
    calls.some(call => call.args[0] === 'checkout' || call.args[0] === 'commit'),
    false
  )
})

test('publishes a feature branch and merges it into the default branch', async () => {
  const repositoryPath = createCheckout()
  const calls = []

  const result = await publishTests({
    repositoryPath,
    repositoryUrl,
    branch: 'feat/recarga-creditos-tests',
    commitMessage: 'test: cenários de recarga de créditos',
    run: fakePublishRun({ calls })
  })

  assert.equal(result.completed, true)
  assert.equal(result.committed, true)
  assert.equal(result.branch, 'feat/recarga-creditos-tests')
  assert.equal(
    result.pullRequestUrl,
    'https://github.com/voidrco/voidr-tp-publish/pull/7'
  )
  assert.equal(result.merged, true)

  const sequence = calls.map(call =>
    call.file === 'gh'
      ? `gh ${call.args[0]} ${call.args[1]}`
      : `git ${call.args[0]}`
  )
  assert.deepEqual(sequence, [
    'gh repo view',
    'git checkout',
    'git add',
    'git status',
    'git commit',
    'git rev-parse',
    'git push',
    'gh pr create',
    'gh pr merge',
    'git fetch',
    'git merge-base'
  ])
  const push = calls.find(call => call.args[0] === 'push')
  assert.deepEqual(push.args, [
    'push',
    '-u',
    'origin',
    'feat/recarga-creditos-tests:feat/recarga-creditos-tests'
  ])
})

test('creates a local commit without requiring GitHub or changing the remote', async () => {
  const repositoryPath = createCheckout()
  const calls = []

  const result = await publishTests({
    repositoryPath,
    repositoryUrl,
    branch: 'feat/local-checkpoint',
    commitMessage: 'test: checkpoint local',
    pushToRemote: false,
    run: fakePublishRun({ calls })
  })

  assert.equal(result.completed, true)
  assert.equal(result.committed, true)
  assert.equal(result.pushed, false)
  assert.equal(result.pullRequestUrl, null)
  assert.equal(result.merged, false)
  assert.match(result.next, /saved locally/i)
  assert.equal(calls.some(call => call.file === 'gh'), false)
  assert.equal(calls.some(call => call.args[0] === 'push'), false)
})

test('pushes a deployable feature branch without opening a pull request', async () => {
  const repositoryPath = createCheckout()
  const calls = []

  const result = await publishTests({
    repositoryPath,
    repositoryUrl,
    branch: 'feat/recarga-creditos-tests',
    commitMessage: 'test: cenários de recarga',
    mergeToDefaultBranch: false,
    run: fakePublishRun({ calls })
  })

  assert.equal(result.pullRequestUrl, null)
  assert.equal(result.merged, false)
  assert.equal(result.readyToDeploy, true)
  assert.match(result.next, /default branch \(main\) was not changed/i)
  assert.match(result.next, /completed validation PASSED or was diagnosed FAILED/i)
  assert.equal(
    calls.some(call => call.file === 'gh' && call.args[0] === 'pr'),
    false
  )
})

test('a refused merge is reported as unmerged, not as a failure', async () => {
  const repositoryPath = createCheckout()

  const result = await publishTests({
    repositoryPath,
    repositoryUrl,
    branch: 'feat/recarga-creditos-tests',
    commitMessage: 'test: cenários de recarga',
    run: fakePublishRun({
      prMergeError: 'Pull request is not mergeable: 1 approving review required'
    })
  })

  assert.equal(result.completed, true)
  assert.equal(result.pushed, true)
  assert.equal(result.merged, false)
  assert.equal(result.readyToDeploy, true)
})

test('gh reporting a merge that the ref does not have is not merged', async () => {
  const repositoryPath = createCheckout()

  const result = await publishTests({
    repositoryPath,
    repositoryUrl,
    branch: 'feat/recarga-creditos-tests',
    commitMessage: 'test: cenários de recarga',
    run: fakePublishRun({ ancestorOfDefault: false })
  })

  assert.equal(result.merged, false)
})

test('refuses to publish directly to the default branch', async () => {
  const repositoryPath = createCheckout()
  const calls = []

  await assert.rejects(
    publishTests({
      repositoryPath,
      repositoryUrl,
      branch: 'main',
      commitMessage: 'test: qualquer',
      run: fakePublishRun({ calls })
    }),
    /Never push directly to the default branch/
  )
  assert.equal(
    calls.some(call => call.args[0] === 'push'),
    false
  )
})

test('reuses the existing pull request when creation reports a duplicate', async () => {
  const repositoryPath = createCheckout()
  const calls = []

  const result = await publishTests({
    repositoryPath,
    repositoryUrl,
    branch: 'feat/recarga-creditos-tests',
    commitMessage: 'test: cenários de recarga',
    run: fakePublishRun({
      calls,
      prCreateError:
        'a pull request for branch "feat/recarga-creditos-tests" already exists'
    })
  })

  assert.equal(
    result.pullRequestUrl,
    'https://github.com/voidrco/voidr-tp-publish/pull/7'
  )
})

test('rejects a checkout whose origin does not match the linked repository', async () => {
  const repositoryPath = mkdtempSync(join(tmpdir(), 'voidr-publish-wrong-'))
  spawnSync('git', ['init', repositoryPath], { stdio: 'ignore' })
  spawnSync(
    'git',
    [
      '-C',
      repositoryPath,
      'remote',
      'add',
      'origin',
      'https://github.com/acme/other.git'
    ],
    { stdio: 'ignore' }
  )
  writeFileSync(join(repositoryPath, 'package.json'), '{}')

  await assert.rejects(
    publishTests({
      repositoryPath,
      repositoryUrl,
      branch: 'feat/x',
      commitMessage: 'test: x',
      run: async () => {
        throw new Error('must not run for a mismatched origin')
      }
    }),
    /origin does not match/
  )
})

test('an unmerged publish never reads as a delivered one', async () => {
  const repositoryPath = createCheckout()

  const merged = await publishTests({
    repositoryPath,
    repositoryUrl,
    branch: 'feat/recarga-creditos-tests',
    commitMessage: 'test: cenários de recarga de créditos',
    run: fakePublishRun({})
  })
  const unmerged = await publishTests({
    repositoryPath,
    repositoryUrl,
    branch: 'feat/recarga-creditos-tests',
    commitMessage: 'test: cenários de recarga de créditos',
    run: fakePublishRun({ prMergeError: '1 approving review required' })
  })

  assert.equal(merged.completed, true)
  assert.match(merged.next, /Merged into main/i)

  assert.match(unmerged.next, /does NOT have the tests/i)
  assert.match(unmerged.next, /pull\/7/)
  assert.match(unmerged.next, /Do not block a separately approved LIVE deploy/i)
  assert.equal(unmerged.readyToDeploy, true)
})
