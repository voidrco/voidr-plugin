import assert from 'node:assert/strict'
import test from 'node:test'
import { apply } from '../adapters/dsh/index.mjs'

function setup(surface, intent, options = {}) {
  const registered = new Map()
  const commands = new Map()
  const global = new Set([
    'load_capability_context',
    'mcp__voidr__playwright_get_execution_analytics',
    'mcp__voidr__preventive_monitor_get_radar_situation',
    'mcp__voidr__evidence_reports_get',
    'mcp__voidr__echo_journeys_update_draft',
    'mcp__voidr__echo_journeys_publish_draft',
  ])
  const hooks = new Map()
  const variables = new Map()
  const masks = []
  const session = {
    events: [{ type: 'voidr/project-context-hint', data: { surface, ...(intent ? { intent } : {}) } }],
    append(type, data) { this.events.push({ type, data }) },
  }
  const agent = { id: 'scope-test', session, ctx: { tools: {
    restrict(filter) {
      const mask = { filter, disposed: false }
      masks.push(mask)
      return () => { mask.disposed = true }
    },
  } } }
  const ctx = {
    tools: {
      register(tool) { registered.set(tool.name, tool); global.add(tool.name) },
      schemas() { return [...global].map(name => ({ name, description: '' })) },
      view(scope) { return { restrictableNames: new Set(global), visible: new Map(this.schemas(scope).map(tool => [tool.name, tool])) } },
    },
    agents: { list: () => [agent] },
    commands: { register(command) { commands.set(command.name, command) } },
    skills: { register() {} },
    systemPrompt: { variable(name, value) { variables.set(name, value) }, section() {} },
    on(event, handler, options) {
      const previous = hooks.get(event)
      if (event === 'agent/pre-step' && previous) {
        hooks.set(event, (payload, next) => options?.prepend
          ? handler(payload, () => previous(payload, next))
          : previous(payload, () => handler(payload, next)))
      } else hooks.set(event, handler)
    },
  }
  const adapter = apply(ctx, options)
  hooks.get('agent/created')({ agent })
  const visible = name => masks.every(mask => mask.disposed || !mask.filter.deny.includes(name))
  return { agent, registered, hooks, variables, visible, adapter, commands }
}

test('the Home context handshake requires a mounted central provider and suppresses legacy injection', () => {
  const rawInput = Buffer.from(JSON.stringify({ surface: 'home', contextVersion: 1, locale: 'en' })).toString('base64url')
  const legacy = setup('home')
  assert.equal(legacy.commands.get('assistant-context').handler({ agent: legacy.agent, rawInput }).kind, 'error')
  assert.equal(legacy.agent.session.events.length, 1)
  assert.equal(legacy.visible('load_capability_context'), false)
  const bound = []
  const central = setup('home', undefined, { assistantContextVersion: 1, bindHomeSkills: agent => bound.push(agent) })
  const result = central.commands.get('assistant-context').handler({ agent: central.agent, rawInput })
  assert.deepEqual(result, { kind: 'success', text: 'Assistant context registered: capabilities-v1' })
  assert.equal(central.variables.get('voidr_interactive_test_development')({ agent: central.agent }), '')
  assert.equal(central.agent.session.events.at(-1).data.locale, 'en')
  assert.equal(central.visible('load_capability_context'), true)
  assert.deepEqual(bound, [central.agent])
  const other = Buffer.from(JSON.stringify({ surface: 'echo' })).toString('base64url')
  central.commands.get('assistant-context').handler({ agent: central.agent, rawInput: other })
  assert.deepEqual(bound, [central.agent, central.agent])
})

test('Home does not infer complete tool profiles from legacy domain labels alone', async () => {
  let domains = []
  const { agent, visible, hooks, adapter } = setup('home', undefined, { assistantContextVersion: 1, capabilityDomains: () => domains })
  agent.session.events[0].data.contextVersion = 1
  const tool = 'mcp__voidr__evidence_reports_get'
  assert.equal(visible(tool), false)
  domains = ['reports']
  adapter.refreshToolVisibility(agent)
  assert.equal(visible(tool), false)
  agent.session.append('turn/start', { turn: 2 })
  await hooks.get('agent/pre-step')({ agent }, async () => ({ kind: 'enter', messages: [] }))
  assert.equal(visible(tool), false)
  domains = []
  adapter.refreshToolVisibility(agent)
  assert.equal(visible(tool), false)
})

