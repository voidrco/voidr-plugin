import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerEchoActor } from '../adapters/dsh/echo-actor.mjs'
import { interactiveTestDevelopmentPrompt } from '../core/workflow/interactive-test-development.mjs'
import { loadDshPluginSkills } from '../adapters/dsh/plugin-skills.mjs'
import { apply } from '../adapters/dsh/index.mjs'

test('Echo calls keep the signed actor isolated per session and expire on disposal', async () => {
  const hooks = new Map()
  const calls = []
  let command
  const ctx = { on: (event, fn) => hooks.set(event, fn),
    commands: { register: definition => { command = definition } }, tools: { register(definition) {
      assert.equal(typeof definition.output.render, 'function')
      assert.equal(definition.output.schema.type, 'object')
    } } }
  registerEchoActor(ctx, {
    env: { DSH_VOIDR_MCP_URL: 'http://localhost:3000/v1/mcp', DSH_VOIDR_MCP_AUTHORIZATION: 'Basic test' },
    fetchImpl: async (url, init) => {
      calls.push({ url, ...init })
      return { ok: true, json: async () => url.endsWith('/tools/list')
        ? { tools: [{ name: 'echo_get_session', description: 'Read', inputSchema: { type: 'object' } }] }
        : { content: [{ type: 'text', text: 'evidence' }] } }
    }
  })
  const agent = id => ({ id, session: { events: [{ type: 'voidr/project-context-hint', data: { surface: 'echo' } }] } })
  const first = agent('one')
  const second = agent('two')
  await command.handler({ agent: first, rawInput: 'signed-one' })
  await command.handler({ agent: second, rawInput: 'signed-two' })
  const execute = hooks.get('tools/execute')
  const invoke = current => execute({ name: 'mcp__voidr__echo_get_session', agent: current, arguments: { sessionId: 's' } },
    () => { throw new Error('must use actor transport') })
  const results = await Promise.all([invoke(first), invoke(second)])
  assert.deepEqual(results[0].value.content, [{ type: 'text', text: 'evidence' }])
  assert.deepEqual(JSON.parse(calls.find(call => call.body).body).arguments, { sessionId: 's' })
  assert.deepEqual(calls.filter(call => call.body).map(call => call.headers['x-voidr-session']), ['signed-one', 'signed-two'])
  assert.equal(command.recordInput, false)
  hooks.get('agent/disposed')({ agent: first })
  await assert.rejects(invoke(first), /authorization required/)
})

test('Echo loads its own evidence and confirmation policy instead of web authoring', () => {
  const prompt = interactiveTestDevelopmentPrompt({ hint: { surface: 'echo', echoContext: { echoScreen: 'deviations' } } })
  assert.match(prompt, /deviations/)
  assert.doesNotMatch(prompt, /AUTHORING OWNERSHIP/)
  const skill = loadDshPluginSkills().find(item => item.name === 'voidr-echo-analysis')
  assert.match(skill.content, /mcp__voidr__echo_get_ontology/)
  assert.match(skill.content, /confirmation turn/)
  assert.match(skill.content, /`echo_execution_confirmation`/)
  assert.doesNotMatch(skill.content, /mcp__voidr__echo_execution_confirmation/)
})

test('Echo completes read-only reports without empty selection probes', () => {
  const skill = loadDshPluginSkills().find(item => item.name === 'voidr-echo-analysis')
  assert.match(skill.content, /at most 20 evidence rows/)
  assert.match(skill.content, /Never switch it to `multi_select`/)
  assert.match(skill.content, /at most one smaller corrected attempt/)
  assert.match(skill.content, /continue the remaining report in Markdown/)
  assert.match(skill.content, /A rendering failure is not missing user input/)
  assert.match(skill.content, /never claim all results\s+are visible when they are not/)
})

test('Echo renders the latest selected period with an explicit query and answer contract', () => {
  const variables = new Map()
  apply({
    on() {}, commands: { register() {} }, tools: { register() {} }, skills: { register() {} },
    systemPrompt: { variable: (name, render) => variables.set(name, render), section() {} }
  })
  const render = variables.get('voidr_interactive_test_development')
  const events = []
  const context = { agent: { session: { events } } }
  const select = window => events.push({ type: 'voidr/project-context-hint', data: {
    surface: 'echo', echoContext: { echoScreen: 'overview', ...(window ? { window } : {}) }
  } })
  select('7d')
  select('14d')
  const prompt = render(context)
  assert.match(prompt, /"echoContext":\{"echoScreen":"overview","window":"14d"\}/)
  assert.doesNotMatch(prompt, /"window":"7d"/)
  assert.match(prompt, /requires `window: "14d"`/)
  assert.match(prompt, /mcp__voidr__echo_get_overview/)
  assert.match(prompt, /mcp__voidr__echo_get_deviation_summary/)
  assert.match(prompt, /same resolved interval/)
  assert.match(prompt, /complete response for `7d` does not answer a\s+selected `14d`/)
  assert.match(prompt, /explicit\s+composer or custom-form period wins/)
  assert.match(prompt, /Never widen the period after a valid empty result/)
  assert.match(prompt, /Nos últimos 14 dias/)
  assert.match(prompt, /all-time inventory\s+separately/)
  select('30d')
  assert.match(render(context), /"window":"30d"/)
  assert.doesNotMatch(render(context), /"window":"14d"/)
  select()
  assert.doesNotMatch(render(context), /"window":"30d"/)
  assert.match(render(context), /neither the user nor current context supplies a period/)
  assert.match(render(context), /specifically\s+requested session or static configuration/)
})
