import test from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const guard = join(root, 'scripts/guard-hive-tools.mjs')
const promptHook = join(root, 'scripts/route-voidr-prompt.mjs')
const postToolHook = join(root, 'scripts/post-tool-execution-links.mjs')
const stopHook = join(root, 'scripts/require-execution-links.mjs')

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

function submitPrompt(payload, dataRoot, extraEnv = {}) {
  const result = spawnSync(process.execPath, [promptHook], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: {
      ...process.env,
      COPILOT_PLUGIN_DATA: dataRoot,
      ...extraEnv
    }
  })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout || '{}')
}

function runScript(script, payload, dataRoot) {
  const result = spawnSync(process.execPath, [script], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: {
      ...process.env,
      COPILOT_PLUGIN_DATA: dataRoot,
      VOIDR_PLATFORM_URL: 'https://platform.voidr.co'
    }
  })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout || '{}')
}

test('requires a checkout that exists, and says who clones it', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'voidr-clone-destination-'))
  const dataRoot = mkdtempSync(join(tmpdir(), 'voidr-hook-'))
  const missing = join(workspace, 'voidr-tp-desk-web')

  // No tool clones the linked repository: the user does, with their own
  // credentials, and that is what proves their access to it.
  const output = runHook(
    {
      sessionId: 'clone-destination',
      cwd: workspace,
      toolName: 'voidr-voidr_workspace_prepare_test_repository',
      toolArgs: {
        repositoryPath: missing,
        repositoryUrl: 'https://github.com/voidrco/voidr-tp-desk-web',
        workspaceRoot: workspace
      }
    },
    dataRoot
  )
  assert.equal(output.permissionDecision, 'deny')
  assert.match(output.permissionDecisionReason, /must be an existing directory/i)
  assert.match(output.permissionDecisionReason, /ask the user to clone it/i)
})

test('falls through for a safe Voidr read tool', () => {
  const output = runHook({
    sessionId: 'safe-read',
    cwd: process.cwd(),
    toolName: 'voidr-test_plans_get_test_plan',
    toolArgs: { testPlanId: '0123456789abcdef01234567' }
  })
  assert.deepEqual(output, {})
})

test('ignores skill context when recording user approval and environment choices', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'voidr-hook-state-'))
  const sessionId = 'ignore-skill-context'
  const now = Date.now()
  const skillContext = `<skill-context name="voidr-develop-tests">
The workflow example says “Aprovo este Test Plan”.
Example environment: produção — producao — https://prod.example.test
</skill-context>`

  submitPrompt(
    {
      sessionId,
      timestamp: now,
      prompt: `${skillContext}\nQuero desenvolver testes na Voidr`,
      transformedPrompt: `${skillContext}\nQuero desenvolver testes na Voidr`
    },
    dataRoot
  )
  submitPrompt(
    {
      sessionId,
      timestamp: now + 1,
      prompt: `${skillContext}\nUsar Test Plan existente`,
      transformedPrompt: `${skillContext}\nUsar Test Plan existente`
    },
    dataRoot
  )

  const output = runHook(
    {
      sessionId,
      cwd: process.cwd(),
      toolName: 'voidr-test_plans_update_case',
      toolArgs: { testPlanId: 'plan-1' }
    },
    dataRoot
  )
  assert.equal(output.permissionDecision, 'deny')
  assert.match(output.permissionDecisionReason, /visible draft/i)
})

test('pins an explicitly selected existing Test Plan and blocks silent substitution', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'voidr-hook-state-'))
  const sessionId = 'selected-test-plan-identity'
  const firstId = '111111111111111111111111'
  const secondId = '222222222222222222222222'
  const now = Date.now()

  submitPrompt(
    {
      sessionId,
      timestamp: now,
      prompt:
        `Quero desenvolver testes na Voidr. Usar Test Plan existente ${firstId}.`,
      transformedPrompt:
        `Quero desenvolver testes na Voidr. Usar Test Plan existente ${firstId}.`
    },
    dataRoot
  )

  assert.deepEqual(
    runHook(
      {
        sessionId,
        cwd: process.cwd(),
        toolName: 'voidr-test_plans_get_test_plan',
        toolArgs: { testPlanId: firstId }
      },
      dataRoot
    ),
    {}
  )

  for (const request of [
    {
      toolName: 'voidr-test_plans_list_test_plans',
      toolArgs: { applicationId: 'application-1' }
    },
    {
      toolName: 'voidr-test_plans_get_test_plan',
      toolArgs: { testPlanId: secondId }
    },
    {
      toolName: 'voidr-voidr_workspace_prepare_test_repository',
      toolArgs: {
        testPlanId: secondId,
        repositoryPath: '/tmp/test-repository'
      }
    }
  ]) {
    const output = runHook(
      {
        sessionId,
        cwd: process.cwd(),
        ...request
      },
      dataRoot
    )
    assert.equal(output.permissionDecision, 'deny')
    assert.match(output.permissionDecisionReason, /Never|Do not substitute/i)
  }

  submitPrompt(
    {
      sessionId,
      timestamp: now + 1,
      prompt: `Usar Test Plan existente ${secondId}`,
      transformedPrompt: `Usar Test Plan existente ${secondId}`
    },
    dataRoot
  )

  assert.deepEqual(
    runHook(
      {
        sessionId,
        cwd: process.cwd(),
        toolName: 'voidr-test_plans_get_test_plan',
        toolArgs: { testPlanId: secondId }
      },
      dataRoot
    ),
    {}
  )
})

