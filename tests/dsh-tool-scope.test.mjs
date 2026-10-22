import assert from 'node:assert/strict'
import test from 'node:test'
import { apply } from '../adapters/dsh/index.mjs'

function setup(surface, intent) {
  const registered = new Map()
  const global = new Set([
    'mcp__voidr__playwright_get_execution_analytics',
    'mcp__voidr__preventive_monitor_get_radar_situation',
    'mcp__voidr__evidence_reports_get',
    'mcp__voidr__defects_create_defect',
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
      view() { return { restrictableNames: new Set(global) } },
    },
    agents: { list: () => [agent] },
    commands: { register() {} },
    skills: { register() {} },
    systemPrompt: { variable(name, value) { variables.set(name, value) }, section() {} },
    on(event, handler) { hooks.set(event, handler) },
  }
  apply(ctx)
  hooks.get('agent/created')({ agent })
  const visible = name => masks.every(mask => mask.disposed || !mask.filter.deny.includes(name))
  return { agent, registered, hooks, variables, visible }
}

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
  await hooks.get('agent/pre-step')({ agent }, () => {})
  assert.equal(visible(tool), false)
  await assert.rejects(expansion.execute({ toolName: 'missing_capability' }, { agent }),
    /not available/)
})

test('generic Slack explains how to reveal a capability on its first question', () => {
  const { agent, variables } = setup('slack')
  const prompt = variables.get('voidr_interactive_test_development')({ agent })
  assert.match(prompt, /including the first question in a generic Slack channel/)
})

test('Monitor reveals confirmed-action capabilities on demand and resets them on the next turn', async () => {
  const { agent, registered, hooks, visible } = setup('monitor')
  const tool = 'mcp__voidr__defects_create_defect'
  assert.equal(visible(tool), false)
  await registered.get('expand_tool_scope').execute({ domain: 'execution' }, { agent })
  assert.equal(visible(tool), true)
  agent.session.append('turn/start', { turn: 2 })
  await hooks.get('agent/pre-step')({ agent }, () => {})
  assert.equal(visible(tool), false)
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
