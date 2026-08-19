import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { environmentDoctor } from '../scripts/lib/environment-doctor.mjs'

const pluginRoot = resolve(import.meta.dirname, '..')

// Every check resolves; only the inspected path is under test here.
async function stubRun(file, args) {
  if (args?.[0] === '--version') {
    return { stdout: 'v22.22.0\n', stderr: '', exitCode: 0 }
  }
  return { stdout: '', stderr: '', exitCode: 0 }
}

test('an unscoped call never claims a verdict about the plugin installation', async () => {
  // The bridge process starts inside the plugin installation, so this is what
  // /voidr-setup's first call actually looks like.
  const report = await environmentDoctor({ cwd: pluginRoot, run: stubRun })

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
