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
    '/voidr-test',
    'Create tests for my feature',
    'write tests for the feature I just implemented',
    'generate tests for this branch'
  ]) {
    assert.equal(isDevTestFlowPrompt(prompt), true, prompt)
  }
  for (const prompt of [
    'quero desenvolver testes na Voidr',
    'Criar testes',
    'roda o lint do projeto',
    '/voidr-test-plan',
    'Create a new module, suite, and test case in the Voidr Test Plan "smoke-teste"',
    'List all Test Plans for the application "Itaú"'
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

  const deploy = routeVoidrPrompt({
    prompt: 'faca o deploy dos testes que desenvolvemos'
  })
  assert.match(deploy.modifiedTransformedPrompt, /\/voidr-deploy-run/)
  assert.match(
    deploy.modifiedTransformedPrompt,
    /Never call\s+executions_create_execution before the deploy/
  )
  assert.match(deploy.modifiedTransformedPrompt, /voidr_release_inspect/)

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
      cases: ['checkout-001'],
      workspaceRoot: workspace
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

test('ask_user selections arm the workflow and unlock approved plan writes', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'voidr-dev-flow-'))
  const sessionId = 'dev-flow-ask-user'
  const postHook = join(root, 'scripts/post-tool-execution-links.mjs')
  const now = Date.now()

  submitPrompt(
    {
      sessionId,
      timestamp: now,
      prompt: 'Quero criar um teste',
      transformedPrompt: 'Quero criar um teste'
    },
    dataRoot
  )

  const askResult = spawnSync(process.execPath, [postHook], {
    input: JSON.stringify({
      sessionId,
      toolName: 'vscode_askQuestions',
      toolResult: [
        JSON.stringify({
          answers: {
            test_plan_type: {
              selected: ['Usar um Test Plan existente'],
              freeText: null,
              skipped: false
            }
          }
        })
      ]
    }),
    encoding: 'utf8',
    env: { ...process.env, COPILOT_PLUGIN_DATA: dataRoot }
  })
  assert.equal(askResult.status, 0, askResult.stderr)

  const missingApproval = runHook(
    {
      sessionId,
      cwd: process.cwd(),
      toolName: 'voidr-test_plans_create_module',
      toolArgs: { planId: '0123456789abcdef01234567', name: 'Novo módulo' }
    },
    dataRoot
  )
  assert.equal(missingApproval.permissionDecision, 'deny')
  assert.match(missingApproval.permissionDecisionReason, /missing:/)
  assert.match(
    missingApproval.permissionDecisionReason,
    /Aprovo este Test Plan/
  )
  assert.doesNotMatch(
    missingApproval.permissionDecisionReason,
    /plan mode was never recorded/
  )
  assert.doesNotMatch(
    missingApproval.permissionDecisionReason,
    /never armed/
  )

  submitPrompt(
    {
      sessionId,
      timestamp: now + 1000,
      prompt: 'Aprovo este Test Plan',
      transformedPrompt: 'Aprovo este Test Plan'
    },
    dataRoot
  )

  assert.deepEqual(
    runHook(
      {
        sessionId,
        cwd: process.cwd(),
        toolName: 'voidr-test_plans_create_module',
        toolArgs: { planId: '0123456789abcdef01234567', name: 'Novo módulo' }
      },
      dataRoot
    ),
    {}
  )
})

test('deny diagnostics explain the missing approval and the recovery', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'voidr-dev-flow-'))
  const sessionId = 'dev-flow-diagnostics'
  const denied = runHook(
    {
      sessionId,
      cwd: process.cwd(),
      toolName: 'voidr-test_plans_create_module',
      toolArgs: { planId: '0123456789abcdef01234567', name: 'X' }
    },
    dataRoot
  )
  assert.equal(denied.permissionDecision, 'deny')
  assert.match(
    denied.permissionDecisionReason,
    /never received a user chat message/
  )
  assert.match(denied.permissionDecisionReason, /Aprovo este Test Plan/)
  assert.match(denied.permissionDecisionReason, /retry this call once/)
  assert.match(
    denied.permissionDecisionReason,
    /Add cases to an existing plan/
  )
})

