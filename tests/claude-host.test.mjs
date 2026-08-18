import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { isDevTestFlowPrompt } from '../scripts/lib/session-state.mjs'
import { routeVoidrPrompt } from '../scripts/lib/prompt-router.mjs'

const root = resolve(import.meta.dirname, '..')
const guard = join(root, 'scripts/guard-hive-tools.mjs')
const promptHook = join(root, 'scripts/route-voidr-prompt.mjs')
const postToolHook = join(root, 'scripts/post-tool-execution-links.mjs')
const stopHook = join(root, 'scripts/require-execution-links.mjs')

function runScript(script, payload, dataRoot, extraEnv = {}) {
  const result = spawnSync(process.execPath, [script], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: {
      ...process.env,
      COPILOT_PLUGIN_DATA: dataRoot,
      VOIDR_PLATFORM_URL: 'https://platform.voidr.co',
      ...extraEnv
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
    /\/voidr-context/
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
  assert.match(copilot.modifiedTransformedPrompt, /\/voidr-context/)
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
    '/voidr-context',
    '/copilot voidr-context',
    '/copilot:voidr-context',
    '/voidr:voidr-context'
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
  assert.match(stop().systemMessage, /without the required execution evidence/)
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
  assert.match(stop().systemMessage, /without the required execution evidence/)

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
    /\/voidr-context/
  )
})

// Recorded from a real Claude Code AskUserQuestion call, not inferred from the
// tool schema: `answers` is a flat map of strings keyed by the full question
// text, `annotations` is present but empty, and the identical block is echoed
// on both the tool input and the tool response.
function askUserPayload(sessionId, { question, header, options, answer }) {
  const block = {
    questions: [{ question, header, options, multiSelect: false }],
    answers: { [question]: answer },
    annotations: {}
  }
  return {
    hook_event_name: 'PostToolUse',
    session_id: sessionId,
    tool_name: 'AskUserQuestion',
    tool_input: block,
    tool_response: block
  }
}

test('an AskUserQuestion selection reaches the gates', () => {
  // Miss that shape and nothing is recorded: the mandatory plan-mode question
  // can never be answered and every following tool call is denied forever.
  const state = dataRoot()
  const sessionId = 'claude-ask-plan-mode'

  runScript(
    promptHook,
    {
      hook_event_name: 'UserPromptSubmit',
      session_id: sessionId,
      cwd: root,
      prompt: 'Quero desenvolver testes na voidr'
    },
    state
  )

  runScript(
    postToolHook,
    askUserPayload(sessionId, {
      question: 'O Test Plan é novo ou existente?',
      header: 'Test Plan',
      options: [
        { label: 'Criar novo Test Plan', description: 'x' },
        { label: 'Usar Test Plan existente', description: 'y' }
      ],
      answer: 'Criar novo Test Plan'
    }),
    state
  )

  // With plan mode recorded the listing gate opens.
  const listing = runScript(
    guard,
    {
      hook_event_name: 'PreToolUse',
      session_id: sessionId,
      cwd: root,
      tool_name: 'mcp__plugin_voidr_voidr__applications_list_applications',
      tool_input: {}
    },
    state
  )
  assert.notEqual(
    listing.hookSpecificOutput?.permissionDecision,
    'deny',
    JSON.stringify(listing)
  )
})