test('Home combines complete profile tool sets and unloading one preserves the others', async () => {
  let selectors = []
  const { agent, visible, hooks, adapter } = setup('home', undefined,
    { assistantContextVersion: 1, profileTools: () => selectors })
  agent.session.events[0].data.contextVersion = 1
  const report = 'mcp__voidr__evidence_reports_get'
  const radar = 'mcp__voidr__preventive_monitor_get_radar_situation'
  assert.equal(visible(report), false)
  selectors = ['evidence_reports_', 'preventive_monitor_']
  adapter.refreshToolVisibility(agent)
  assert.equal(visible(report), true)
  assert.equal(visible(radar), true)
  agent.session.append('turn/start', { turn: 2 })
  await hooks.get('agent/pre-step')({ agent }, async () => ({ kind: 'enter', messages: [] }))
  assert.equal(visible(report), true)
  assert.equal(visible(radar), true)
  selectors = ['preventive_monitor_']
  adapter.refreshToolVisibility(agent)
  assert.equal(visible(report), false)
  assert.equal(visible(radar), true)
})

test('Home retains exact tools across turns and restoration until an explicit reset', async () => {
  const options = { assistantContextVersion: 1 }
  const { agent, visible, registered, hooks, adapter } = setup('home', undefined, options)
  agent.session.events[0].data.contextVersion = 1
  adapter.refreshToolVisibility(agent)
  const expansion = registered.get('expand_tool_scope')
  const tool = 'mcp__voidr__evidence_reports_get'
  assert.equal(visible(tool), false)
  await expansion.execute({ toolName: 'evidence_reports_get' }, { agent })
  assert.equal(visible(tool), true)
  agent.session.append('turn/start', { turn: 2 })
  await hooks.get('agent/pre-step')({ agent }, async () => ({ kind: 'enter', messages: [] }))
  assert.equal(visible(tool), true)
  const restored = setup('home', undefined, options)
  restored.agent.session.events = structuredClone(agent.session.events)
  restored.adapter.refreshToolVisibility(restored.agent)
  assert.equal(restored.visible(tool), true)
  const reset = await expansion.execute({ reset: true }, { agent })
  assert.deepEqual(reset, { activeDomains: [], activeTools: [] })
  assert.equal(visible(tool), false)
})

test('only central Home accepts persistent scope reset', async () => {
  const { agent, registered } = setup('monitor')
  await assert.rejects(registered.get('expand_tool_scope').execute({ reset: true }, { agent }),
    /requires central Home/)
})

test('Monitor begins with failure tools and reveals a named report tool for one turn', async () => {
  const { agent, registered, hooks, visible } = setup('monitor')
  const tool = 'mcp__voidr__evidence_reports_get'
  assert.equal(visible('mcp__voidr__playwright_get_execution_analytics'), true)
  assert.equal(visible(tool), false)
  const expansion = registered.get('expand_tool_scope')
  const result = await expansion.execute({ toolName: 'evidence_reports_get' }, { agent })
  assert.deepEqual(result.activeTools, [tool])
  assert.equal(visible(tool), true)
  agent.session.append('turn/start', { turn: 2 })
  await hooks.get('agent/pre-step')({ agent }, async () => ({ kind: 'enter', messages: [] }))
  assert.equal(visible(tool), false)
  await assert.rejects(expansion.execute({ toolName: 'missing_capability' }, { agent }),
    /not available/)
})

test('generic Slack explains how to reveal a capability on its first question', () => {
  const { agent, variables } = setup('slack')
  const prompt = variables.get('voidr_interactive_test_development')({ agent })
  assert.match(prompt, /including the first question in a generic Slack channel/)
})

test('Echo Journey Studio keeps production authoring restrictions', async () => {
  const { agent, registered, visible } = setup('echo', 'echo_journey_import')
  assert.equal(visible('mcp__voidr__echo_journeys_update_draft'), true)
  assert.equal(visible('mcp__voidr__playwright_get_execution_analytics'), false)
  const expansion = registered.get('expand_tool_scope')
  assert.equal(visible('expand_tool_scope'), false)
  await assert.rejects(expansion.execute({ domain: 'execution' }, { agent }), /not available on Echo/)
  assert.equal(visible('mcp__voidr__playwright_get_execution_analytics'), false)
  assert.equal(visible('mcp__voidr__echo_journeys_publish_draft'), false)
})

test('ordinary Echo keeps mainline discovery and does not opt into DSH profiles', async () => {
  const { agent, registered, variables, visible } = setup('echo')
  assert.equal(visible('echo_discover_tools'), true)
  assert.equal(visible('mcp__voidr__playwright_get_execution_analytics'), false)
  assert.equal(visible('expand_tool_scope'), false)
  const prompt = variables.get('voidr_interactive_test_development')({ agent })
  assert.doesNotMatch(prompt, /active surface exposes a small initial tool profile/)
  assert.doesNotMatch(prompt, /For an organization MCP connector, keep discovery small/)
  await assert.rejects(registered.get('expand_tool_scope').execute({ domain: 'execution' }, { agent }),
    /not available on Echo/)
  const discovered = registered.get('echo_discover_tools').execute({ query: 'playwright_get_execution_analytics' }, { agent })
  assert.deepEqual(discovered.tools.map(tool => tool.name), ['mcp__voidr__playwright_get_execution_analytics'])
  assert.equal(visible('mcp__voidr__playwright_get_execution_analytics'), true)
})
