import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inspectReleaseReadiness } from '../scripts/lib/release-inspect.mjs'

const repositoryUrl = 'https://github.com/voidrco/voidr-tp-inspect.git'
const headSha = 'a'.repeat(40)
const testPlanId = '6a5303e59a93b9f0daef3a53'

function createCheckout(workspace) {
  const repositoryPath = join(workspace, 'voidr-tests')
  spawnSync('git', ['init', repositoryPath], { stdio: 'ignore' })
  spawnSync(
    'git',
    ['-C', repositoryPath, 'remote', 'add', 'origin', repositoryUrl],
    { stdio: 'ignore' }
  )
  writeFileSync(join(repositoryPath, 'package.json'), '{}')
  writeFileSync(
    join(repositoryPath, 'project.json'),
    JSON.stringify({ orgId: 'org-1', appId: 'app-1', testPlanId })
  )
  return repositoryPath
}

function fakeInspectRun({ pushed = true, dirty = false } = {}) {
  return async (file, args) => {
    if (file === 'git' && args.includes('get-url')) {
      return { stdout: `${repositoryUrl}\n` }
    }
    if (file === 'gh' && args[0] === 'repo') {
      return {
        stdout: JSON.stringify({
          nameWithOwner: 'voidrco/voidr-tp-inspect',
          defaultBranchRef: { name: 'main' }
        })
      }
    }
    if (file === 'git' && args[0] === 'rev-parse') {
      return { stdout: `${headSha}\n` }
    }
    if (file === 'git' && args[0] === 'status') {
      return { stdout: dirty ? ' M modules/x.spec.js\n' : '' }
    }
    if (file === 'git' && args[0] === 'branch') {
      return { stdout: pushed ? '  origin/feat/new-tests\n' : '' }
    }
    return { stdout: '' }
  }
}

test('discovers plan, repository URL, and the commit to release without asking the user', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'voidr-inspect-'))
  const repositoryPath = createCheckout(workspace)

  const result = await inspectReleaseReadiness({
    repositoryPath,
    workspaceRoot: workspace,
    run: fakeInspectRun()
  })

  assert.equal(result.ready, true)
  assert.equal(result.project.testPlanId, testPlanId)
  assert.equal(
    result.repositoryUrl,
    'https://github.com/voidrco/voidr-tp-inspect'
  )
  assert.equal(result.headSha, headSha)
  assert.equal(result.commitOnRemote, true)
  assert.match(result.next, /voidr_release_deploy_live/)
  assert.match(result.next, /Do not ask the user/)
})

// A commit on any remote branch is releasable: readiness never looks for a
// pull request, merged or otherwise.
test('a commit on a feature branch is ready to release', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'voidr-inspect-branch-'))
  const repositoryPath = createCheckout(workspace)

  const result = await inspectReleaseReadiness({
    repositoryPath,
    workspaceRoot: workspace,
    run: fakeInspectRun({ pushed: true })
  })

  assert.equal(result.ready, true)
  assert.doesNotMatch(result.next, /pull request/i)
})

test('reports an unpushed commit with actionable guidance', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'voidr-inspect-local-'))
  const repositoryPath = createCheckout(workspace)

  const result = await inspectReleaseReadiness({
    repositoryPath,
    workspaceRoot: workspace,
    run: fakeInspectRun({ pushed: false })
  })

  assert.equal(result.ready, false)
  assert.equal(result.commitOnRemote, false)
  assert.match(result.next, /not on the remote/)
  assert.match(result.next, /voidr_workspace_publish_tests/)
})

test('reports a dirty worktree instead of proceeding', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'voidr-inspect-dirty-'))
  const repositoryPath = createCheckout(workspace)

  const result = await inspectReleaseReadiness({
    repositoryPath,
    workspaceRoot: workspace,
    run: fakeInspectRun({ dirty: true })
  })

  assert.equal(result.ready, false)
  assert.match(result.next, /uncommitted changes/)
})