test('plan writes in a session without any user message name the subagent cause', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'voidr-dev-flow-'))
  const sessionId = 'dev-flow-subagent'
  const postHook = join(root, 'scripts/post-tool-execution-links.mjs')

  const askResult = spawnSync(process.execPath, [postHook], {
    input: JSON.stringify({
      sessionId,
      toolName: 'vscode_askQuestions',
      toolResult: [
        JSON.stringify({
          answers: {
            plan_mode: {
              selected: ['Usar Test Plan existente'],
              freeText: null,
              skipped: false
            }
          }
        })
      ]
    }),
    encoding: 'utf8',
    env: { ...process.env, COPILOT_PLUGIN_DATA: dataRoot }
  })
  assert.equal(askResult.status, 0, askResult.stderr)

  const denied = runHook(
    {
      sessionId,
      cwd: process.cwd(),
      toolName: 'voidr-test_plans_create_module',
      toolArgs: { planId: '0123456789abcdef01234567', name: 'X' }
    },
    dataRoot
  )
  assert.equal(denied.permissionDecision, 'deny')
  assert.match(
    denied.permissionDecisionReason,
    /never received a user chat message/
  )
  assert.match(denied.permissionDecisionReason, /subagent/)
  assert.match(denied.permissionDecisionReason, /prompt hook is not running/)
})

test('typed approvals recorded under a different hook session still unlock chat writes', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'voidr-dev-flow-'))
  const windowSession = 'window-hooks'
  const chatSession = 'chat-tools'
  const postHook = join(root, 'scripts/post-tool-execution-links.mjs')
  const now = Date.now()

  submitPrompt(
    {
      sessionId: windowSession,
      timestamp: now,
      prompt: 'Quero criar um teste',
      transformedPrompt: 'Quero criar um teste'
    },
    dataRoot
  )

  const askResult = spawnSync(process.execPath, [postHook], {
    input: JSON.stringify({
      sessionId: chatSession,
      toolName: 'vscode_askQuestions',
      toolResult: [
        JSON.stringify({
          answers: {
            plan_mode: {
              selected: ['Usar Test Plan existente'],
              freeText: null,
              skipped: false
            }
          }
        })
      ]
    }),
    encoding: 'utf8',
    env: { ...process.env, COPILOT_PLUGIN_DATA: dataRoot }
  })
  assert.equal(askResult.status, 0, askResult.stderr)

  const beforeApproval = runHook(
    {
      sessionId: chatSession,
      cwd: process.cwd(),
      toolName: 'voidr-test_plans_create_module',
      toolArgs: { planId: '0123456789abcdef01234567', name: 'Novo módulo' }
    },
    dataRoot
  )
  assert.equal(beforeApproval.permissionDecision, 'deny')

  submitPrompt(
    {
      sessionId: windowSession,
      timestamp: now + 1000,
      prompt: 'Aprovo este Test Plan',
      transformedPrompt: 'Aprovo este Test Plan'
    },
    dataRoot
  )

  assert.deepEqual(
    runHook(
      {
        sessionId: chatSession,
        cwd: process.cwd(),
        toolName: 'voidr-test_plans_create_module',
        toolArgs: { planId: '0123456789abcdef01234567', name: 'Novo módulo' }
      },
      dataRoot
    ),
    {}
  )
})

test('typed plan-mode answers under the window session unlock chat writes without ask_user', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'voidr-dev-flow-'))
  const windowSession = 'window-typed-mode'
  const chatSession = 'chat-typed-mode'
  const now = Date.now()

  submitPrompt(
    {
      sessionId: windowSession,
      timestamp: now,
      prompt: 'É um existente\nNão sei o nome da aplicação, mas é um teste web',
      transformedPrompt:
        'É um existente\nNão sei o nome da aplicação, mas é um teste web'
    },
    dataRoot
  )
  submitPrompt(
    {
      sessionId: windowSession,
      timestamp: now + 1000,
      prompt: 'Aprovo este Test Plan',
      transformedPrompt: 'Aprovo este Test Plan'
    },
    dataRoot
  )

  assert.deepEqual(
    runHook(
      {
        sessionId: chatSession,
        cwd: process.cwd(),
        toolName: 'voidr-test_plans_create_module',
        toolArgs: { planId: '0123456789abcdef01234567', name: 'Teste Plugin' }
      },
      dataRoot
    ),
    {}
  )
})

