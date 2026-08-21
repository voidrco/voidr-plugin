import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'

const guard = join(
  resolve(import.meta.dirname, '..'),
  'scripts/guard-protections.mjs'
)

function ask(tool_name, tool_input) {
  const out = execFileSync('node', [guard], {
    input: JSON.stringify({ tool_name, tool_input, hook_event_name: 'PreToolUse' }),
    encoding: 'utf8'
  })
  const parsed = JSON.parse(out)
  return {
    denied: parsed.hookSpecificOutput?.permissionDecision === 'deny',
    reason: parsed.hookSpecificOutput?.permissionDecisionReason || ''
  }
}

const shell = command => ask('Bash', { command })

test('starting a worker job is refused', () => {
  assert.match(ask('agent_jobs_trigger_automation', { planId: 'x' }).reason, /job/i)
  assert.match(shell(`node -e "agent_jobs_trigger_automation()"`).reason, /job/i)
  assert.match(
    shell(`curl -X POST https://api.example.test/self-healing/trigger`).reason,
    /job/i
  )
})

test('an inspection leading the pipeline does not hide a request behind it', () => {
  // Judged per stage, so the allowed verb in front is not a way through.
  assert.equal(shell(`echo ok && node -e "agent_jobs_trigger_automation()"`).denied, true)
  assert.equal(shell(`ls; curl -X POST https://api.example.test/self-healing/trigger`).denied, true)
})

test('naming a job trigger is not requesting one', () => {
  // All four were refused by the first version of this rule, which searched
  // every string in the arguments instead of asking what the command runs.
  const allowed = [
    `grep -rn "agent_jobs_trigger_automation" scripts/`,
    `echo "documentar orchestrator-self-healing" >> notas.md`,
    `git commit -m "notas sobre orchestrator-self-healing"`,
    `cat runbook.md | grep orchestrator-self-healing`
  ]
  for (const command of allowed) {
    const verdict = shell(command)
    assert.equal(verdict.denied, false, `should be allowed: ${command} — ${verdict.reason}`)
  }
})

test('a route needs something able to send it', () => {
  assert.equal(shell(`echo "a rota /self-healing/trigger existe" >> doc.md`).denied, false)
  assert.equal(shell('curl -s https://api.example.test/docs > d.html').denied, false)
})

test('an MCP tool call is matched by the tool being called, not its arguments', () => {
  const verdict = ask('mcp__plugin_voidr_voidr__test_plans_get_case', {
    caseSlug: 'TROCA-01',
    notes: 'see orchestrator-self-healing in the runbook'
  })
  assert.equal(verdict.denied, false)
})

test('the machine belongs to the developer', () => {
  // Removed on purpose: the credential store, .env contents, and the legacy
  // mutable deploy. Each is the developer's own machine and their own call.
  const allowed = [
    ['Write', { file_path: join(homedir(), '.voidr', 'service-accounts.json'), content: '{}' }],
    ['Read', { file_path: '/repo/.env' }],
    ['Bash', { command: 'cat .env' }],
    ['Bash', { command: 'npx voidr deploy-latest' }],
    ['Bash', { command: 'kubectl -n voidr-hive get pods' }]
  ]
  for (const [tool, input] of allowed) {
    const verdict = ask(tool, input)
    assert.equal(verdict.denied, false, `${tool} should be allowed: ${verdict.reason}`)
  }
})

test('the rule does not wait for a workflow to be active', () => {
  assert.equal(ask('agent_jobs_trigger_automation', {}).denied, true)
})

test('an MCP tool is called by calling it', () => {
  // Observed with a smaller model: ToolSearch loaded the tool, then the shell
  // was asked for a binary that does not exist, then the same binary through
  // node, then a subagent. Seven tool calls, zero MCP calls.
  assert.match(shell(`mcp call mcp__plugin_voidr_voidr__voidr_context_bootstrap --planId abc`).reason, /directly/i)
  assert.match(
    shell(`node -e "spawnSync('mcp', ['call', 'mcp__plugin_voidr_voidr__voidr_context_bootstrap'])"`).reason,
    /directly/i
  )
  assert.match(
    ask('Agent', { prompt: 'Use a ferramenta MCP `mcp__plugin_voidr_voidr__voidr_context_bootstrap` para fazer bootstrap' }).reason,
    /yourself|directly/i
  )
  assert.equal(ask('Task', { prompt: 'chame mcp__voidr__test_plans_get_case e devolva o caso' }).denied, true)
})

test('the rule is about invocation, not about this plugin', () => {
  // Any MCP server: the mistake is how invocation works, and the answer does
  // not change with the owner of the tool.
  assert.equal(shell(`curl -s localhost/mcp__voidr__test_plans_get_case`).denied, true)
})

test('naming a tool is not calling it, and delegation stays available', () => {
  assert.equal(shell(`grep -rn "mcp__plugin_voidr_voidr__voidr_context_bootstrap" scripts/`).denied, false)
  assert.equal(shell(`echo "doc sobre mcp__plugin_voidr_voidr__voidr_context_bootstrap" >> notas.md`).denied, false)
  assert.equal(
    ask('Agent', { prompt: 'Leia os arquivos em docs/ e resuma a arquitetura' }).denied,
    false
  )
})

test('the tool call itself is never the thing refused', () => {
  assert.equal(ask('mcp__plugin_voidr_voidr__voidr_context_bootstrap', { planId: 'abc' }).denied, false)
})