test('pins the first Test Plan read when the UI omits the prompt-state hook', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'voidr-hook-state-'))
  const sessionId = 'selected-test-plan-without-prompt-hook'
  const firstId = 'aaaaaaaaaaaaaaaaaaaaaaaa'
  const secondId = 'bbbbbbbbbbbbbbbbbbbbbbbb'

  assert.deepEqual(
    runHook(
      {
        sessionId,
        cwd: process.cwd(),
        toolName: 'voidr-test_plans_get_test_plan',
        toolArgs: { testPlanId: firstId }
      },
      dataRoot
    ),
    {}
  )

  for (const request of [
    {
      toolName: 'voidr-test_plans_list_test_plans',
      toolArgs: { applicationId: 'application-1' }
    },
    {
      toolName: 'voidr-test_plans_get_test_plan',
      toolArgs: { testPlanId: secondId }
    }
  ]) {
    const output = runHook(
      {
        sessionId,
        cwd: process.cwd(),
        ...request
      },
      dataRoot
    )
    assert.equal(output.permissionDecision, 'deny')
    assert.match(output.permissionDecisionReason, /silently|substitute/i)
  }
})

test('blocks platform and codebase tools until plan mode is selected', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'voidr-hook-state-'))
  const now = Date.now()
  submitPrompt(
    {
      sessionId: 'plan-mode-gate',
      timestamp: now,
      prompt:
        'Quero desenvolver testes na Voidr usando o repositório do produto.',
      transformedPrompt:
        'Quero desenvolver testes na Voidr usando o repositório do produto.'
    },
    dataRoot
  )

  for (const toolName of ['voidr-voidr_auth_status', 'view']) {
    const output = runHook(
      {
        sessionId: 'plan-mode-gate',
        cwd: process.cwd(),
        toolName,
        toolArgs: {}
      },
      dataRoot
    )
    assert.equal(output.permissionDecision, 'deny')
    assert.match(output.permissionDecisionReason, /Criar novo Test Plan/i)
  }

  assert.deepEqual(
    runHook(
      {
        sessionId: 'plan-mode-gate',
        cwd: process.cwd(),
        toolName: 'ask_user',
        toolArgs: {}
      },
      dataRoot
    ),
    {}
  )

  submitPrompt(
    {
      sessionId: 'plan-mode-gate',
      timestamp: now + 1,
      prompt: 'Criar novo Test Plan',
      transformedPrompt: 'Criar novo Test Plan'
    },
    dataRoot
  )
  assert.deepEqual(
    runHook(
      {
        sessionId: 'plan-mode-gate',
        cwd: process.cwd(),
        toolName: 'voidr-voidr_auth_status',
        toolArgs: {}
      },
      dataRoot
    ),
    {}
  )
})

test('forces voidr_auth_status as the first operational connect action', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'voidr-hook-state-'))
  const sessionId = 'connect-first-tool'
  submitPrompt(
    {
      sessionId,
      timestamp: Date.now() - 1,
      prompt: '/copilot voidr-develop-tests',
      transformedPrompt: '/copilot voidr-develop-tests'
    },
    dataRoot
  )
  submitPrompt(
    {
      sessionId,
      timestamp: Date.now(),
      prompt: '/copilot voidr-connect',
      transformedPrompt: '/copilot voidr-connect'
    },
    dataRoot,
    // Empty credential store: the gate only arms when there is an account to
    // create, so otherwise this asserts the machine, not the hook.
    { VOIDR_SERVICE_ACCOUNTS_PATH: join(dataRoot, 'service-accounts.json') }
  )

  assert.deepEqual(
    runHook(
      {
        sessionId,
        cwd: process.cwd(),
        toolName: 'skill',
        toolArgs: { name: 'voidr-connect' }
      },
      dataRoot
    ),
    {}
  )

  for (const request of [
    {
      toolName: 'read_file',
      toolArgs: { path: 'skills/voidr-connect/SKILL.md' }
    },
    {
      toolName: 'bash',
      toolArgs: { command: 'find . -iname "*auth*"' }
    },
    {
      toolName: 'skill',
      toolArgs: { name: 'unrelated-skill' }
    }
  ]) {
    const output = runHook(
      {
        sessionId,
        cwd: process.cwd(),
        ...request
      },
      dataRoot
    )
    assert.equal(output.permissionDecision, 'deny')
    assert.match(output.permissionDecisionReason, /first operational action/i)
  }

  assert.deepEqual(
    runHook(
      {
        sessionId,
        cwd: process.cwd(),
        toolName: 'voidr-voidr_auth_status',
        toolArgs: {}
      },
      dataRoot
    ),
    {}
  )

  assert.deepEqual(
    runHook(
      {
        sessionId,
        cwd: process.cwd(),
        toolName: 'read_file',
        toolArgs: { path: 'README.md' }
      },
      dataRoot
    ),
    {}
  )
})