test('a typed free-text ask_user approval unlocks writes when the prompt hook is dead', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'voidr-dev-flow-'))
  const sessionId = 'chat-freetext-approval'
  const postHook = join(root, 'scripts/post-tool-execution-links.mjs')

  const askResult = spawnSync(process.execPath, [postHook], {
    input: JSON.stringify({
      sessionId,
      toolName: 'vscode_askQuestions',
      toolResult: [
        JSON.stringify({
          answers: {
            approval: {
              selected: [],
              freeText: 'Aprovo este Test Plan',
              skipped: false
            }
          }
        })
      ]
    }),
    encoding: 'utf8',
    env: { ...process.env, COPILOT_PLUGIN_DATA: dataRoot }
  })
  assert.equal(askResult.status, 0, askResult.stderr)

  assert.deepEqual(
    runHook(
      {
        sessionId,
        cwd: process.cwd(),
        toolName: 'voidr-test_plans_create_module',
        toolArgs: { planId: '0123456789abcdef01234567', name: 'Novo módulo' }
      },
      dataRoot
    ),
    {}
  )
})

test('a clicked ask_user option never counts as the typed approval', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'voidr-dev-flow-'))
  const sessionId = 'chat-clicked-approval'
  const postHook = join(root, 'scripts/post-tool-execution-links.mjs')

  const askResult = spawnSync(process.execPath, [postHook], {
    input: JSON.stringify({
      sessionId,
      toolName: 'vscode_askQuestions',
      toolResult: [
        JSON.stringify({
          answers: {
            approval: {
              selected: ['Aprovo este Test Plan'],
              freeText: null,
              skipped: false
            }
          }
        })
      ]
    }),
    encoding: 'utf8',
    env: { ...process.env, COPILOT_PLUGIN_DATA: dataRoot }
  })
  assert.equal(askResult.status, 0, askResult.stderr)

  const denied = runHook(
    {
      sessionId,
      cwd: process.cwd(),
      toolName: 'voidr-test_plans_create_module',
      toolArgs: { planId: '0123456789abcdef01234567', name: 'Novo módulo' }
    },
    dataRoot
  )
  assert.equal(denied.permissionDecision, 'deny')
  assert.match(denied.permissionDecisionReason, /free-text field/)
  assert.match(
    denied.permissionDecisionReason,
    /last user message seen by the prompt hook: never/
  )
})

test('a typed free-text Criar testes arms auto mode and unlocks writes in a cold session', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'voidr-dev-flow-'))
  const sessionId = 'chat-freetext-criar-testes'
  const postHook = join(root, 'scripts/post-tool-execution-links.mjs')

  const askResult = spawnSync(process.execPath, [postHook], {
    input: JSON.stringify({
      sessionId,
      toolName: 'vscode_askQuestions',
      toolResult: [
        JSON.stringify({
          answers: {
            approval: {
              selected: [],
              freeText: 'Criar testes',
              skipped: false
            }
          }
        })
      ]
    }),
    encoding: 'utf8',
    env: { ...process.env, COPILOT_PLUGIN_DATA: dataRoot }
  })
  assert.equal(askResult.status, 0, askResult.stderr)

  assert.deepEqual(
    runHook(
      {
        sessionId,
        cwd: process.cwd(),
        toolName: 'voidr-test_plans_create_module',
        toolArgs: { planId: '0123456789abcdef01234567', name: 'Feature X' }
      },
      dataRoot
    ),
    {}
  )
})

