import { memberToolVisible } from './echo-member-policy.mjs'
import { WIDGET_TOOLS, contextChannel } from './whatsapp-channel.mjs'
import { expandedDomains, expandedToolNames, initialToolDomains, profileToolVisible } from './tool-profiles.mjs'

const RESERVED = new Set(['run_code'])
const ECHO_CORE_TOOLS = new Set([
  'ask_user_question', 'render_widget', 'skill', 'read', 'todo_write', 'echo_discover_tools',
  'inspect_session_images', 'materialize_session_image',
  'mcp__voidr__echo_get_ontology', 'mcp__voidr__echo_list_applications',
  'mcp__voidr__echo_list_journey_plans', 'mcp__voidr__echo_list_journeys',
  'mcp__voidr__echo_resolve_analysis_window', 'mcp__voidr__echo_analyze_session_cohort',
  'mcp__voidr__echo_analyze_scenario_groups', 'mcp__voidr__echo_analyze_judge_criterion',
  'mcp__voidr__echo_list_sessions', 'mcp__voidr__echo_get_session',
  'mcp__voidr__echo_get_session_evaluation', 'mcp__voidr__echo_read_evidence',
  'mcp__voidr__echo_list_defects', 'mcp__voidr__echo_get_defect',
  'mcp__voidr__echo_get_overview', 'mcp__voidr__echo_get_deviation_summary',
  'mcp__voidr__echo_compare_periods', 'echo_render_deviations',
  'echo_render_regulatory_controls', 'echo_render_deviation_group'
])
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

export function toolVisibilityFilter(names, { restricted, whatsapp, authoring, echo, discovered = new Set(),
  domains = null, development = false, extraTools = [] }) {
  const deny = names.filter(name => !RESERVED.has(name) &&
    ((restricted && !memberToolVisible(name)) || (whatsapp && WIDGET_TOOLS.has(name)) ||
      (authoring && !AUTHORING_TOOLS.has(name)) ||
      (echo && !ECHO_CORE_TOOLS.has(name) && !name.startsWith('mcp__voidr__artifacts_') && !discovered.has(name)) ||
      (domains && !profileToolVisible(name, domains, { development, extraTools }))))
  return deny.length ? { deny } : null
}

export function registerToolVisibility(ctx, isRestricted) {
  const masks = new Map()
  const discoveries = new Map()
  let refreshing = false
  // The unmasked registry lets a scope expansion reveal a tool hidden by the
  // previous mask. Agent schemas are read only after disposing that mask.
  const globalNames = () => ctx.tools.schemas().map(tool => tool.name).sort()
  const visibleNames = agent => ctx.tools.schemas(agent).map(tool => tool.name).sort()
  const maskKey = (state, names) => `${state.restricted}|${state.whatsapp}|${state.authoring}|${state.echo}|${state.development}|${state.domains?.join(',')}|${state.extraTools.join(',')}|${[...state.discovered].sort().join(',')}|${names.join(',')}`
  function install(agent, state, key) {
    masks.get(agent)?.dispose()
    masks.delete(agent)
    const restrictable = ctx.tools.view(agent).restrictableNames
    const filter = toolVisibilityFilter(visibleNames(agent).filter(name => restrictable.has(name)), state)
    const dispose = filter ? agent.ctx.tools.restrict(filter) : () => {}
    masks.set(agent, { dispose, key })
  }
  function refresh(agent, force = false) {
    if (!agent?.ctx?.tools || refreshing) return
    const hint = agent.session?.events.findLast(event => event.type === 'voidr/project-context-hint')?.data
    const echoSurface = hint?.surface === 'echo'
    const initial = echoSurface ? null : initialToolDomains(hint)
    const domains = initial ? [...new Set([...initial, ...expandedDomains(agent.session?.events)])].sort() : null
    const state = { restricted: isRestricted(agent), whatsapp: contextChannel(agent.session?.events) === 'whatsapp',
      authoring: echoSurface && hint.intent === 'echo_journey_import',
      echo: echoSurface && hint.intent !== 'echo_journey_import',
      discovered: discoveries.get(agent.id) ?? new Set(), domains,
      extraTools: echoSurface ? [] : [...new Set(expandedToolNames(agent.session?.events))].sort(),
      development: hint?.surface !== 'slack' && hint?.surface !== 'teams' &&
        (hint?.surface !== 'monitor' || domains?.includes('authoring')) }
    const previous = masks.get(agent)
    if (!previous && !state.restricted && !state.whatsapp && !state.authoring && !state.echo && !domains) return
    const key = maskKey(state, globalNames())
    if (!force && previous?.key === key) return
    refreshing = true
    try {
      install(agent, state, key)
    } catch (error) {
      ctx.logger?.warn('tool visibility mask was not applied', { agentId: agent.id, error: error instanceof Error ? error.message : String(error) })
    } finally {
      refreshing = false
    }
  }
  ctx.tools.register({
    name: 'echo_discover_tools',
    description: 'Discover additional authorized capabilities and load their exact native schemas for the next step. Use a short task description or exact tool name. Existing permissions still apply.',
    parameters: { type: 'object', additionalProperties: false, properties: {
      query: { type: 'string', minLength: 1, maxLength: 240 }, limit: { type: 'integer', minimum: 1, maximum: 8, default: 4 }
    }, required: ['query'] },
    output: { schema: { type: 'object', properties: { tools: { type: 'array', items: {} } }, required: ['tools'] },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: (args, { agent }) => {
      if (typeof args.query !== 'string' || !args.query.trim() || args.query.length > 240 ||
        !Number.isInteger(args.limit ?? 4) || (args.limit ?? 4) < 1 || (args.limit ?? 4) > 8) throw new Error('Use a query and an integer limit from 1 to 8')
      refreshing = true
      try {
        masks.get(agent)?.dispose()
        masks.delete(agent)
        const terms = args.query.toLowerCase().split(/[^\p{L}\p{N}_]+/u).filter(Boolean)
        const tools = ctx.tools.schemas(agent).filter(tool => tool.name !== 'echo_discover_tools')
          .map(tool => ({ tool, score: terms.reduce((score, term) => score + (tool.name.toLowerCase().includes(term) ? 10 :
            tool.description.toLowerCase().includes(term) ? 1 : 0), 0) }))
          .filter(match => match.score > 0 && (!isRestricted(agent) || memberToolVisible(match.tool.name)) &&
            (contextChannel(agent.session?.events) !== 'whatsapp' || !WIDGET_TOOLS.has(match.tool.name)))
          .sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name)).slice(0, args.limit ?? 4).map(match => match.tool)
        discoveries.set(agent.id, new Set([...(discoveries.get(agent.id) ?? []), ...tools.map(tool => tool.name)]))
        return { tools }
      } finally { refreshing = false; refresh(agent) }
    }
  })
  ctx.on('agent/created', ({ agent }) => refresh(agent), { global: true })
  ctx.on('agent/pre-step', async ({ agent }, next) => { refresh(agent); return next() })
  ctx.on('tools/change', () => { if (!refreshing) for (const agent of ctx.agents.list()) refresh(agent, true) })
  ctx.on('agent/disposed', ({ agent }) => { masks.delete(agent); discoveries.delete(agent.id) }, { global: true })
  return { refresh }
}
