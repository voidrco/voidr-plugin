import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { environmentDoctor } from '../scripts/lib/environment-doctor.mjs'

const pluginRoot = resolve(import.meta.dirname, '..')

// Every check resolves; only the inspected path is under test here.
async function stubRun(file, args) {
  if (args?.[0] === '--version') {
    return { stdout: 'v22.22.0\n', stderr: '', exitCode: 0 }
  }
  return { stdout: '', stderr: '', exitCode: 0 }
}

// resolveWorkspaceRoot now also consults the shared prompt state, so tests
// about the no-state behavior must pin the state root at an isolated
// directory — otherwise real machine state leaks into the assertion.
async function withPromptState(state, run) {
  const previous = process.env.COPILOT_PLUGIN_DATA
  const dataRoot = mkdtempSync(join(tmpdir(), 'voidr-doctor-state-'))
  if (state) {
    mkdirSync(join(dataRoot, 'sessions'), { recursive: true })
    writeFileSync(
      join(dataRoot, 'sessions', 'latest-prompt-state.json'),
      JSON.stringify(state)
    )
  }
  process.env.COPILOT_PLUGIN_DATA = dataRoot
  try {
    return await run()
  } finally {
    if (previous === undefined) delete process.env.COPILOT_PLUGIN_DATA
    else process.env.COPILOT_PLUGIN_DATA = previous
  }
}

test('an unscoped call never claims a verdict about the plugin installation', async () => {
  // The bridge process starts inside the plugin installation, so this is what
  // /voidr-setup's first call actually looks like.
  const report = await withPromptState(null, () =>
    environmentDoctor({ cwd: pluginRoot, run: stubRun })
  )

  assert.equal(report.inspectionScope, 'unresolved')
  assert.equal(report.repositoryPath, null)
  assert.match(report.summary, /Machine checks only/i)
  assert.match(report.summary, /no test repository was inspected/i)
  const playwright = report.checks.find(
    check => check.name === 'playwright-launchable'
  )
  assert.equal(playwright.status, 'skip')
  assert.match(playwright.detail, /repositoryPath|workspaceRoot/)
  // The machine-level checks still hold wherever they ran.
  assert.equal(report.apt, true)
  assert.equal(
    report.checks.some(check => check.name === 'node-runtime'),
    true
  )
})

// The flip side of the hermetic test above: when the prompt hook recorded a
// workspace, an unscoped doctor call adopts it — the bridge adapting to the
// user's workspace instead of giving up.
test('an unscoped call adopts the workspace recorded by the prompt hook', async () => {
  const recorded = realpathSync(
    mkdtempSync(resolve(tmpdir(), 'voidr-doctor-recorded-'))
  )
  const report = await withPromptState(
    { lastWorkspaceRoot: recorded },
    () => environmentDoctor({ cwd: pluginRoot, run: stubRun })
  )
  assert.equal(report.inspectionScope, 'workspace')
  assert.equal(report.inspectedPath, recorded)
})

test('a named workspace or repository scopes the report to it', async () => {
  const workspace = realpathSync(
    mkdtempSync(resolve(tmpdir(), 'voidr-doctor-workspace-'))
  )

  const scoped = await environmentDoctor({
    workspaceRoot: workspace,
    cwd: pluginRoot,
    run: stubRun
  })
  assert.equal(scoped.inspectionScope, 'workspace')
  assert.equal(scoped.repositoryPath, null)
  assert.equal(scoped.inspectedPath, workspace)
  assert.match(scoped.summary, /no test repository was named/i)

  const repository = realpathSync(
    mkdtempSync(resolve(tmpdir(), 'voidr-doctor-repo-'))
  )
  const repositoryReport = await environmentDoctor({
    repositoryPath: repository,
    cwd: pluginRoot,
    run: stubRun
  })
  assert.equal(repositoryReport.inspectionScope, 'repository')
  assert.equal(repositoryReport.repositoryPath, repository)
  assert.doesNotMatch(repositoryReport.summary, /Machine checks only/i)
})

test('a repository inside the plugin installation is refused', async () => {
  await assert.rejects(
    environmentDoctor({ repositoryPath: pluginRoot, run: stubRun }),
    /plugin installation/i
  )
})
