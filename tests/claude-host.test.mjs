import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  isDevTestFlowPrompt,
  isNewPlanChoice
} from '../scripts/lib/session-state.mjs'
import { routeVoidrPrompt } from '../scripts/lib/prompt-router.mjs'

const root = resolve(import.meta.dirname, '..')
const guard = join(root, 'scripts/guard-hive-tools.mjs')
const promptHook = join(root, 'scripts/route-voidr-prompt.mjs')
const postToolHook = join(root, 'scripts/post-tool-execution-links.mjs')
const stopHook = join(root, 'scripts/require-execution-links.mjs')

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

function dataRoot() {
  return mkdtempSync(join(tmpdir(), 'voidr-claude-'))
}

test('the prompt hook answers each host in its own dialect', () => {
  const prompt = 'Quero desenvolver testes na voidr'

  // Claude cannot rewrite the prompt, so the routing note arrives as context.
  const claude = runScript(
    promptHook,
    {
      hook_event_name: 'UserPromptSubmit',
      session_id: 'claude-prompt',
      cwd: root,
      prompt
    },
    dataRoot()
  )
  assert.equal(
    claude.hookSpecificOutput.hookEventName,
    'UserPromptSubmit'
  )
  assert.match(
    claude.hookSpecificOutput.additionalContext,
    /\/voidr-develop-tests/
  )
  assert.equal(claude.modifiedTransformedPrompt, undefined)
  // The note must stand on its own: Claude never sees it glued to the prompt.
  assert.doesNotMatch(
    claude.hookSpecificOutput.additionalContext,
    /Quero desenvolver testes/
  )

  const copilot = runScript(
    promptHook,
    {
      sessionId: 'copilot-prompt',
      cwd: root,
      prompt,
      transformedPrompt: prompt
    },
    dataRoot()
  )
  assert.match(copilot.modifiedTransformedPrompt, /\/voidr-develop-tests/)
  assert.match(copilot.modifiedTransformedPrompt, /^Quero desenvolver testes/)
  assert.equal(copilot.hookSpecificOutput, undefined)
})

test('both hosts route the same prompts and stay silent on the same ones', () => {
  for (const prompt of [
    'Quero desenvolver testes na voidr',
    'Quero criar um teste',
    'Cria os testes da minha feature'
  ]) {
    const routed = routeVoidrPrompt({ prompt, transformedPrompt: prompt })
    assert.ok(routed.guidance, prompt)
    assert.equal(
      routed.modifiedTransformedPrompt,
      `${prompt}\n\n${routed.guidance}`,
      prompt
    )
  }
  assert.deepEqual(
    routeVoidrPrompt({
      prompt: 'Corrija o teste unitário deste arquivo',
      transformedPrompt: 'Corrija o teste unitário deste arquivo'
    }),
    {}
  )
})

test('an explicit skill call is recognized in every host namespace', () => {
  for (const prompt of [
    '/voidr-develop-tests',
    '/copilot voidr-develop-tests',
    '/copilot:voidr-develop-tests',
    '/voidr:voidr-develop-tests'
  ]) {
    assert.deepEqual(
      routeVoidrPrompt({ prompt, transformedPrompt: prompt }),
      {},
      prompt
    )
  }
  // The dev-first flow keys off its own invocation, including Claude's.
  assert.equal(isDevTestFlowPrompt('/voidr:voidr-feature-test'), true)
  assert.equal(isDevTestFlowPrompt('/copilot voidr-feature-test'), true)
})

test('the Hive guard reads Claude scoped MCP tool names', () => {
  // Claude exposes plugin MCP tools as mcp__plugin_<plugin>_<server>__<tool>.
  // The canonical name has to survive that prefix or every gate opens.
  const denied = runScript(
    guard,
    {
      hook_event_name: 'PreToolUse',
      session_id: 'claude-guard',
      cwd: root,
      tool_name: 'mcp__plugin_voidr_voidr__test_plans_create_test_plan',
      tool_input: { name: 'Novo plano' }
    },
    dataRoot()
  )
  assert.equal(denied.hookSpecificOutput.permissionDecision, 'deny')
  assert.match(denied.hookSpecificOutput.permissionDecisionReason, /Aprovo/i)

  const forbidden = runScript(
    guard,
    {
      hook_event_name: 'PreToolUse',
      session_id: 'claude-guard-hive',
      cwd: root,
      tool_name:
        'mcp__plugin_voidr_voidr__agent_jobs_trigger_hive_automation',
      tool_input: {}
    },
    dataRoot()
  )
  assert.equal(forbidden.hookSpecificOutput.permissionDecision, 'deny')
  assert.match(
    forbidden.hookSpecificOutput.permissionDecisionReason,
    /Hive process/i
  )
})

test("the Hive guard reads Claude's own tool names", () => {
  const denied = runScript(
    guard,
    {
      hook_event_name: 'PreToolUse',
      session_id: 'claude-shell',
      cwd: root,
      tool_name: 'Bash',
      tool_input: { command: 'curl -X POST https://api.voidr.co/v1/agent-jobs/trigger' }
    },
    dataRoot()
  )
  assert.equal(denied.hookSpecificOutput.permissionDecision, 'deny')
})

