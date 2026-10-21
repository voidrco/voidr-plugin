import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerToolVisibility, toolVisibilityFilter } from '../adapters/dsh/tool-visibility.mjs'
import { TOOL_SCOPE_EVENT, expandedToolNames, initialToolDomains, profileToolVisible } from '../adapters/dsh/tool-profiles.mjs'

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
  assert.ok(!radar.includes('mcp__voidr__preventive_monitor_diagnose_radar_situation'))
  assert.ok(radar.includes('bash'))
  const tickets = toolVisibilityFilter(names, { domains: ['tickets'] }).deny
  assert.ok(!tickets.includes('mcp__voidr__custom_connectors_zendesk_evidence'))
  assert.ok(tickets.includes('mcp__voidr__custom_connectors_read_mcp_tool'))
  const generic = toolVisibilityFilter(names, { domains: initialToolDomains(null), development: true }).deny
  assert.ok(!generic.includes('mcp__voidr__knowledge_search'))
  assert.ok(!generic.includes('bash'))
  assert.ok(generic.includes('mcp__voidr__test_plans_list_test_plans'))
})

test('each surface starts with the evidence tools used by its primary skill', () => {
  const names = [
    'mcp__voidr__playwright_get_execution_analytics',
    'mcp__voidr__defects_create_defect',
    'mcp__voidr__test_plans_update_test_case_tag',
    'mcp__voidr__preventive_monitor_get_radar_situation',
    'mcp__voidr__sessions_get_session_action_effects',
    'mcp__voidr__sessions_get_session_screenmap',
    'mcp__voidr__file_embeddings_search_documents',
    'mcp__voidr__evidence_reports_create'
  ]
  const visible = hint => names.filter(name =>
    !toolVisibilityFilter(names, { domains: initialToolDomains(hint) })?.deny.includes(name))
  assert.ok(visible({ surface: 'monitor' }).includes('mcp__voidr__playwright_get_execution_analytics'))
  assert.ok(visible({ surface: 'monitor' }).includes('mcp__voidr__defects_create_defect'))
  assert.ok(visible({ surface: 'monitor' }).includes('mcp__voidr__test_plans_update_test_case_tag'))
  assert.ok(!visible({ surface: 'monitor' }).includes('mcp__voidr__preventive_monitor_get_radar_situation'))
  assert.ok(visible({ surface: 'preventive-monitor' }).includes('mcp__voidr__preventive_monitor_get_radar_situation'))
  for (const surface of ['spec', 'journeys', 'journey-overview']) {
    const tools = visible({ surface })
    assert.ok(tools.includes('mcp__voidr__sessions_get_session_action_effects'))
    assert.ok(tools.includes('mcp__voidr__sessions_get_session_screenmap'))
    assert.ok(tools.includes('mcp__voidr__file_embeddings_search_documents'))
  }
  assert.ok(!visible({ surface: 'spec' }).includes('mcp__voidr__evidence_reports_create'))
})

test('every profiled surface retains its primary capability and resets an explicit switch next turn', () => {
  const cases = [
    [{ surface: 'home' }, 'ontology_search_entities'],
    [{ surface: 'context-graph' }, 'knowledge_search'],
    [{ surface: 'spec' }, 'sessions_get_session_action_effects'],
    [{ surface: 'journeys' }, 'file_embeddings_search_documents'],
    [{ surface: 'journey-overview' }, 'sessions_get_session_digest'],
    [{ surface: 'automate' }, 'assistant_workspace_prepare'],
    [{ surface: 'performance' }, 'performance_list_plans'],
    [{ surface: 'monitor' }, 'playwright_get_execution_analytics'],
    [{ surface: 'preventive-monitor' }, 'preventive_monitor_get_radar_situation'],
    [{ surface: 'echo' }, 'echo_get_overview_view'],
    [{ surface: 'echo', intent: 'echo_journey_import' }, 'echo_journeys_update_draft'],
    [{ surface: 'voidr-gate' }, 'source_control_search_code'],
    [{ surface: 'teams' }, 'ontology_search_entities'],
    [{ surface: 'third-party-management' }, 'third_party_list'],
    [{ surface: 'slack', radarSituationId: 'case' }, 'preventive_monitor_get_radar_situation'],
    [{ surface: 'slack' }, 'knowledge_search'],
  ]
  const foreign = 'mcp__voidr__evidence_reports_get'
  for (const [hint, primary] of cases) {
    const initial = initialToolDomains(hint)
    assert.ok(profileToolVisible(`mcp__voidr__${primary}`, initial, {
      authoring: hint.intent === 'echo_journey_import',
    }), `${hint.surface}: primary tool missing`)
    assert.equal(profileToolVisible(foreign, initial), false, `${hint.surface}: foreign tool initially visible`)
    const events = [{ type: 'voidr/project-context-hint', data: hint },
      { type: TOOL_SCOPE_EVENT, data: { toolName: foreign } }]
    assert.equal(profileToolVisible(foreign, initial, { extraTools: expandedToolNames(events) }), true)
    events.push({ type: 'turn/start', data: { turn: 2 } })
    assert.equal(profileToolVisible(foreign, initial, { extraTools: expandedToolNames(events) }), false)
  }
})

