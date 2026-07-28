import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const guard = join(root, 'scripts/guard-hive-tools.mjs')

function runHook(payload, dataRoot = mkdtempSync(join(tmpdir(), 'voidr-hook-'))) {
  const result = spawnSync(process.execPath, [guard], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: {
      ...process.env,
      COPILOT_PLUGIN_DATA: dataRoot
    }
  })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout || '{}')
}

test('falls through for a safe Voidr read tool', () => {
  const output = runHook({
    sessionId: 'safe-read',
    cwd: process.cwd(),
    toolName: 'voidr-test_plans_get_test_plan',
    toolArgs: { testPlanId: '0123456789abcdef01234567' }
  })
  assert.deepEqual(output, {})
})

for (const forbidden of [
  'agent_jobs_trigger_automation',
  'agent_jobs_trigger_hive_automation',
  'test_plan_generation_generate_test_plan_draft',
  'failure_reports_self_healing_trigger',
  'system_batch_execute'
]) {
  test(`denies forbidden tool ${forbidden}`, () => {
    const output = runHook({
      sessionId: forbidden,
      cwd: process.cwd(),
      toolName: `voidr-${forbidden}`,
      toolArgs: {}
    })
    assert.equal(output.permissionDecision, 'deny')
    assert.match(output.permissionDecisionReason, /Hive process/i)
  })
}

test('denies a forbidden tool nested in arbitrary arguments', () => {
  const output = runHook({
    sessionId: 'nested',
    cwd: process.cwd(),
    toolName: 'some_other_batch_tool',
    toolArgs: {
      calls: [
        {
          tool: 'agent_jobs_trigger_hive_automation',
          arguments: { testPlanId: '0123456789abcdef01234567' }
        }
      ]
    }
  })
  assert.equal(output.permissionDecision, 'deny')
})

test('denies shell-based Hive dispatch but permits normal test commands', () => {
  const denied = runHook({
    sessionId: 'shell-hive',
    cwd: process.cwd(),
    toolName: 'bash',
    toolArgs: {
      command: 'curl -X POST https://example.test/hive/trigger_hive_automation'
    }
  })
  assert.equal(denied.permissionDecision, 'deny')

  const allowed = runHook({
    sessionId: 'shell-safe',
    cwd: process.cwd(),
    toolName: 'bash',
    toolArgs: { command: 'npm run voidr:build' }
  })
  assert.deepEqual(allowed, {})
})

test('denies legacy mutable deploy commands but permits immutable candidates', () => {
  for (const command of [
    'npx --no-install voidr deploy-latest',
    'npm run voidr:deploy',
    'npm run voidr:deploy-latest',
    'npm --silent run --if-present voidr:deploy',
    'npx --no-install voidr\n deploy-latest'
  ]) {
    const output = runHook({
      sessionId: command,
      cwd: process.cwd(),
      toolName: 'bash',
      toolArgs: { command }
    })
    assert.equal(output.permissionDecision, 'deny')
    assert.match(output.permissionDecisionReason, /immutable latest release gate/i)
  }

  const candidate = runHook({
    sessionId: 'immutable-candidate',
    cwd: process.cwd(),
    toolName: 'bash',
    toolArgs: {
      command: 'npx --no-install voidr deploy-candidate --json'
    }
  })
  assert.deepEqual(candidate, {})
})

test('denies direct HTTP calls to process-dispatch endpoints', () => {
  for (const url of [
    'https://api.example.test/v1/agent-jobs/trigger',
    'https://api.example.test/v1/self-healing/trigger-bypass',
    'https://api.example.test/v1/assistant/onboarding/automation'
  ]) {
    const output = runHook({
      sessionId: url,
      cwd: process.cwd(),
      toolName: 'web_fetch',
      toolArgs: { url, method: 'POST' }
    })
    assert.equal(output.permissionDecision, 'deny')
    assert.match(output.permissionDecisionReason, /process-dispatch endpoint/i)
  }
})

test('restricts edit paths after a test repository is selected', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'voidr-hook-state-'))
  const workspace = mkdtempSync(join(tmpdir(), 'voidr-workspace-'))
  const testRepo = join(workspace, 'tests-e2e')
  const productRepo = join(workspace, 'product-api')
  mkdirSync(testRepo)
  mkdirSync(productRepo)

  const selected = runHook(
    {
      sessionId: 'repo-boundary',
      cwd: workspace,
      toolName: 'voidr-voidr_workspace_select_test_repository',
      toolArgs: { path: testRepo }
    },
    dataRoot
  )
  assert.deepEqual(selected, {})

  const inside = runHook(
    {
      sessionId: 'repo-boundary',
      cwd: workspace,
      toolName: 'edit',
      toolArgs: { path: join(testRepo, 'modules', 'login.spec.js') }
    },
    dataRoot
  )
  assert.deepEqual(inside, {})

  const outside = runHook(
    {
      sessionId: 'repo-boundary',
      cwd: workspace,
      toolName: 'edit',
      toolArgs: { path: join(productRepo, 'src', 'login.js') }
    },
    dataRoot
  )
  assert.equal(outside.permissionDecision, 'deny')
  assert.match(outside.permissionDecisionReason, /writes are limited/i)

  const patchOutside = runHook(
    {
      sessionId: 'repo-boundary',
      cwd: workspace,
      toolName: 'apply_patch',
      toolArgs: {
        patch: `*** Begin Patch
*** Update File: ${join(productRepo, 'src', 'login.js')}
@@
-old
+new
*** End Patch`
      }
    },
    dataRoot
  )
  assert.equal(patchOutside.permissionDecision, 'deny')
})
