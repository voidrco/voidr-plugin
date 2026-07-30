import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const guard = join(root, 'scripts/guard-hive-tools.mjs')
const promptHook = join(root, 'scripts/route-voidr-prompt.mjs')

function runHook(payload, dataRoot = mkdtempSync(join(tmpdir(), 'voidr-hook-'))) {
  const result = spawnSync(process.execPath, [guard], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, COPILOT_PLUGIN_DATA: dataRoot }
  })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout || '{}')
}

function submitPrompt(payload, dataRoot) {
  const result = spawnSync(process.execPath, [promptHook], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, COPILOT_PLUGIN_DATA: dataRoot }
  })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout || '{}')
}

function startWorkflow(sessionId, dataRoot, extraPrompts = []) {
  const now = Date.now()
  const prompts = ['Quero desenvolver testes na Voidr', ...extraPrompts]
  for (const [index, prompt] of prompts.entries()) {
    submitPrompt(
      {
        sessionId,
        timestamp: now + index,
        prompt,
        transformedPrompt: prompt
      },
      dataRoot
    )
  }
}

test('blocks shell commands that read or print .env contents (BUG-009)', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'voidr-hook-state-'))
  const sessionId = 'env-shell-read'
  startWorkflow(sessionId, dataRoot, ['Criar novo Test Plan'])

  for (const command of [
    'cat .env',
    'cat /tmp/tests/.env',
    'head -n 5 .env.staging',
    'grep PASSWORD .env',
    'source .env && npx playwright test',
    'sed -n 1,20p ./.env'
  ]) {
    const output = runHook(
      {
        sessionId,
        cwd: process.cwd(),
        toolName: 'bash',
        toolArgs: { command }
      },
      dataRoot
    )
    assert.equal(output.permissionDecision, 'deny', command)
    assert.match(
      output.permissionDecisionReason,
      /never read or print \.env contents/i,
      command
    )
  }

  const harmless = runHook(
    {
      sessionId,
      cwd: process.cwd(),
      toolName: 'bash',
      toolArgs: { command: 'ls -la .env && cp .env.example notes.txt' }
    },
    dataRoot
  )
  assert.deepEqual(harmless, {})
})

test('blocks dependency-strategy mutations while a workflow is active (BUG-007)', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'voidr-hook-state-'))
  const sessionId = 'dependency-strategy'
  startWorkflow(sessionId, dataRoot, ['Criar novo Test Plan'])

  for (const command of [
    'npm config set registry https://mirror.example.test',
    'npm cache clean --force',
    'npm install --legacy-peer-deps',
    'npm install --force',
    'rm package-lock.json && npm install',
    'npm install --registry https://mirror.example.test'
  ]) {
    const output = runHook(
      {
        sessionId,
        cwd: process.cwd(),
        toolName: 'bash',
        toolArgs: { command }
      },
      dataRoot
    )
    assert.equal(output.permissionDecision, 'deny', command)
    assert.match(
      output.permissionDecisionReason,
      /registry, cache, lockfiles, dependency flags/i,
      command
    )
  }

  const plainInstall = runHook(
    {
      sessionId,
      cwd: process.cwd(),
      toolName: 'bash',
      toolArgs: { command: 'npm install' }
    },
    dataRoot
  )
  assert.deepEqual(plainInstall, {})
})

test('never lists Test Plans while the user is creating a new one (BUG-003)', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'voidr-hook-state-'))
  const sessionId = 'new-plan-no-fallback'
  startWorkflow(sessionId, dataRoot, ['Criar novo Test Plan'])

  const output = runHook(
    {
      sessionId,
      cwd: process.cwd(),
      toolName: 'voidr-test_plans_list_test_plans',
      toolArgs: { applicationId: 'app-1' }
    },
    dataRoot
  )
  assert.equal(output.permissionDecision, 'deny')
  assert.match(output.permissionDecisionReason, /retry or cancel/i)
  assert.match(output.permissionDecisionReason, /Usar Test Plan existente/)

  const readsRemainAllowed = runHook(
    {
      sessionId,
      cwd: process.cwd(),
      toolName: 'voidr-applications_list_applications',
      toolArgs: {}
    },
    dataRoot
  )
  assert.deepEqual(readsRemainAllowed, {})
})

test('lists Test Plans normally in existing-plan mode', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'voidr-hook-state-'))
  const sessionId = 'existing-plan-listing'
  startWorkflow(sessionId, dataRoot, ['Usar Test Plan existente'])

  const output = runHook(
    {
      sessionId,
      cwd: process.cwd(),
      toolName: 'voidr-test_plans_list_test_plans',
      toolArgs: { applicationId: 'app-1' }
    },
    dataRoot
  )
  assert.deepEqual(output, {})
})

test('denies writes and repository selection inside the plugin installation (BUG-006)', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'voidr-hook-state-'))
  const workspace = mkdtempSync(join(tmpdir(), 'voidr-real-workspace-'))

  const write = runHook(
    {
      sessionId: 'plugin-boundary-write',
      cwd: workspace,
      toolName: 'create_file',
      toolArgs: { path: join(root, 'injected-note.md') }
    },
    dataRoot
  )
  assert.equal(write.permissionDecision, 'deny')
  assert.match(
    write.permissionDecisionReason,
    /plugin installation directory/i
  )

  const selection = runHook(
    {
      sessionId: 'plugin-boundary-selection',
      cwd: root,
      toolName: 'voidr-voidr_workspace_select_test_repository',
      toolArgs: { path: join(root, 'scripts') }
    },
    dataRoot
  )
  assert.equal(selection.permissionDecision, 'deny')
  assert.match(
    selection.permissionDecisionReason,
    /cannot live inside the plugin installation/i
  )
})
