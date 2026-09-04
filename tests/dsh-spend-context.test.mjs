import assert from 'node:assert/strict'
import test from 'node:test'
import { apply } from '../adapters/dsh/index.mjs'

const key = Symbol.for('voidr.dsh.litellm-contexts.v1')

test('assistant context registers the DSH surface for spend attribution', () => {
  delete globalThis[key]
  let command
  const ctx = {
    commands: { register(value) { if (value.name === 'assistant-context') command = value } },
    skills: { register() {} },
    systemPrompt: { variable() {}, section() {} },
    tools: {},
    on() {}
  }
  apply(ctx)
  const session = { append() {} }
  const rawInput = Buffer.from(JSON.stringify({ surface: 'monitor' })).toString('base64url')
  command.handler({ agent: { id: 'session-1', session }, rawInput })
  assert.deepEqual(globalThis[key].get('session-1'), {
    surface: 'monitor', subaction: 'dsh-failure-analysis'
  })
  delete globalThis[key]
})