test('blocks Test Plan writes until inputs and draft are explicitly approved', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'voidr-hook-state-'))
  const sessionId = 'test-plan-approval-gate'
  const now = Date.now()
  submitPrompt(
    {
      sessionId,
      timestamp: now,
      prompt: '/copilot voidr-develop-tests',
      transformedPrompt: '/copilot voidr-develop-tests'
    },
    dataRoot
  )
  submitPrompt(
    {
      sessionId,
      timestamp: now + 1,
      prompt: 'Criar novo Test Plan',
      transformedPrompt: 'Criar novo Test Plan'
    },
    dataRoot
  )

  const mutation = {
    sessionId,
    cwd: process.cwd(),
    toolName: 'voidr-test_plans_update_case',
    toolArgs: JSON.stringify({ caseId: 'case-1', title: 'Login válido' })
  }
  let output = runHook(mutation, dataRoot)
  assert.equal(output.permissionDecision, 'deny')
  assert.match(output.permissionDecisionReason, /Confirmar insumos/i)

  assert.deepEqual(
    runHook(
      {
        sessionId,
        cwd: process.cwd(),
        toolName: 'ask_user',
        toolArgs: {
          selectedAnswer: 'Confirmar insumos do planejamento'
        }
      },
      dataRoot
    ),
    {}
  )
  output = runHook(mutation, dataRoot)
  assert.equal(output.permissionDecision, 'deny')
  assert.match(output.permissionDecisionReason, /Confirmar insumos/i)

  submitPrompt(
    {
      sessionId,
      timestamp: now + 2,
      prompt: 'Aprovo este Test Plan',
      transformedPrompt: 'Aprovo este Test Plan'
    },
    dataRoot
  )
  output = runHook(mutation, dataRoot)
  assert.equal(output.permissionDecision, 'deny')
  assert.match(output.permissionDecisionReason, /Confirmar insumos/i)

  submitPrompt(
    {
      sessionId,
      timestamp: now + 3,
      prompt: 'Confirmar insumos do planejamento',
      transformedPrompt: 'Confirmar insumos do planejamento'
    },
    dataRoot
  )
  output = runHook(mutation, dataRoot)
  assert.equal(output.permissionDecision, 'deny')
  assert.match(output.permissionDecisionReason, /Aprovo este Test Plan/i)

  assert.deepEqual(
    runHook(
      {
        sessionId,
        cwd: process.cwd(),
        toolName: 'ask_user',
        toolArgs: {
          selectedAnswer: 'Aprovo este Test Plan'
        }
      },
      dataRoot
    ),
    {}
  )
  output = runHook(mutation, dataRoot)
  assert.equal(output.permissionDecision, 'deny')
  assert.match(output.permissionDecisionReason, /Aprovo este Test Plan/i)

  submitPrompt(
    {
      sessionId,
      timestamp: now + 4,
      prompt: 'Sim',
      transformedPrompt: 'Sim'
    },
    dataRoot
  )
  output = runHook(mutation, dataRoot)
  assert.equal(output.permissionDecision, 'deny')
  assert.match(output.permissionDecisionReason, /Aprovo este Test Plan/i)

  submitPrompt(
    {
      sessionId,
      timestamp: now + 5,
      prompt: 'Aprovo este Test Plan',
      transformedPrompt: 'Aprovo este Test Plan'
    },
    dataRoot
  )
  assert.deepEqual(runHook(mutation, dataRoot), {})

  submitPrompt(
    {
      sessionId,
      timestamp: now + 6,
      prompt: 'Faça mais uma alteração',
      transformedPrompt: 'Faça mais uma alteração'
    },
    dataRoot
  )
  output = runHook(mutation, dataRoot)
  assert.equal(output.permissionDecision, 'deny')
})