test('a clicked Criar testes option never counts and the auto deny teaches the fallback', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'voidr-dev-flow-'))
  const sessionId = 'chat-clicked-criar-testes'
  const postHook = join(root, 'scripts/post-tool-execution-links.mjs')
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

  const askResult = spawnSync(process.execPath, [postHook], {
    input: JSON.stringify({
      sessionId,
      toolName: 'vscode_askQuestions',
      toolResult: [
        JSON.stringify({
          answers: {
            approval: {
              selected: ['Criar testes'],
              freeText: null,
              skipped: false
            }
          }
        })
      ]
    }),
    encoding: 'utf8',
    env: { ...process.env, COPILOT_PLUGIN_DATA: dataRoot }
  })
  assert.equal(askResult.status, 0, askResult.stderr)

  const denied = runHook(
    {
      sessionId,
      cwd: process.cwd(),
      toolName: 'voidr-test_plans_create_module',
      toolArgs: { planId: '0123456789abcdef01234567', name: 'Login' }
    },
    dataRoot
  )
  assert.equal(denied.permissionDecision, 'deny')
  assert.match(denied.permissionDecisionReason, /Criar testes/)
  assert.match(denied.permissionDecisionReason, /free-text field/)
  assert.match(
    denied.permissionDecisionReason,
    /last user message seen by the prompt hook/i
  )
})

test('post-smoke remediation crosses hook session ids and ask_user answers', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'voidr-dev-flow-'))
  const windowSession = 'window-smoke'
  const chatSession = 'chat-smoke'
  const postHook = join(root, 'scripts/post-tool-execution-links.mjs')
  const now = Date.now()

  assert.deepEqual(
    runHook(
      {
        sessionId: chatSession,
        cwd: process.cwd(),
        toolName: 'voidr-voidr_smoke_build',
        toolArgs: {
          repositoryPath: '/tmp/tests',
          repositoryUrl: 'https://github.com/voidrco/tests',
          testPlanId: '0123456789abcdef01234567',
          specs: ['modules/a/a.spec.js'],
          baseUrl: 'https://app.test'
        }
      },
      dataRoot
    ),
    {}
  )

  const blocked = runHook(
    {
      sessionId: chatSession,
      cwd: process.cwd(),
      toolName: 'read_file',
      toolArgs: { filePath: '/tmp/tests/modules/a/a.spec.js' }
    },
    dataRoot
  )
  assert.equal(blocked.permissionDecision, 'deny')
  assert.match(blocked.permissionDecisionReason, /after voidr_smoke_build/)

  submitPrompt(
    {
      sessionId: windowSession,
      timestamp: now + 5000,
      prompt: 'corrige o teste e roda de novo',
      transformedPrompt: 'corrige o teste e roda de novo'
    },
    dataRoot
  )

  assert.deepEqual(
    runHook(
      {
        sessionId: chatSession,
        cwd: process.cwd(),
        toolName: 'read_file',
        toolArgs: { filePath: '/tmp/tests/modules/a/a.spec.js' }
      },
      dataRoot
    ),
    {}
  )
})

test('an ask_user answer authorizing the fix clears the post-smoke stop', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'voidr-dev-flow-'))
  const sessionId = 'chat-smoke-ask'
  const postHook = join(root, 'scripts/post-tool-execution-links.mjs')

  assert.deepEqual(
    runHook(
      {
        sessionId,
        cwd: process.cwd(),
        toolName: 'voidr-voidr_smoke_build',
        toolArgs: {
          repositoryPath: '/tmp/tests',
          repositoryUrl: 'https://github.com/voidrco/tests',
          testPlanId: '0123456789abcdef01234567',
          specs: ['modules/a/a.spec.js'],
          baseUrl: 'https://app.test'
        }
      },
      dataRoot
    ),
    {}
  )

  const askResult = spawnSync(process.execPath, [postHook], {
    input: JSON.stringify({
      sessionId,
      toolName: 'vscode_askQuestions',
      toolResult: [
        JSON.stringify({
          answers: {
            next_step: {
              selected: ['Corrigir o teste e rodar de novo'],
              freeText: null,
              skipped: false
            }
          }
        })
      ]
    }),
    encoding: 'utf8',
    env: { ...process.env, COPILOT_PLUGIN_DATA: dataRoot }
  })
  assert.equal(askResult.status, 0, askResult.stderr)

  assert.deepEqual(
    runHook(
      {
        sessionId,
        cwd: process.cwd(),
        toolName: 'read_file',
        toolArgs: { filePath: '/tmp/tests/modules/a/a.spec.js' }
      },
      dataRoot
    ),
    {}
  )
})
