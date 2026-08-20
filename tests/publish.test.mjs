import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { publishTests } from '../scripts/lib/publish.mjs'

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

function fakePublishRun({ calls, prCreateError = null }) {
  return async (file, args, options) => {
    calls.push({ file, args, options })
    if (file === 'gh' && args[0] === 'repo') {
      return { stdout: JSON.stringify({ defaultBranchRef: { name: 'main' } }) }
    }
    if (file === 'git' && args[0] === 'status') {
      return { stdout: ' M modules/recarga/recarga-01.spec.js\n' }
    }
    if (file === 'git' && args[0] === 'rev-parse') {
      return { stdout: `${'a'.repeat(40)}\n` }
    }
    if (file === 'gh' && args[0] === 'pr' && args[1] === 'create') {
      if (prCreateError) throw new Error(prCreateError)
      return {
        stdout: 'https://github.com/voidrco/voidr-tp-publish/pull/7\n'
      }
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

test('publishes a feature branch with commit, explicit refspec push, and PR', async () => {
  const repositoryPath = createCheckout()
  const calls = []

  const result = await publishTests({
    repositoryPath,
    repositoryUrl,
    branch: 'feat/recarga-creditos-tests',
    commitMessage: 'test: cenários de recarga de créditos',
    createPullRequest: true,
    run: fakePublishRun({ calls })
  })

  assert.equal(result.completed, true)
  assert.equal(result.committed, true)
  assert.equal(result.branch, 'feat/recarga-creditos-tests')
  assert.equal(
    result.pullRequestUrl,
    'https://github.com/voidrco/voidr-tp-publish/pull/7'
  )

  const sequence = calls.map(call => `${call.file} ${call.args[0]}`)
  assert.deepEqual(sequence, [
    'gh repo',
    'git checkout',
    'git add',
    'git status',
    'git commit',
    'git rev-parse',
    'git push',
    'gh pr'
  ])
  const push = calls.find(call => call.args[0] === 'push')
  assert.deepEqual(push.args, [
    'push',
    '-u',
    'origin',
    'feat/recarga-creditos-tests:feat/recarga-creditos-tests'
  ])
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
    createPullRequest: true,
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

test('a finished publish never reads as a blocked one', async () => {
  const repositoryPath = createCheckout()

  const withPr = await publishTests({
    repositoryPath,
    repositoryUrl,
    branch: 'feat/recarga-creditos-tests',
    commitMessage: 'test: cenários de recarga de créditos',
    createPullRequest: true,
    run: fakePublishRun({ calls: [] })
  })
  const withoutPr = await publishTests({
    repositoryPath,
    repositoryUrl,
    branch: 'feat/recarga-creditos-tests',
    commitMessage: 'test: cenários de recarga de créditos',
    run: fakePublishRun({ calls: [] })
  })

  for (const result of [withPr, withoutPr]) {
    assert.equal(result.completed, true)
    assert.doesNotMatch(result.next, /requires|required|merge the pull request/i)
  }
  assert.match(withoutPr.next, /ready to deploy/i)
})