test('explicit tools outside every domain can be revealed without opening the full catalog', () => {
  const names = ['mcp__voidr__evidence_reports_create', 'mcp__voidr__sessions_get_session_action_effects',
    'mcp__voidr__unmapped_future_capability']
  const initial = initialToolDomains({ surface: 'slack', radarSituationId: 'case' })
  const before = toolVisibilityFilter(names, { domains: initial }).deny
  assert.ok(before.includes('mcp__voidr__unmapped_future_capability'))
  const after = toolVisibilityFilter(names, { domains: initial,
    extraTools: ['mcp__voidr__unmapped_future_capability'] }).deny
  assert.ok(!after.includes('mcp__voidr__unmapped_future_capability'))
  assert.ok(after.includes('mcp__voidr__sessions_get_session_action_effects'))
  assert.ok(!toolVisibilityFilter(names, { domains: [...initial, 'reports'] }).deny
    .includes('mcp__voidr__evidence_reports_create'))
})

test('Echo Journey Studio keeps draft tools and can switch to an authorized domain', () => {
  const hint = { surface: 'echo', intent: 'echo_journey_import' }
  const names = ['expand_tool_scope', 'mcp__voidr__echo_journeys_update_draft',
    'mcp__voidr__playwright_get_execution_analytics', 'mcp__voidr__echo_journeys_publish_draft',
    'mcp__voidr__system_call_tool', 'bash']
  const initial = initialToolDomains(hint)
  assert.deepEqual(initial, ['echo-authoring'])
  const before = toolVisibilityFilter(names, { authoring: true, domains: initial }).deny
  assert.ok(!before.includes('expand_tool_scope'))
  assert.ok(!before.includes('mcp__voidr__echo_journeys_update_draft'))
  assert.ok(before.includes('mcp__voidr__playwright_get_execution_analytics'))
  assert.ok(before.includes('mcp__voidr__system_call_tool'))
  assert.ok(before.includes('bash'))
  const after = toolVisibilityFilter(names, { authoring: true, domains: [...initial, 'execution'] }).deny
  assert.ok(!after.includes('mcp__voidr__playwright_get_execution_analytics'))
  assert.ok(after.includes('mcp__voidr__echo_journeys_publish_draft'))
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

test('an exact tool revealed for one turn disappears on the next turn', () => {
  const { agent, visibility, visible, hooks, global } = setup()
  const tool = 'mcp__voidr__evidence_reports_get'
  global.push(tool)
  agent.session.events = [{ type: 'voidr/project-context-hint', data: { surface: 'spec' } }]
  visibility.refresh(agent)
  assert.equal(visible(agent).includes(tool), false)
  agent.session.events.push({ type: TOOL_SCOPE_EVENT, data: { toolName: tool } })
  visibility.refresh(agent)
  assert.deepEqual(expandedToolNames(agent.session.events), [tool])
  assert.equal(visible(agent).includes(tool), true)
  agent.session.events.push({ type: 'turn/start', data: { turn: 2 } })
  return hooks.get('agent/pre-step')({ agent }, () => {
    assert.equal(visible(agent).includes(tool), false)
    assert.deepEqual(expandedToolNames(agent.session.events), [])
  })
})
