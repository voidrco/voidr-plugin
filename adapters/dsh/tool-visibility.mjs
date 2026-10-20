import { memberToolVisible } from './echo-member-policy.mjs'
import { WIDGET_TOOLS, contextChannel } from './whatsapp-channel.mjs'
import { expandedDomains, initialToolDomains, profileToolVisible } from './tool-profiles.mjs'

const RESERVED = new Set(['run_code'])
const AUTHORING_TOOLS = new Set([
  'ask_user_question', 'render_widget', 'skill', 'read', 'todo_write',
  'mcp__voidr__files_analyze_uploaded_file',
  'mcp__voidr__echo_list_applications', 'mcp__voidr__echo_list_journey_plans',
  'mcp__voidr__echo_get_journey', 'mcp__voidr__echo_get_journey_flow',
  'mcp__voidr__echo_get_journey_draft',
  'mcp__voidr__echo_journeys_create_draft', 'mcp__voidr__echo_journeys_add_draft_sources',
  'mcp__voidr__echo_journeys_analyze_draft', 'mcp__voidr__echo_journeys_get_draft',
  'mcp__voidr__echo_journeys_list_drafts', 'mcp__voidr__echo_journeys_update_draft'
])

export function toolVisibilityFilter(names, { restricted, whatsapp, authoring, domains = null, development = false }) {
  const deny = names.filter(name => !RESERVED.has(name) &&
    ((restricted && !memberToolVisible(name)) || (whatsapp && WIDGET_TOOLS.has(name)) ||
      (authoring && !AUTHORING_TOOLS.has(name)) ||
      (!authoring && domains && !profileToolVisible(name, domains, { development }))))
  return deny.length ? { deny } : null
}

export function registerToolVisibility(ctx, isRestricted) {
  const masks = new Map()
  let refreshing = false
  // The plugin context sees the complete global registry. The agent view is
  // already masked and cannot be used to compute the next mask after expansion.
  const globalNames = () => ctx.tools.schemas().map(tool => tool.name).sort()
  const maskKey = (state, names) => `${state.restricted}|${state.whatsapp}|${state.authoring}|${state.development}|${state.domains?.join(',')}|${names.join(',')}`
  function install(agent, state) {
    masks.get(agent)?.dispose()
    masks.delete(agent)
    const names = globalNames()
    const filter = toolVisibilityFilter(names, state)
    const dispose = filter ? agent.ctx.tools.restrict(filter) : () => {}
    masks.set(agent, { dispose, key: maskKey(state, names) })
  }
  function refresh(agent) {
    if (!agent?.ctx?.tools || refreshing) return
    const hint = agent.session?.events.findLast(event => event.type === 'voidr/project-context-hint')?.data
    const initial = initialToolDomains(hint)
    const domains = initial ? [...new Set([...initial, ...expandedDomains(agent.session?.events)])].sort() : null
    const state = { restricted: isRestricted(agent), whatsapp: contextChannel(agent.session?.events) === 'whatsapp',
      authoring: hint?.surface === 'echo' && hint.intent === 'echo_journey_import',
      domains, development: hint?.surface !== 'slack' && hint?.surface !== 'teams' }
    const previous = masks.get(agent)
    if (!previous && !state.restricted && !state.whatsapp && !state.authoring && !domains) return
    if (previous?.key === maskKey(state, globalNames())) return
    refreshing = true
    try {
      install(agent, state)
    } catch (error) {
      ctx.logger?.warn('tool visibility mask was not applied', { agentId: agent.id, error: error instanceof Error ? error.message : String(error) })
    } finally {
      refreshing = false
    }
  }
  ctx.on('agent/created', ({ agent }) => refresh(agent), { global: true })
  ctx.on('agent/pre-step', async ({ agent }, next) => { refresh(agent); return next() })
  ctx.on('tools/change', () => { if (!refreshing) for (const agent of ctx.agents.list()) refresh(agent) })
  ctx.on('agent/disposed', ({ agent }) => { masks.delete(agent) }, { global: true })
  return { refresh }
}