test('plugin hook resolves its script when VS Code omits PLUGIN_ROOT', () => {
  const hooks = JSON.parse(readFileSync(join(root, 'hooks.json'), 'utf8'))
  const command = hooks.hooks.preToolUse[0].bash
  const result = spawnSync('/bin/bash', ['-lc', command], {
    input: JSON.stringify({
      hook_event_name: 'PreToolUse',
      session_id: 'vscode-hook',
      cwd: process.cwd(),
      tool_name: 'mcp_voidr-agent_jobs_trigger_hive_automation',
      tool_input: '{}'
    }),
    encoding: 'utf8',
    env: {
      HOME: process.env.HOME,
      PATH: process.env.PATH,
      VOIDR_PLUGIN_ROOT: root
    }
  })
  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout)
  assert.equal(output.permissionDecision, 'deny')
  assert.match(output.permissionDecisionReason, /Hive process/i)
})

test('execution evidence blocks a response without its link', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'voidr-hook-state-'))
  const transcriptPath = join(dataRoot, 'transcript.jsonl')
  const sessionId = 'execution-link-stop'
  const executionId = '6a6a839850a27b89d2d7df2b'

  const postOutput = runScript(
    postToolHook,
    {
      session_id: sessionId,
      tool_name:
        'mcp_voidr-safe-br_playwright_list_execution_failures',
      tool_input: { executionId },
      tool_response: { content: [] }
    },
    dataRoot
  )
  assert.match(
    postOutput.hookSpecificOutput.additionalContext,
    new RegExp(executionId)
  )

  writeFileSync(
    transcriptPath,
    [
      transcriptEntry('user.message', { content: 'Analise POLAR-182' }),
      transcriptEntry('tool.execution_start', {
        toolName:
          'mcp_voidr-safe-br_playwright_list_execution_failures',
        arguments: { executionId }
      }),
      transcriptEntry('assistant.message', {
        content: 'A falha é intermitente.'
      })
    ].join('\n')
  )

  const blocked = runScript(
    stopHook,
    {
      session_id: sessionId,
      transcript_path: transcriptPath
    },
    dataRoot
  )
  assert.equal(blocked.hookSpecificOutput.decision, 'block')
  assert.match(blocked.hookSpecificOutput.reason, new RegExp(executionId))

  writeFileSync(
    transcriptPath,
    `${readFileSync(transcriptPath, 'utf8')}\n${transcriptEntry(
      'assistant.message',
      {
        content:
          `Execution: [Open execution](https://platform.voidr.co/execution/${executionId})`
      }
    )}`
  )
  assert.deepEqual(
    runScript(
      stopHook,
      {
        session_id: sessionId,
        transcript_path: transcriptPath
      },
      dataRoot
    ),
    {}
  )
})

for (const defectTool of [
  'defects_create_defect',
  'defects_create_defect_with_issue'
]) {
  test(`${defectTool} receives execution relations from analyzed evidence`, () => {
    const dataRoot = mkdtempSync(join(tmpdir(), 'voidr-hook-state-'))
    const sessionId = `defect-execution-link-${defectTool}`
    const executionId = '6a6a814011024018378d4e19'

    runScript(
      postToolHook,
      {
        session_id: sessionId,
        tool_name: 'mcp_voidr-safe-br_playwright_get_test_timeline',
        tool_input: { executionId, testCaseSlug: 'SAUDE-02' },
        tool_response: { content: [] }
      },
      dataRoot
    )

    const output = runHook(
      {
        session_id: sessionId,
        cwd: process.cwd(),
        tool_name: `mcp_voidr-safe-br_${defectTool}`,
        tool_input: {
          title: 'SAUDE-02 timeout',
          applicationId: 'app-serasa',
          severity: 'high',
          priority: 'p2',
          sessions: [executionId]
        }
      },
      dataRoot
    )

    assert.equal(
      output.hookSpecificOutput.updatedInput.relations.executions[0],
      executionId
    )
    assert.deepEqual(
      output.hookSpecificOutput.updatedInput.relations.testCases,
      ['SAUDE-02']
    )
    assert.match(
      output.hookSpecificOutput.updatedInput.description,
      new RegExp(`https://platform\\.voidr\\.co/execution/${executionId}`)
    )
  })
}

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

