import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerToolVisibility, toolVisibilityFilter } from '../adapters/dsh/tool-visibility.mjs'
import { TOOL_SCOPE_EVENT, initialToolDomains } from '../adapters/dsh/tool-profiles.mjs'

const GLOBAL = [
  'bash', 'write', 'render_widget', 'run_code', 'echo_render_deviations', 'echo_propose_overview_change',
  'mcp__voidr__echo_get_overview_view', 'mcp__voidr__echo_share_overview',
  'mcp__voidr__files_analyze_uploaded_file', 'mcp__voidr__list_applications'
]
const PRESET = ['read', 'ask_user_question', 'skill', 'todo_write', 'edit']
const hint = channel => ({ type: 'voidr/project-context-hint', data: { surface: 'echo', ...(channel ? { channel } : {}) } })

test('restricted members lose every tool they cannot call, WhatsApp loses widgets', () => {
  const names = [...GLOBAL, ...PRESET]

  assert.deepEqual(toolVisibilityFilter(names, { restricted: true, whatsapp: false }), {
    deny: ['bash', 'write', 'mcp__voidr__list_applications', 'edit']
  })
  assert.deepEqual(toolVisibilityFilter(names, { restricted: false, whatsapp: true }), {
    deny: ['render_widget', 'echo_render_deviations']
  })
  assert.deepEqual(toolVisibilityFilter(names, { restricted: true, whatsapp: true }).deny, [
    'bash', 'write', 'render_widget', 'echo_render_deviations', 'mcp__voidr__list_applications', 'edit'
  ])
  assert.equal(toolVisibilityFilter(names, { restricted: false, whatsapp: false }), null)
})

function setup() {
  const hooks = new Map()
  const global = [...GLOBAL, ...PRESET]
  const masks = []
  const restricted = new Set()
  const agent = { id: 'member', session: { events: [hint('whatsapp')] } }
  const visible = scope => [...global]
    .filter(name => scope !== agent || masks.every(mask => mask.disposed || !mask.filter.deny.includes(name)))
  agent.ctx = { tools: { restrict: filter => { const mask = { filter, disposed: false }; masks.push(mask); return () => { mask.disposed = true } } } }
  const ctx = {
    on: (event, fn) => hooks.set(event, fn),
    tools: { schemas: scope => visible(scope).map(name => ({ name })) },
    agents: { list: () => [agent] }
  }
  const visibility = registerToolVisibility(ctx, value => restricted.has(value.id))
  return { hooks, global, masks, restricted, agent, visibility, visible }
}

test('masks follow the global registry and do not churn without changes', () => {
  const { hooks, global, masks, restricted, agent, visibility, visible } = setup()

  visibility.refresh(agent)
  visibility.refresh(agent)
  assert.equal(masks.length, 1)
  assert.deepEqual(masks[0].filter.deny, ['echo_render_deviations', 'mcp__voidr__list_applications', 'render_widget'])

  restricted.add('member')
  visibility.refresh(agent)
  assert.equal(masks[0].disposed, true)
  assert.deepEqual(visible(agent).sort(), [
    'ask_user_question', 'echo_propose_overview_change', 'mcp__voidr__echo_get_overview_view',
    'mcp__voidr__echo_share_overview', 'mcp__voidr__files_analyze_uploaded_file', 'read', 'run_code', 'skill', 'todo_write'
  ])

  global.push('mcp__voidr__echo_get_session', 'mcp__voidr__sessions_list')
  hooks.get('tools/change')()
  assert.equal(visible(agent).includes('mcp__voidr__echo_get_session'), true)
  assert.equal(visible(agent).includes('mcp__voidr__sessions_list'), false)
  const installed = masks.length
  hooks.get('tools/change')()
  assert.equal(masks.length, installed)

  restricted.delete('member')
  agent.session.events.push(hint())
  visibility.refresh(agent)
  assert.equal(visible(agent).includes('bash'), true)
  assert.equal(visible(agent).includes('render_widget'), true)
})

test('ordinary Echo sessions use the Echo profile', () => {
  const { masks, agent, visibility } = setup()
  agent.session.events = [hint()]

  visibility.refresh(agent)

  assert.equal(masks.length, 1)
  assert.ok(masks[0].filter.deny.includes('mcp__voidr__list_applications'))
  assert.ok(!masks[0].filter.deny.includes('mcp__voidr__echo_get_overview_view'))
})

test('a mask the runtime rejects never fails the conversation', () => {
  const { agent, visibility } = setup()
  agent.ctx.tools.restrict = () => { throw new Error('tools.restrict() names unknown global tool') }

  assert.doesNotThrow(() => visibility.refresh(agent))
})

test('Radar, tickets and generic contexts expose different small catalogs', () => {
  const names = [
    'mcp__voidr__preventive_monitor_get_radar_situation',
    'mcp__voidr__preventive_monitor_diagnose_radar_situation',
    'mcp__voidr__custom_connectors_read_mcp_tool',
    'mcp__voidr__custom_connectors_zendesk_evidence',
    'mcp__voidr__source_control_search_code',
    'mcp__voidr__test_plans_list_test_plans',
    'mcp__voidr__knowledge_search',
    'mcp__voidr__system_search_tools',
    'expand_tool_scope', 'bash'
  ]
  const radar = toolVisibilityFilter(names, { domains: initialToolDomains({ surface: 'slack', radarSituationId: 'case' }) }).deny
  assert.ok(!radar.includes('mcp__voidr__preventive_monitor_get_radar_situation'))
  assert.ok(!radar.includes('mcp__voidr__custom_connectors_read_mcp_tool'))
  assert.ok(radar.includes('mcp__voidr__custom_connectors_zendesk_evidence'))
  assert.ok(radar.includes('mcp__voidr__preventive_monitor_diagnose_radar_situation'))
  assert.ok(radar.includes('bash'))
  const tickets = toolVisibilityFilter(names, { domains: ['tickets'] }).deny
  assert.ok(!tickets.includes('mcp__voidr__custom_connectors_zendesk_evidence'))
  assert.ok(tickets.includes('mcp__voidr__custom_connectors_read_mcp_tool'))
  const generic = toolVisibilityFilter(names, { domains: initialToolDomains(null), development: true }).deny
  assert.ok(!generic.includes('mcp__voidr__knowledge_search'))
  assert.ok(!generic.includes('bash'))
  assert.ok(generic.includes('mcp__voidr__test_plans_list_test_plans'))
})

test('expanding a domain refreshes from the unmasked global catalog', () => {
  const { agent, visibility, visible, hooks } = setup()
  agent.session.events = [{ type: 'voidr/project-context-hint', data: { surface: 'slack', radarSituationId: 'case' } }]
  visibility.refresh(agent)
  assert.equal(visible(agent).includes('mcp__voidr__echo_get_overview_view'), false)
  agent.session.events.push({ type: TOOL_SCOPE_EVENT, data: { domain: 'echo' } })
  visibility.refresh(agent)
  assert.equal(visible(agent).includes('mcp__voidr__echo_get_overview_view'), true)
  assert.equal(visible(agent).includes('mcp__voidr__list_applications'), false)
  agent.session.events.push({ type: 'turn/start', data: { turn: 2 } })
  return hooks.get('agent/pre-step')({ agent }, () => {
    assert.equal(visible(agent).includes('mcp__voidr__echo_get_overview_view'), false)
  })
})
