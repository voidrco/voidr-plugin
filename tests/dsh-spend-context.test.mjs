import assert from 'node:assert/strict'
import test from 'node:test'
import { apply } from '../adapters/dsh/index.mjs'

const key = Symbol.for('voidr.dsh.litellm-contexts.v1')

test('assistant context registers the DSH feature and surface for spend attribution', () => {
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
    surface: 'monitor', action: 'voidr_dsh_failure_analysis'
  })
  delete globalThis[key]
})

test('assistant intent overrides the surface default feature', () => {
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
  const rawInput = Buffer.from(JSON.stringify({
    surface: 'home', intent: 'journey_spec_generation'
  })).toString('base64url')
  command.handler({ agent: { id: 'session-2', session }, rawInput })
  assert.deepEqual(globalThis[key].get('session-2'), {
    surface: 'home', action: 'voidr_dsh_spec'
  })
  delete globalThis[key]
})