test('denies manual terminal execution of the Voidr MCP bridge', () => {
  const output = runHook({
    sessionId: 'manual-mcp-bridge',
    cwd: process.cwd(),
    toolName: 'bash',
    toolArgs: {
      command:
        'printf "%s" \'{"jsonrpc":"2.0","method":"tools/list"}\' | node scripts/voidr-mcp-bridge.mjs'
    }
  })
  assert.equal(output.permissionDecision, 'deny')
  assert.match(output.permissionDecisionReason, /MCP bridge/i)
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

  // Since BUG-021 no Voidr CLI invocation leaves the agent shell at all —
  // deploy-candidate runs inside the bridge, which does not pass through
  // this hook.
  const candidate = runHook({
    sessionId: 'immutable-candidate',
    cwd: process.cwd(),
    toolName: 'bash',
    toolArgs: {
      command: 'npx --no-install voidr deploy-candidate --json'
    }
  })
  assert.equal(candidate.permissionDecision, 'deny')
  assert.match(
    candidate.permissionDecisionReason,
    /never run the Voidr CLI or Playwright from the terminal/i
  )
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

test('denies model-visible access to Voidr credential files', () => {
  for (const payload of [
    {
      toolName: 'read_file',
      toolArgs: {
        path: '/Users/test/.voidr/copilot-service-account.json'
      }
    },
    {
      toolName: 'bash',
      toolArgs: {
        command: 'cat ~/.voidr/service-accounts.json'
      }
    }
  ]) {
    const output = runHook({
      sessionId: 'protected-credentials',
      cwd: process.cwd(),
      ...payload
    })
    assert.equal(output.permissionDecision, 'deny')
    assert.match(output.permissionDecisionReason, /credential files/i)
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
      toolArgs: { path: testRepo, workspaceRoot: workspace }
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

test('blocks repository setup until environments are listed, then binds prepare to a typed selection', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'voidr-hook-state-'))
  const workspace = mkdtempSync(join(tmpdir(), 'voidr-workspace-'))
  const testRepo = join(workspace, 'tests-e2e')
  mkdirSync(testRepo)
  const sessionId = 'explicit-environment-gate'
  const now = Date.now()

  submitPrompt(
    {
      sessionId,
      timestamp: now,
      prompt: 'Quero implementar testes na Voidr',
      transformedPrompt: 'Quero implementar testes na Voidr'
    },
    dataRoot
  )
  submitPrompt(
    {
      sessionId,
      timestamp: now + 1,
      prompt: 'Usar Test Plan existente',
      transformedPrompt: 'Usar Test Plan existente'
    },
    dataRoot
  )

  let output = runHook(
    {
      sessionId,
      cwd: workspace,
      toolName: 'voidr-voidr_workspace_select_test_repository',
      toolArgs: { path: testRepo }
    },
    dataRoot
  )
  assert.equal(output.permissionDecision, 'deny')
  assert.match(output.permissionDecisionReason, /confirm one with the user/i)

  assert.deepEqual(
    runHook(
      {
        sessionId,
        cwd: workspace,
        toolName: 'voidr-applications_list_environments',
        toolArgs: { applicationId: 'app-1' }
      },
      dataRoot
    ),
    {}
  )

  assert.deepEqual(
    runHook(
      {
        sessionId,
        cwd: workspace,
        toolName: 'voidr-voidr_workspace_select_test_repository',
        toolArgs: { path: testRepo, workspaceRoot: workspace }
      },
      dataRoot
    ),
    {}
  )

  submitPrompt(
    {
      sessionId,
      timestamp: now + 2,
      prompt: 'produção — producao — https://prod.example.test',
      transformedPrompt: 'produção — producao — https://prod.example.test'
    },
    dataRoot
  )

  output = runHook(
    {
      sessionId,
      cwd: workspace,
      toolName: 'voidr-voidr_workspace_prepare_test_repository',
      toolArgs: {
        repositoryPath: testRepo,
        applicationId: 'app-1',
        environmentSlug: 'staging'
      }
    },
    dataRoot
  )
  assert.equal(output.permissionDecision, 'deny')
  assert.match(output.permissionDecisionReason, /producao/i)

  assert.deepEqual(
    runHook(
      {
        sessionId,
        cwd: workspace,
        toolName: 'voidr-voidr_workspace_prepare_test_repository',
        toolArgs: {
          repositoryPath: testRepo,
          applicationId: 'app-1',
          environmentSlug: 'producao',
          workspaceRoot: workspace
        }
      },
      dataRoot
    ),
    {}
  )
})

test('blocks local writes before a test repository is selected', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'voidr-hook-state-'))
  const workspace = mkdtempSync(join(tmpdir(), 'voidr-workspace-'))
  const sessionId = 'pre-selection-write-gate'
  const now = Date.now()

  submitPrompt(
    {
      sessionId,
      timestamp: now,
      prompt: 'Quero desenvolver testes na Voidr',
      transformedPrompt: 'Quero desenvolver testes na Voidr'
    },
    dataRoot
  )
  submitPrompt(
    {
      sessionId,
      timestamp: now + 1,
      prompt: 'Criar novo Test Plan',
      transformedPrompt: 'Criar novo Test Plan'
    },
    dataRoot
  )

  const output = runHook(
    {
      sessionId,
      cwd: workspace,
      toolName: 'replace_string_in_file',
      toolArgs: {
        path: join(workspace, '.env.example'),
        old_str: 'OLD',
        new_str: 'NEW'
      }
    },
    dataRoot
  )
  assert.equal(output.permissionDecision, 'deny')
  assert.match(
    output.permissionDecisionReason,
    /before the linked test repository is explicitly selected/i
  )
})