test('a clicked option is never mistaken for a typed approval', () => {
  const state = dataRoot()
  const sessionId = 'claude-ask-authorship'
  const ask = (options, answer, answerKey = null) => {
    const payload = askUserPayload(sessionId, {
      question: 'Aprova?',
      header: 'Aprovação',
      options,
      answer
    })
    if (answerKey) {
      for (const block of [payload.tool_input, payload.tool_response]) {
        block.answers = { [answerKey]: answer }
      }
    }
    return runScript(postToolHook, payload, state)
  }
  const attemptWrite = () =>
    runScript(
      guard,
      {
        hook_event_name: 'PreToolUse',
        session_id: sessionId,
        cwd: root,
        tool_name: 'mcp__plugin_voidr_voidr__test_plans_create_test_plan',
        tool_input: { name: 'x' }
      },
      state
    )

  // AskUserQuestion requires two to four options, so a question with none is
  // not a shape Claude can produce. Typed text arrives through the "Other"
  // escape hatch the picker always offers, as an answer that is none of the
  // labels — which is exactly what the authorship inference reads.
  const offered = [
    { label: 'Aprovo este Test Plan', description: 'x' },
    { label: 'Não aprovo', description: 'y' }
  ]

  // Offering the phrase as a clickable option must not grant the approval:
  // the gate exists to prove the user authored it.
  ask(offered, 'Aprovo este Test Plan')
  assert.equal(attemptWrite().hookSpecificOutput.permissionDecision, 'deny')

  // Same click, but keyed by header instead of question text. Authorship must
  // not hinge on which key Claude uses, or a click would read as typed.
  ask(offered, 'Aprovo este Test Plan', 'Aprovação')
  assert.equal(attemptWrite().hookSpecificOutput.permissionDecision, 'deny')

  // A malformed payload that carries no labels must not be trusted as typed
  // either: with nothing to compare against, a click is indistinguishable.
  ask([], 'Aprovo este Test Plan')
  assert.equal(attemptWrite().hookSpecificOutput.permissionDecision, 'deny')

  // Typed through "Other": the answer matches no offered label.
  ask(
    [
      { label: 'Sim', description: 'x' },
      { label: 'Não', description: 'y' }
    ],
    'Aprovo este Test Plan'
  )
  const allowed = attemptWrite()
  assert.notEqual(
    allowed.hookSpecificOutput?.permissionDecision,
    'deny',
    JSON.stringify(allowed)
  )
})

test("Claude's editor tools cannot walk past the write and .env gates", () => {
  const state = dataRoot()
  const sessionId = 'claude-editor-tools'
  runScript(
    promptHook,
    {
      hook_event_name: 'UserPromptSubmit',
      session_id: sessionId,
      cwd: root,
      prompt: 'Quero desenvolver testes na voidr'
    },
    state
  )

  // NotebookEdit has no separator before "Edit", so the snake_case-era
  // heuristics saw neither a write nor a read and five gates opened.
  const notebook = runScript(
    guard,
    {
      hook_event_name: 'PreToolUse',
      session_id: sessionId,
      cwd: root,
      tool_name: 'NotebookEdit',
      tool_input: { notebook_path: '/tmp/anywhere.ipynb', new_source: 'x' }
    },
    state
  )
  assert.equal(
    notebook.hookSpecificOutput.permissionDecision,
    'deny',
    JSON.stringify(notebook)
  )

  // Grep returns file contents, so it is a read of .env like any other.
  for (const tool of ['Grep', 'Read']) {
    const output = runScript(
      guard,
      {
        hook_event_name: 'PreToolUse',
        session_id: sessionId,
        cwd: root,
        tool_name: tool,
        tool_input: { path: '/tmp/repo/.env', pattern: 'SECRET' }
      },
      state
    )
    assert.equal(
      output.hookSpecificOutput.permissionDecision,
      'deny',
      `${tool}: ${JSON.stringify(output)}`
    )
  }
})

test('injecting defect evidence does not auto-approve the mutation', () => {
  const state = dataRoot()
  const executionId = '6a6a839850a27b89d2d7df2b'
  const sessionId = 'claude-defect-evidence'
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
  const output = runScript(
    guard,
    {
      hook_event_name: 'PreToolUse',
      session_id: sessionId,
      cwd: root,
      tool_name: 'mcp__plugin_voidr_voidr__defects_create_defect',
      tool_input: { title: 'Falha' }
    },
    state
  )
  // The hook wants the evidence in the arguments, not to waive the permission
  // prompt Claude would otherwise show for a platform mutation.
  assert.ok(output.hookSpecificOutput.updatedInput)
  assert.equal(output.hookSpecificOutput.permissionDecision, undefined)
  assert.equal(output.permissionDecision, undefined)
})

