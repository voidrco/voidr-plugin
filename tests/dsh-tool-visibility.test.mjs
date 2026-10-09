import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerToolVisibility, toolVisibilityFilter } from '../adapters/dsh/tool-visibility.mjs'

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
  const global = [...GLOBAL]
  const masks = []
  const restricted = new Set()
  const agent = { id: 'member', session: { events: [hint('whatsapp')] } }
  const visible = scope => [...global, ...(scope === agent ? PRESET : [])]
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

test('masks follow the agent view, including preset tools, and do not churn without changes', () => {
  const { hooks, global, masks, restricted, agent, visibility, visible } = setup()

  visibility.refresh(agent)
  visibility.refresh(agent)
  assert.equal(masks.length, 1)
  assert.deepEqual(masks[0].filter.deny, ['echo_render_deviations', 'render_widget'])

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

test('sessions outside WhatsApp with full access are never masked', () => {
  const { masks, agent, visibility } = setup()
  agent.session.events = [hint()]

  visibility.refresh(agent)

  assert.equal(masks.length, 0)
})