test('allows official Test Plan tools before a local repository is selected', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'voidr-hook-state-'))
  const workspace = mkdtempSync(join(tmpdir(), 'voidr-workspace-'))
  const sessionId = 'pre-selection-platform-write'
  const now = Date.now()

  for (const [offset, prompt] of [
    [0, 'Quero desenvolver testes na Voidr'],
    [1, 'Criar novo Test Plan'],
    [2, 'Confirmar insumos do planejamento'],
    [3, 'Aprovo este Test Plan']
  ]) {
    submitPrompt(
      {
        sessionId,
        timestamp: now + offset,
        prompt,
        transformedPrompt: prompt
      },
      dataRoot
    )
  }

  assert.deepEqual(
    runHook(
      {
        sessionId,
        cwd: workspace,
        toolName: 'voidr-test_plans_create_test_plan',
        toolArgs: {
          name: 'Login',
          description: 'Use {{env.TEST_EMAIL}} and {{env.TEST_PASSWORD}}.'
        }
      },
      dataRoot
    ),
    {}
  )
})

test('blocks sensitive product reads during Test Plan research', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'voidr-hook-state-'))
  const workspace = mkdtempSync(join(tmpdir(), 'voidr-workspace-'))
  const productRepo = join(workspace, 'product')
  const sessionId = 'sensitive-product-read'

  mkdirSync(productRepo)
  writeFileSync(
    join(productRepo, 'routes.ts'),
    "export const loginRoute = '/login'\n",
    'utf8'
  )
  writeFileSync(
    join(productRepo, 'auth.ts'),
    "const account = { email: 'qa.user@example.test', password: 'not-a-real-password' }\n",
    'utf8'
  )
  writeFileSync(
    join(productRepo, '.env.example'),
    'TEST_EMAIL=\nTEST_PASSWORD=\n',
    'utf8'
  )

  submitPrompt(
    {
      sessionId,
      timestamp: Date.now(),
      prompt: 'Quero desenvolver testes na Voidr',
      transformedPrompt: 'Quero desenvolver testes na Voidr'
    },
    dataRoot
  )
  submitPrompt(
    {
      sessionId,
      timestamp: Date.now() + 1,
      prompt: 'Criar novo Test Plan',
      transformedPrompt: 'Criar novo Test Plan'
    },
    dataRoot
  )

  assert.deepEqual(
    runHook(
      {
        sessionId,
        cwd: workspace,
        toolName: 'read_file',
        toolArgs: { path: join(productRepo, 'routes.ts') }
      },
      dataRoot
    ),
    {}
  )

  const sensitive = runHook(
    {
      sessionId,
      cwd: workspace,
      toolName: 'read_file',
      toolArgs: { path: join(productRepo, 'auth.ts') }
    },
    dataRoot
  )
  assert.equal(sensitive.permissionDecision, 'deny')
  assert.match(
    sensitive.permissionDecisionReason,
    /literal credentials or personal identifiers/i
  )

  const env = runHook(
    {
      sessionId,
      cwd: workspace,
      toolName: 'read_file',
      toolArgs: { path: join(productRepo, '.env.example') }
    },
    dataRoot
  )
  assert.equal(env.permissionDecision, 'deny')
  assert.match(env.permissionDecisionReason, /never read .env files/i)
})

test('blocks literal sensitive data in Test Plan writes', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'voidr-hook-state-'))
  const workspace = mkdtempSync(join(tmpdir(), 'voidr-workspace-'))
  const sessionId = 'platform-sensitive-content'
  const now = Date.now()

  for (const [offset, prompt] of [
    [0, 'Quero desenvolver testes na Voidr'],
    [1, 'Criar novo Test Plan'],
    [2, 'Confirmar insumos do planejamento'],
    [3, 'Aprovo este Test Plan']
  ]) {
    submitPrompt(
      {
        sessionId,
        timestamp: now + offset,
        prompt,
        transformedPrompt: prompt
      },
      dataRoot
    )
  }

  const output = runHook(
    {
      sessionId,
      cwd: workspace,
      toolName: 'voidr-test_plans_create_test_plan',
      toolArgs: {
        name: 'Login',
        description:
          'Authenticate qa.user@example.test with password not-a-real-password.'
      }
    },
    dataRoot
  )
  assert.equal(output.permissionDecision, 'deny')
  assert.match(
    output.permissionDecisionReason,
    /literal credential or personal identifier/i
  )
})

