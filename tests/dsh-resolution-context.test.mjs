import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../adapters/dsh/index.mjs'

function harness() {
  const commands = new Map()
  const variables = new Map()
  const events = []
  apply({
    skills: { register() {} },
    systemPrompt: { section() {}, variable: (name, provider) => variables.set(name, provider) },
    commands: { register: command => commands.set(command.name, command) },
    tools: { register() {} }, on() {},
  })
  const agent = { id: 'resolution-test', session: { events, append: (type, data) => events.push({ type, data }) } }
  return { commands, variables, agent }
}

test('the connection survives the Service context command and reaches the model as a lookup hint', () => {
  const { commands, variables, agent } = harness()
  const hint = { surface: 'hero', assistantSessionId: 'case-session', connectorContextId: 'connection-2', admin: true }
  const result = commands.get('assistant-context').handler({ agent, rawInput: Buffer.from(JSON.stringify(hint)).toString('base64url') })
  assert.equal(result.kind, 'success')
  assert.equal(agent.session.events[0].data.connectorContextId, 'connection-2')
  assert.equal(agent.session.events[0].data.admin, undefined)
  const prompt = variables.get('voidr_interactive_test_development')({ agent })
  assert.match(prompt, /connection-2/)
  assert.match(prompt, /untrusted/i)
  assert.match(prompt, /authenticated organization/i)
  assert.deepEqual(globalThis[Symbol.for('voidr.dsh.litellm-contexts.v1')].get(agent.id), {
    surface: 'hero', action: 'voidr_dsh_issue_resolution'
  })
})

test('ticket investigation has a resolution contract without requiring an automation project', () => {
  const { commands, variables, agent } = harness()
  commands.get('assistant-context').handler({ agent, rawInput: Buffer.from(JSON.stringify({ surface: 'hero' })).toString('base64url') })
  const prompt = variables.get('voidr_interactive_test_development')({ agent })
  assert.match(prompt, /existing fixes/i)
  assert.match(prompt, /exact revision/i)
  assert.match(prompt, /assistant_workspace_checkout_product_repository/)
  assert.match(prompt, /Never request credential-bearing clone URLs/)
  assert.match(prompt, /assistant_workspace_publish_product_branch/)
  assert.match(prompt, /reviewed expectedTree/)
  assert.match(prompt, /without the automation session binding/)
  assert.match(prompt, /human effort/i)
  assert.match(prompt, /missing capability/i)
  assert.doesNotMatch(prompt, /APPLICATION AND TEST PLAN INTAKE|render app_registration|The persisted Test Plan binding is authoritative/)
})

test('home can enter the same resolution contract through an explicit intent', () => {
  const { commands, variables, agent } = harness()
  commands.get('assistant-context').handler({ agent, rawInput: Buffer.from(JSON.stringify({ surface: 'home', intent: 'issue_resolution' })).toString('base64url') })
  assert.match(variables.get('voidr_interactive_test_development')({ agent }), /existing fixes/i)
})

test('resuming a persisted resolution session restores spend attribution', () => {
  const { variables, agent } = harness()
  const key = Symbol.for('voidr.dsh.litellm-contexts.v1')
  globalThis[key] = new Map()
  agent.session.events.push({ type: 'voidr/project-context-hint', data: { surface: 'home', intent: 'issue_resolution' } })
  variables.get('voidr_interactive_test_development')({ agent })
  assert.deepEqual(globalThis[key].get(agent.id), { surface: 'home', action: 'voidr_dsh_issue_resolution' })
})
