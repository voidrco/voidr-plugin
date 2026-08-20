import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'

const guard = join(resolve(import.meta.dirname, '..'), 'scripts/guard-protections.mjs')

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

test('the acts that stay forbidden are refused', () => {
  const store = join(homedir(), '.voidr', 'service-accounts.json')

  assert.match(ask('Write', { file_path: store, content: 'x' }).reason, /Service Account/)
  assert.match(ask('Read', { file_path: '/repo/.env' }).reason, /opaque secret/)
  assert.match(ask('Bash', { command: 'cat .env' }).reason, /never read or print/)
  assert.match(ask('Bash', { command: 'npx voidr deploy-latest' }).reason, /legacy mutable/)
  assert.match(
    ask('Bash', { command: `curl -X POST /${'agent_jobs_trigger_automation'}` }).reason,
    /process/i
  )
})

test('legitimate work is not refused', () => {
  // Every one of these was denied by the previous guard during real work.
  const allowed = [
    ['Write', { file_path: '/notes/policy.md', content: `the store lives at ~/.voidr/service-accounts.json` }],
    ['Bash', { command: 'ls -la /repo/.env' }],
    ['Bash', { command: 'kubectl -n hive get pods' }],
    ['Bash', { command: 'npx voidr build' }],
    ['Bash', { command: 'git commit -m "guard notes"' }],
    ['Edit', { file_path: '/repo/.env.example', old_string: 'A=', new_string: 'A=1' }]
  ]
  for (const [tool, input] of allowed) {
    const verdict = ask(tool, input)
    assert.equal(verdict.denied, false, `${tool} should be allowed: ${verdict.reason}`)
  }
})

test('a protection does not wait for a workflow to be active', () => {
  // No session state is written, so this is the cold-start case by construction.
  assert.equal(ask('Bash', { command: 'voidr deploy-latest' }).denied, true)
})