test('stops automatic diagnosis, edits, and retries after the first smoke call', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'voidr-hook-state-'))
  const workspace = mkdtempSync(join(tmpdir(), 'voidr-workspace-'))
  const sessionId = 'post-smoke-stop'
  const now = Date.now()

  submitPrompt(
    {
      sessionId,
      timestamp: now,
      prompt: 'Quero implementar testes na Voidr',
      transformedPrompt: 'Quero implementar testes na Voidr'
    },
    dataRoot
  )
  submitPrompt(
    {
      sessionId,
      timestamp: now + 1,
      prompt: 'Usar Test Plan existente',
      transformedPrompt: 'Usar Test Plan existente'
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
  submitPrompt(
    {
      sessionId,
      timestamp: now + 2,
      prompt: 'produção — producao — https://prod.example.test',
      transformedPrompt: 'produção — producao — https://prod.example.test'
    },
    dataRoot
  )

  assert.deepEqual(
    runHook(
      {
        sessionId,
        cwd: workspace,
        toolName: 'voidr-voidr_smoke_build',
        toolArgs: { repositoryPath: workspace }
      },
      dataRoot
    ),
    {}
  )

  for (const request of [
    {
      toolName: 'view',
      toolArgs: { path: join(workspace, 'playwright.config.js') }
    },
    {
      toolName: 'edit',
      toolArgs: {
        path: join(workspace, 'test.spec.js'),
        new_str: 'test("retry", () => {})'
      }
    },
    {
      toolName: 'voidr-voidr_smoke_build',
      toolArgs: { repositoryPath: workspace }
    }
  ]) {
    const output = runHook(
      { sessionId, cwd: workspace, ...request },
      dataRoot
    )
    assert.equal(output.permissionDecision, 'deny')
    assert.match(output.permissionDecisionReason, /after voidr_smoke_build/i)
  }

  submitPrompt(
    {
      sessionId,
      timestamp: now + 3,
      prompt: 'Investigue e corrija a falha do smoke',
      transformedPrompt: 'Investigue e corrija a falha do smoke'
    },
    dataRoot
  )
  assert.deepEqual(
    runHook(
      {
        sessionId,
        cwd: workspace,
        toolName: 'view',
        toolArgs: { path: join(workspace, 'playwright.config.js') }
      },
      dataRoot
    ),
    {}
  )
})

test('blocks unsafe literals and frontend-derived API origins in spec edits', () => {
  const unsafeEdits = [
    {
      new_str:
        "const email = process.env.TEST_EMAIL || 'person@example.test';"
    },
    {
      new_str: "await page.fill('#email', 'person@example.test');"
    },
    {
      new_str:
        "const apiUrl = window.location.origin; await request.get(`${apiUrl}/consultas/123`);"
    },
    {
      new_str:
        "const apiBase = baseURL; await request.get(`${apiBase}/auth/login`);"
    }
  ]

  for (const [index, toolArgs] of unsafeEdits.entries()) {
    const output = runHook({
      sessionId: `unsafe-spec-${index}`,
      cwd: process.cwd(),
      toolName: 'edit',
      toolArgs: {
        path: resolve(process.cwd(), 'modules/login/test.spec.js'),
        ...toolArgs
      }
    })
    assert.equal(output.permissionDecision, 'deny')
  }
})
function transcriptEntry(type, data) {
  return JSON.stringify({ type, data })
}

test('blocks a manual clone or a fabricated checkout during a workflow', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'voidr-hook-materialize-'))
  const sessionId = 'materialization-gate'
  const now = Date.now()
  const workspace = mkdtempSync(join(tmpdir(), 'voidr-materialize-ws-'))

  submitPrompt(
    {
      sessionId,
      timestamp: now,
      prompt: 'Quero desenvolver testes na Voidr',
      transformedPrompt: 'Quero desenvolver testes na Voidr'
    },
    dataRoot
  )
  submitPrompt(
    {
      sessionId,
      timestamp: now + 1,
      prompt: 'Usar Test Plan existente',
      transformedPrompt: 'Usar Test Plan existente'
    },
    dataRoot
  )

  // The preparation records which repository the plan is linked to.
  runHook(
    {
      sessionId,
      cwd: workspace,
      toolName: 'voidr-voidr_workspace_prepare_test_repository',
      toolArgs: {
        repositoryPath: join(workspace, 'voidr-tp-desk-web'),
        repositoryUrl: 'https://github.com/voidrco/voidr-tp-desk-web',
        workspaceRoot: workspace
      }
    },
    dataRoot
  )

  const denied = {
    'git clone https://github.com/voidrco/voidr-tp-desk-web tests':
      /never clone the Voidr test repository/i,
    'git clone https://github.com/voidrco/voidr-tp-plano-e37c1b5b skeleton':
      /never clone the Voidr test repository/i,
    'git init ; git remote add origin https://github.com/voidrco/voidr-tp-desk-web':
      /never create a Git repository or add a remote by hand/i,
    'cd tests && git remote add origin https://example.test/repo.git':
      /never create a Git repository or add a remote by hand/i
  }
  for (const [command, reason] of Object.entries(denied)) {
    const output = runHook(
      { sessionId, cwd: workspace, toolName: 'bash', toolArgs: { command } },
      dataRoot
    )
    assert.equal(output.permissionDecision, 'deny', command)
    assert.match(output.permissionDecisionReason, reason, command)
  }

  // Cloning something that is not the test repository stays the user's business,
  // and reading Git state is never blocked.
  for (const command of [
    'git clone https://github.com/blip/desk-web product',
    'git status',
    'git remote -v'
  ]) {
    assert.deepEqual(
      runHook(
        { sessionId, cwd: workspace, toolName: 'bash', toolArgs: { command } },
        dataRoot
      ),
      {},
      command
    )
  }
})

