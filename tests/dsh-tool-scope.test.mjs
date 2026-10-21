import assert from 'node:assert/strict'
import test from 'node:test'
import { apply } from '../adapters/dsh/index.mjs'

function setup(surface, intent) {
  const registered = new Map()
  const global = new Set([
    'mcp__voidr__playwright_get_execution_analytics',
    'mcp__voidr__preventive_monitor_get_radar_situation',
    'mcp__voidr__evidence_reports_get',
    'mcp__voidr__echo_journeys_update_draft',
    'mcp__voidr__echo_journeys_publish_draft',
  ])
  const hooks = new Map()
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
      schemas() { return [...global].map(name => ({ name })) },
    },
    agents: { list: () => [agent] },
    commands: { register() {} },
    skills: { register() {} },
    systemPrompt: { variable() {}, section() {} },
    on(event, handler) { hooks.set(event, handler) },
  }
  apply(ctx)
  hooks.get('agent/created')({ agent })
  const visible = name => masks.every(mask => mask.disposed || !mask.filter.deny.includes(name))
  return { agent, registered, hooks, visible }
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

test('ordinary Echo keeps its catalog and does not opt into tool profiles', async () => {
  const { agent, registered, visible } = setup('echo')
  assert.equal(visible('mcp__voidr__playwright_get_execution_analytics'), true)
  assert.equal(visible('expand_tool_scope'), false)
  await assert.rejects(registered.get('expand_tool_scope').execute({ domain: 'execution' }, { agent }),
    /not available on Echo/)
})
