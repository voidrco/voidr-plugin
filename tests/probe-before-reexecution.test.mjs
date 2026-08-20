import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const guard = join(root, 'scripts/guard-hive-tools.mjs')

function makeRunner() {
  const dataRoot = mkdtempSync(join(tmpdir(), 'voidr-probe-gate-'))
  // The plugin-boundary gate resolves every path argument against this cwd, so
  // the edited files have to live in a real workspace outside the plugin.
  const workspace = realpathSync(
    mkdtempSync(join(tmpdir(), 'voidr-probe-workspace-'))
  )
  mkdirSync(join(workspace, 'modules', 'a'), { recursive: true })
  mkdirSync(join(workspace, 'helpers'), { recursive: true })
  const call = (toolName, toolArgs = {}) => {
    const result = spawnSync(process.execPath, [guard], {
      input: JSON.stringify({
        sessionId: 'probe-gate',
        cwd: workspace,
        toolName,
        toolArgs
      }),
      encoding: 'utf8',
      env: { ...process.env, COPILOT_PLUGIN_DATA: dataRoot }
    })
    assert.equal(result.status, 0, result.stderr)
    return JSON.parse(result.stdout || '{}')
  }
  return { call, workspace }
}

// The cheap remediation loop, enforced: execution → edits → probe each spec
// with voidr_explore → only then another execution. The first execution of a
// session is always free.
test('a re-execution after spec edits requires an explore probe first', () => {
  const { call, workspace } = makeRunner()

  // First execution of the session: free.
  assert.deepEqual(call('voidr-voidr_create_validation_execution', {}), {})

  // Specs are edited after the run...
  assert.deepEqual(
    call('replace_string_in_file', {
      filePath: join(workspace, 'modules', 'a', 'confi-09.spec.js'),
      newString: 'await expect(x).toBeVisible()'
    }),
    {}
  )

  // ...so the next execution is blocked, teaching the probe-first loop.
  const blocked = call('voidr-voidr_create_validation_execution', {})
  assert.equal(blocked.permissionDecision, 'deny')
  assert.match(blocked.permissionDecisionReason, /voidr_explore/)
  assert.match(blocked.permissionDecisionReason, /block 1 of 3/)

  // Probing with voidr_explore satisfies the gate...
  assert.deepEqual(call('voidr-voidr_explore', {}), {})

  // ...and the execution is allowed again.
  assert.deepEqual(call('voidr-voidr_create_validation_execution', {}), {})
})

test('re-running without new edits never blocks', () => {
  const { call } = makeRunner()
  assert.deepEqual(call('voidr-voidr_create_validation_execution', {}), {})
  // No edits in between: an immediate re-run (e.g. flake retry) stays free.
  assert.deepEqual(call('voidr-voidr_create_validation_execution', {}), {})
})

test('edits to non-spec files do not arm the gate', () => {
  const { call, workspace } = makeRunner()
  assert.deepEqual(call('voidr-voidr_create_validation_execution', {}), {})
  assert.deepEqual(
    call('replace_string_in_file', {
      filePath: join(workspace, 'helpers', 'auth.js'),
      newString: 'force: true'
    }),
    {}
  )
  // auth.js is shared plumbing, not a spec — the probe requirement targets
  // spec-level churn, so this stays free.
  assert.deepEqual(call('voidr-voidr_create_validation_execution', {}), {})
})