test('blocks Node runtime installs from the agent terminal during a workflow', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'voidr-hook-state-'))
  const sessionId = 'runtime-install-gate'
  const now = Date.now()

  submitPrompt(
    {
      sessionId,
      timestamp: now,
      prompt: 'Quero desenvolver testes na Voidr',
      transformedPrompt: 'Quero desenvolver testes na Voidr'
    },
    dataRoot
  )
  submitPrompt(
    {
      sessionId,
      timestamp: now + 1,
      prompt: 'Usar Test Plan existente',
      transformedPrompt: 'Usar Test Plan existente'
    },
    dataRoot
  )

  for (const command of [
    'nvm install 22',
    'nvm use 22 && npm test',
    'nvs add 22',
    'nvs use 22',
    'volta install node@22',
    'sudo apt-get install -y nodejs',
    'curl -fsSL https://nodejs.org/dist/v22.0.0/node-v22.0.0-linux-x64.tar.xz -o node.tar.xz'
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
    assert.match(output.permissionDecisionReason, /Node 22/, command)
  }

  assert.deepEqual(
    runHook(
      {
        sessionId,
        cwd: process.cwd(),
        toolName: 'bash',
        toolArgs: { command: 'git status --porcelain' }
      },
      dataRoot
    ),
    {}
  )
})

test('blocks terminal git publishing during a workflow and points to the bridge tool', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'voidr-hook-state-'))
  const sessionId = 'terminal-publish-gate'
  const now = Date.now()

  submitPrompt(
    {
      sessionId,
      timestamp: now,
      prompt: 'Quero desenvolver testes na Voidr',
      transformedPrompt: 'Quero desenvolver testes na Voidr'
    },
    dataRoot
  )
  submitPrompt(
    {
      sessionId,
      timestamp: now + 1,
      prompt: 'Usar Test Plan existente',
      transformedPrompt: 'Usar Test Plan existente'
    },
    dataRoot
  )

  for (const command of [
    'cd /tmp/tests && git add . && git commit -m "feat: new test"',
    'git push origin feat/new-tests',
    'gh pr create --title "tests"'
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
      /voidr_workspace_publish_tests/,
      command
    )
  }

  for (const command of [
    'git status --porcelain',
    'git reset --soft HEAD~1',
    'git log --oneline -5'
  ]) {
    assert.deepEqual(
      runHook(
        {
          sessionId,
          cwd: process.cwd(),
          toolName: 'bash',
          toolArgs: { command }
        },
        dataRoot
      ),
      {},
      command
    )
  }
})

test('blocks editor reads and writes of .env files during a workflow', () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'voidr-hook-state-'))
  const sessionId = 'env-file-gate'
  const now = Date.now()

  submitPrompt(
    {
      sessionId,
      timestamp: now,
      prompt: 'Quero desenvolver testes na Voidr',
      transformedPrompt: 'Quero desenvolver testes na Voidr'
    },
    dataRoot
  )
  submitPrompt(
    {
      sessionId,
      timestamp: now + 1,
      prompt: 'Usar Test Plan existente',
      transformedPrompt: 'Usar Test Plan existente'
    },
    dataRoot
  )

  for (const request of [
    {
      toolName: 'read_file',
      toolArgs: { filePath: '/tmp/tests/.env', startLine: 1, endLine: 30 }
    },
    {
      toolName: 'create_file',
      toolArgs: { filePath: '/tmp/tests/.env', content: '' }
    },
    {
      toolName: 'read_file',
      toolArgs: { filePath: '/tmp/tests/.env.local', startLine: 1, endLine: 5 }
    }
  ]) {
    const output = runHook(
      { sessionId, cwd: process.cwd(), ...request },
      dataRoot
    )
    assert.equal(output.permissionDecision, 'deny', request.toolName)
    assert.match(
      output.permissionDecisionReason,
      /opaque secret material|never read \.env files/,
      request.toolArgs.filePath
    )
  }

  const template = runHook(
    {
      sessionId,
      cwd: process.cwd(),
      toolName: 'create_file',
      toolArgs: { filePath: '/tmp/tests/notes.md', content: 'ok' }
    },
    dataRoot
  )
  assert.notEqual(template.permissionDecisionReason?.includes('opaque secret material'), true)
})