test('execution evidence blocks a Claude response without its link', () => {
  const state = dataRoot()
  const sessionId = 'claude-execution-link'
  const executionId = '6a6a839850a27b89d2d7df2b'
  const link = `https://platform.voidr.co/execution/${executionId}`

  const post = runScript(
    postToolHook,
    {
      hook_event_name: 'PostToolUse',
      session_id: sessionId,
      tool_name: 'mcp__plugin_voidr_voidr__playwright_list_execution_failures',
      tool_input: { executionId },
      tool_response: { content: [] }
    },
    state
  )
  assert.match(post.hookSpecificOutput.additionalContext, new RegExp(executionId))

  // Claude hands the Stop hook the final message, so no transcript is parsed.
  const blocked = runScript(
    stopHook,
    {
      hook_event_name: 'Stop',
      session_id: sessionId,
      last_assistant_message: 'A falha é intermitente.'
    },
    state
  )
  assert.equal(blocked.decision, 'block')
  assert.match(blocked.reason, new RegExp(executionId))
  assert.equal(blocked.hookSpecificOutput, undefined)

  const allowed = runScript(
    stopHook,
    {
      hook_event_name: 'Stop',
      session_id: sessionId,
      last_assistant_message: `Pronto. Execution: [Open execution](${link})`
    },
    state
  )
  assert.deepEqual(allowed, {})
})

test('the Stop gate releases the turn instead of looping forever', () => {
  const state = dataRoot()
  const sessionId = 'claude-stop-loop'
  const executionId = '6a6a839850a27b89d2d7df2c'

  runScript(
    postToolHook,
    {
      hook_event_name: 'PostToolUse',
      session_id: sessionId,
      tool_name: 'mcp__plugin_voidr_voidr__playwright_list_execution_failures',
      tool_input: { executionId },
      tool_response: { content: [] }
    },
    state
  )

  const stop = () =>
    runScript(
      stopHook,
      {
        hook_event_name: 'Stop',
        session_id: sessionId,
        last_assistant_message: 'Ainda sem os links.'
      },
      state
    )

  // Claude ships no stop_hook_active flag, so the gate counts its own blocks.
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    assert.equal(stop().decision, 'block', `attempt ${attempt}`)
  }
  assert.deepEqual(stop(), {})
})

test('a new user turn re-arms the Stop gate', () => {
  const state = dataRoot()
  const sessionId = 'claude-stop-rearm'
  const executionId = '6a6a839850a27b89d2d7df2d'

  const seed = () =>
    runScript(
      postToolHook,
      {
        hook_event_name: 'PostToolUse',
        session_id: sessionId,
        tool_name:
          'mcp__plugin_voidr_voidr__playwright_list_execution_failures',
        tool_input: { executionId },
        tool_response: { content: [] }
      },
      state
    )
  const stop = () =>
    runScript(
      stopHook,
      {
        hook_event_name: 'Stop',
        session_id: sessionId,
        last_assistant_message: 'Sem links.'
      },
      state
    )

  seed()
  for (let attempt = 1; attempt <= 3; attempt += 1) stop()
  assert.deepEqual(stop(), {})

  runScript(
    promptHook,
    {
      hook_event_name: 'UserPromptSubmit',
      session_id: sessionId,
      cwd: root,
      prompt: 'E agora, o que falhou?'
    },
    state
  )
  seed()
  assert.equal(stop().decision, 'block')
})

test('the two host manifests describe the same plugin', () => {
  const copilot = JSON.parse(readFileSync(join(root, 'plugin.json'), 'utf8'))
  const claude = JSON.parse(
    readFileSync(join(root, '.claude-plugin/plugin.json'), 'utf8')
  )
  assert.equal(claude.version, copilot.version)
  assert.equal(claude.description, copilot.description)

  const copilotMcp = JSON.parse(readFileSync(join(root, '.mcp.json'), 'utf8'))
  const claudeMcp = JSON.parse(
    readFileSync(join(root, 'mcp/claude.json'), 'utf8')
  )
  assert.deepEqual(
    claudeMcp.mcpServers.voidr.env,
    copilotMcp.mcpServers.voidr.env
  )
  assert.match(
    claudeMcp.mcpServers.voidr.args[0],
    /^\$\{CLAUDE_PLUGIN_ROOT\}/
  )
})

test('the Claude hook commands resolve and run the real scripts', () => {
  const hooks = JSON.parse(readFileSync(join(root, 'hooks/hooks.json'), 'utf8'))
  const command = hooks.hooks.UserPromptSubmit[0].hooks[0].command
  const prompt = 'Quero desenvolver testes na voidr'
  const result = spawnSync('/bin/bash', ['-lc', command], {
    input: JSON.stringify({
      hook_event_name: 'UserPromptSubmit',
      session_id: 'claude-hook-command',
      cwd: root,
      prompt
    }),
    encoding: 'utf8',
    env: {
      HOME: process.env.HOME,
      PATH: process.env.PATH,
      CLAUDE_PLUGIN_ROOT: root,
      COPILOT_PLUGIN_DATA: dataRoot()
    }
  })
  assert.equal(result.status, 0, result.stderr)
  assert.match(
    JSON.parse(result.stdout).hookSpecificOutput.additionalContext,
    /\/voidr-develop-tests/
  )
})

test('plan-mode recognizers are shared, not host-specific', () => {
  assert.equal(isNewPlanChoice('Criar novo Test Plan'), true)
})
