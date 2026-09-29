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
    tools: { register() {} },
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
    tools: { register() {} },
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

test('context graph keeps its bounded anchor and generalist mission without a dedicated skill', () => {
  delete globalThis[key]
  let command
  let prompt
  const ctx = {
    commands: { register(value) { if (value.name === 'assistant-context') command = value } },
    skills: { register() {} },
    systemPrompt: { variable(name, value) { if (name === 'voidr_interactive_test_development') prompt = value }, section() {} },
    tools: { register() {} },
    on() {}
  }
  apply(ctx)
  let event
  const session = { append(type, data) { event = { type, data } } }
  const rawInput = Buffer.from(JSON.stringify({
    surface: 'context-graph', applicationId: 'app-1', signature: 'test.js:42|TimeoutError',
    causalChain: { anchorType: 'signature', anchorId: 'test.js:42|TimeoutError', executionCode: 'EXEC-950573', defectCodes: ['DEF-404'] }
  })).toString('base64url')
  command.handler({ agent: { id: 'session-graph', session }, rawInput })
  assert.equal(event.data.signature, 'test.js:42|TimeoutError')
  assert.equal(event.data.causalChain.executionCode, 'EXEC-950573')
  assert.deepEqual(globalThis[key].get('session-graph'), { surface: 'context-graph', action: 'voidr_dsh_general' })
  assert.match(prompt({ agent: { session: { events: [event] } } }), /The user opened a causal context graph/)
  assert.doesNotMatch(prompt({ agent: { session: { events: [event] } } }), /Active surface skill:/)
  delete globalThis[key]
})
