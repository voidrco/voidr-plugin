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

test('starting a worker job is refused through every channel', () => {
  assert.match(ask('agent_jobs_trigger_automation', { planId: 'x' }).reason, /job/i)
  assert.match(
    ask('Bash', { command: `curl -X POST https://api.example.test/self-healing/trigger` }).reason,
    /job/i
  )
  assert.match(ask('Bash', { command: 'node -e "agent_jobs_trigger_automation()"' }).reason, /job/i)
})

test('an MCP tool call cannot be mistaken for a shell fragment', () => {
  // Shell fragments are matched only for shell tools, so a platform read whose
  // arguments happen to quote one is not a job request.
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
    ['Bash', { command: 'npm run voidr:deploy' }],
    ['Bash', { command: 'kubectl -n voidr-hive get pods' }]
  ]
  for (const [tool, input] of allowed) {
    const verdict = ask(tool, input)
    assert.equal(verdict.denied, false, `${tool} should be allowed: ${verdict.reason}`)
  }
})

test('a protection does not wait for a workflow to be active', () => {
  assert.equal(ask('agent_jobs_trigger_automation', {}).denied, true)
})