test('the Claude routing note names the namespaced skill', () => {
  const output = runScript(
    promptHook,
    {
      hook_event_name: 'UserPromptSubmit',
      session_id: 'claude-namespace-note',
      cwd: root,
      prompt: 'Quero desenvolver testes na voidr'
    },
    dataRoot()
  )
  assert.match(
    output.hookSpecificOutput.additionalContext,
    /\/voidr:voidr-<name>/
  )
})

test('the connect flow arms its gate from a Claude-namespaced call', () => {
  // connectFirstToolRequired is set by the prompt hook recognizing the skill
  // call. Miss the namespace and /voidr:voidr-connect loses its gate.
  const state = mkdtempSync(join(tmpdir(), 'voidr-claude-connect-'))
  runScript(
    promptHook,
    {
      hook_event_name: 'UserPromptSubmit',
      session_id: 'claude-connect',
      cwd: root,
      prompt: '/voidr:voidr-connect'
    },
    state,
    // Pin an empty credential store: the gate only arms when there is something
    // to connect, so without this the test passes or fails according to whether
    // whoever runs it happens to be logged in.
    { VOIDR_SERVICE_ACCOUNTS_PATH: join(state, 'service-accounts.json') }
  )
  const recorded = JSON.parse(
    readFileSync(join(state, 'sessions/latest-prompt-state.json'), 'utf8')
  )
  assert.equal(recorded.connectWorkflowActive, true)
  assert.equal(recorded.connectFirstToolRequired, true)
})

test('an authenticated machine has nothing to connect, so the gate stays open', () => {
  const state = mkdtempSync(join(tmpdir(), 'voidr-claude-connected-'))
  const store = join(state, 'service-accounts.json')
  writeFileSync(
    store,
    JSON.stringify({
      activeOrgId: 'org_abc',
      accounts: {
        org_abc: {
          clientId: 'sa_test',
          clientSecret: 'sk_test',
          orgName: 'Test',
          scopes: ['read', 'write']
        }
      }
    })
  )
  runScript(
    promptHook,
    {
      hook_event_name: 'UserPromptSubmit',
      session_id: 'claude-connected',
      cwd: root,
      prompt: '/voidr:voidr-connect'
    },
    state,
    { VOIDR_SERVICE_ACCOUNTS_PATH: store }
  )
  const recorded = JSON.parse(
    readFileSync(join(state, 'sessions/latest-prompt-state.json'), 'utf8')
  )
  assert.equal(recorded.connectFirstToolRequired, false)
})

test('an empty transformed prompt keeps the user message', () => {
  // Copilot rewrites the prompt, so losing it here would replace what the user
  // typed with the routing note alone.
  const output = runScript(
    promptHook,
    {
      sessionId: 'empty-transformed',
      cwd: root,
      prompt: 'Quero desenvolver testes na voidr',
      transformedPrompt: ''
    },
    dataRoot()
  )
  assert.match(
    output.modifiedTransformedPrompt,
    /^Quero desenvolver testes na voidr\n\nThis is a Voidr platform testing request/
  )
})

test('gate state lands in the Claude plugin data directory', () => {
  const state = mkdtempSync(join(tmpdir(), 'voidr-claude-data-'))
  const result = spawnSync(process.execPath, [promptHook], {
    input: JSON.stringify({
      hook_event_name: 'UserPromptSubmit',
      session_id: 'claude-data-root',
      cwd: root,
      prompt: 'Criar novo Test Plan'
    }),
    encoding: 'utf8',
    // Claude sets CLAUDE_PLUGIN_DATA, never COPILOT_PLUGIN_DATA. Without it the
    // gate hooks would fall back to a temp directory and lose typed approvals.
    env: {
      HOME: process.env.HOME,
      PATH: process.env.PATH,
      CLAUDE_PLUGIN_DATA: state
    }
  })
  assert.equal(result.status, 0, result.stderr)
  const written = JSON.parse(
    readFileSync(join(state, 'sessions/latest-prompt-state.json'), 'utf8')
  )
  assert.equal(written.planMode, 'new')
})
