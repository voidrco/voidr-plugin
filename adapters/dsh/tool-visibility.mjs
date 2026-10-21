import { memberToolVisible } from './echo-member-policy.mjs'
import { WIDGET_TOOLS, contextChannel } from './whatsapp-channel.mjs'
import { expandedDomains, expandedToolNames, initialToolDomains, profileToolVisible } from './tool-profiles.mjs'

const RESERVED = new Set(['run_code'])
// Publishing and running a Studio draft remain actions in the Review and
// publish UI. A change of subject may still expose other Service capabilities.
const STUDIO_LIFECYCLE_TOOL = /^mcp__voidr__echo_journeys_(?:publish|schedule|activate|execute)(?:_|$)/

export function toolVisibilityFilter(names, { restricted, whatsapp, authoring, domains = null, development = false, extraTools = [] }) {
  const deny = names.filter(name => !RESERVED.has(name) &&
    ((restricted && !memberToolVisible(name)) || (whatsapp && WIDGET_TOOLS.has(name)) ||
      (authoring && STUDIO_LIFECYCLE_TOOL.test(name)) ||
      (domains && !profileToolVisible(name, domains, { development, extraTools, authoring }))))
  return deny.length ? { deny } : null
}

export function registerToolVisibility(ctx, isRestricted) {
  const masks = new Map()
  let refreshing = false
  // The plugin context sees the complete global registry. The agent view is
  // already masked and cannot be used to compute the next mask after expansion.
  const globalNames = () => ctx.tools.schemas().map(tool => tool.name).sort()
  const maskKey = (state, names) => `${state.restricted}|${state.whatsapp}|${state.authoring}|${state.development}|${state.domains?.join(',')}|${state.extraTools.join(',')}|${names.join(',')}`
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
    const extraTools = [...new Set(expandedToolNames(agent.session?.events))].sort()
    const state = { restricted: isRestricted(agent), whatsapp: contextChannel(agent.session?.events) === 'whatsapp',
      authoring: hint?.surface === 'echo' && hint.intent === 'echo_journey_import',
      domains, extraTools, development: hint?.surface !== 'slack' && hint?.surface !== 'teams' &&
        !(hint?.surface === 'echo' && hint.intent === 'echo_journey_import') }
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
