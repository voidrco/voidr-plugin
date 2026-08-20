import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const root = resolve(import.meta.dirname, '..')
const guard = join(root, 'scripts/guard-hive-tools.mjs')

function runHook(payload, dataRoot) {
  const result = spawnSync(process.execPath, [guard], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, COPILOT_PLUGIN_DATA: dataRoot }
  })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout || '{}')
}

function seedState(dataRoot, sessionId, state) {
  const dir = join(dataRoot, 'sessions')
  mkdirSync(dir, { recursive: true })
  const safeId = createHash('sha256').update(sessionId).digest('hex')
  writeFileSync(join(dir, `${safeId}.json`), JSON.stringify(state))
}

// The circuit-breaker ladder: a setup gate teaches on the first blocks,
// announces its own degradation loudly, and then stops blocking — because a
// gate that keeps firing despite carrying its own remedy is more likely
// broken (e.g. a machine-specific path bug) than right.
test('a setup gate teaches, degrades loudly, then stops blocking', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'voidr-gate-ladder-'))
  const sessionId = 'gate-ladder'
  const call = () =>
    runHook(
      {
        sessionId,
        cwd: root,
        toolName: 'voidr-voidr_workspace_inspect',
        toolArgs: {}
      },
      dataRoot
    )

  const first = call()
  assert.equal(first.permissionDecision, 'deny')
  assert.match(first.permissionDecisionReason, /workspaceRoot/)
  assert.match(first.permissionDecisionReason, /block 1 of 3/)

  const second = call()
  assert.match(second.permissionDecisionReason, /block 2 of 3/)

  const third = call()
  assert.match(third.permissionDecisionReason, /DEGRADED/)
  assert.match(third.permissionDecisionReason, /workspace-root/)
  assert.match(third.permissionDecisionReason, /Reporte ao time Voidr/)

  // Gate is now open for this session: the same call passes.
  assert.deepEqual(call(), {})
  assert.deepEqual(call(), {})
})

test('degradation is per gate and per session, not global', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'voidr-gate-scope-'))

  // Degrade workspace-root in session A...
  for (let i = 0; i < 3; i++) {
    runHook(
      {
        sessionId: 'session-a',
        cwd: root,
        toolName: 'voidr-voidr_workspace_inspect',
        toolArgs: {}
      },
      dataRoot
    )
  }
  assert.deepEqual(
    runHook(
      {
        sessionId: 'session-a',
        cwd: root,
        toolName: 'voidr-voidr_workspace_inspect',
        toolArgs: {}
      },
      dataRoot
    ),
    {}
  )

  // ...session B still starts with the gate armed.
  const fresh = runHook(
    {
      sessionId: 'session-b',
      cwd: root,
      toolName: 'voidr-voidr_workspace_inspect',
      toolArgs: {}
    },
    dataRoot
  )
  assert.equal(fresh.permissionDecision, 'deny')
  assert.match(fresh.permissionDecisionReason, /block 1 of 3/)
})

// Security and identity gates never route through the ladder: no amount of
// repetition opens them.
test('a hard gate never degrades', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'voidr-gate-hard-'))
  const sessionId = 'gate-hard'
  seedState(dataRoot, sessionId, { selectedTestPlanId: 'a'.repeat(24) })

  for (let i = 1; i <= 5; i++) {
    const out = runHook(
      {
        sessionId,
        cwd: root,
        toolName: 'voidr-test_plans_list_test_plans',
        toolArgs: {}
      },
      dataRoot
    )
    assert.equal(out.permissionDecision, 'deny', `attempt ${i} must stay blocked`)
    assert.doesNotMatch(out.permissionDecisionReason, /block \d of/)
  }
})
