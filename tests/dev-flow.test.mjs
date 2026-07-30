import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  isDevTestFlowPrompt,
  isDevTestsApproval
} from '../scripts/lib/session-state.mjs'
import { routeVoidrPrompt } from '../scripts/lib/prompt-router.mjs'

const root = resolve(import.meta.dirname, '..')
const guard = join(root, 'scripts/guard-hive-tools.mjs')
const promptHook = join(root, 'scripts/route-voidr-prompt.mjs')

function runHook(payload, dataRoot) {
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

test('recognizes developer test-my-feature intent without Voidr vocabulary', () => {
  for (const prompt of [
    'cria os testes da minha feature de login',
    'gerar testes para a funcionalidade que acabei',
    'quero testar minha feature nova',
    'escreve os testes dessa feature de checkout',
    '/voidr-test'
  ]) {
    assert.equal(isDevTestFlowPrompt(prompt), true, prompt)
  }
  for (const prompt of [
    'quero desenvolver testes na Voidr',
    'Criar testes',
    'roda o lint do projeto',
    '/voidr-test-plan'
  ]) {
    assert.equal(isDevTestFlowPrompt(prompt), false, prompt)
  }
})

test('the single dev approval must be the whole message', () => {
  assert.equal(isDevTestsApproval('Criar testes'), true)
  assert.equal(isDevTestsApproval('criar os testes!'), true)
  assert.equal(isDevTestsApproval('vou criar testes amanhã'), false)
  assert.equal(isDevTestsApproval('Criar testes para o login'), false)
  assert.equal(isDevTestsApproval('sim'), false)
})

test('routes developer intent to /voidr-test and keeps the classic route', () => {
  const dev = routeVoidrPrompt({
    prompt: 'cria os testes da minha feature de login'
  })
  assert.match(dev.modifiedTransformedPrompt, /\/voidr-test skill/)
  assert.match(dev.modifiedTransformedPrompt, /Criar testes/)

  const classic = routeVoidrPrompt({
    prompt: 'quero desenvolver testes na Voidr'
  })
  assert.match(classic.modifiedTransformedPrompt, /\/voidr-develop-tests/)

  assert.deepEqual(routeVoidrPrompt({ prompt: 'Criar testes' }), {})
})

test('auto mode skips the plan-mode question and allows plan listing', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'voidr-dev-flow-'))
  const sessionId = 'dev-flow-auto'
  submitPrompt(
    {
      sessionId,
      timestamp: Date.now(),
      prompt: 'cria os testes da minha feature de login',
      transformedPrompt: 'cria os testes da minha feature de login'
    },
    dataRoot
  )

  for (const request of [
    {
      toolName: 'voidr-applications_list_applications',
      toolArgs: {}
    },
    {
      toolName: 'voidr-test_plans_list_test_plans',
      toolArgs: { applicationId: 'app-1' }
    },
    {
      toolName: 'bash',
      toolArgs: { command: 'git diff main...HEAD --stat' }
    }
  ]) {
    assert.deepEqual(
      runHook({ sessionId, cwd: process.cwd(), ...request }, dataRoot),
      {},
      request.toolName
    )
  }
})

test('platform writes wait for the typed Criar testes approval in auto mode', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'voidr-dev-flow-'))
  const sessionId = 'dev-flow-approval'
  const now = Date.now()
  submitPrompt(
    {
      sessionId,
      timestamp: now,
      prompt: 'gerar testes para a feature de checkout',
      transformedPrompt: 'gerar testes para a feature de checkout'
    },
    dataRoot
  )

  const blocked = runHook(
    {
      sessionId,
      cwd: process.cwd(),
      toolName: 'voidr-test_plans_create_module',
      toolArgs: { planId: '0123456789abcdef01234567', name: 'Checkout' }
    },
    dataRoot
  )
  assert.equal(blocked.permissionDecision, 'deny')
  assert.match(blocked.permissionDecisionReason, /Criar testes/)

  submitPrompt(
    {
      sessionId,
      timestamp: now + 1,
      prompt: 'Criar testes',
      transformedPrompt: 'Criar testes'
    },
    dataRoot
  )

  assert.deepEqual(
    runHook(
      {
        sessionId,
        cwd: process.cwd(),
        toolName: 'voidr-test_plans_create_module',
        toolArgs: { planId: '0123456789abcdef01234567', name: 'Checkout' }
      },
      dataRoot
    ),
    {}
  )
})

test('the approved card also covers the displayed environment in auto mode', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'voidr-dev-flow-'))
  const sessionId = 'dev-flow-environment'
  const workspace = mkdtempSync(join(tmpdir(), 'voidr-dev-workspace-'))
  const repositoryPath = join(workspace, 'tests')
  mkdirSync(repositoryPath)
  const now = Date.now()

  submitPrompt(
    {
      sessionId,
      timestamp: now,
      prompt: 'cria os testes da minha feature de login',
      transformedPrompt: 'cria os testes da minha feature de login'
    },
    dataRoot
  )
  runHook(
    {
      sessionId,
      cwd: workspace,
      toolName: 'voidr-applications_list_environments',
      toolArgs: { applicationId: 'app-1' }
    },
    dataRoot
  )

  const prepareArgs = {
    toolName: 'voidr-voidr_workspace_prepare_test_repository',
    toolArgs: {
      repositoryPath,
      organizationId: 'org-1',
      applicationId: 'app-1',
      testPlanId: '0123456789abcdef01234567',
      environmentSlug: 'staging',
      cases: ['checkout-001']
    }
  }

  const blocked = runHook(
    { sessionId, cwd: workspace, ...prepareArgs },
    dataRoot
  )
  assert.equal(blocked.permissionDecision, 'deny')
  assert.match(blocked.permissionDecisionReason, /Criar testes/)

  submitPrompt(
    {
      sessionId,
      timestamp: now + 1,
      prompt: 'Criar testes',
      transformedPrompt: 'Criar testes'
    },
    dataRoot
  )
  assert.deepEqual(
    runHook({ sessionId, cwd: workspace, ...prepareArgs }, dataRoot),
    {}
  )
})
