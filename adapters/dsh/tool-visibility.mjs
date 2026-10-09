import { memberToolVisible } from './echo-member-policy.mjs'
import { WIDGET_TOOLS, contextChannel } from './whatsapp-channel.mjs'

const RESERVED = new Set(['run_code'])

export function toolVisibilityFilter(names, { restricted, whatsapp }) {
  const deny = names.filter(name => !RESERVED.has(name) &&
    ((restricted && !memberToolVisible(name)) || (whatsapp && WIDGET_TOOLS.has(name))))
  return deny.length ? { deny } : null
}

export function registerToolVisibility(ctx, isRestricted) {
  const masks = new Map()
  let refreshing = false
  const visibleNames = agent => ctx.tools.schemas(agent).map(tool => tool.name).sort()
  const maskKey = (agent, state) => `${state.restricted}|${state.whatsapp}|${visibleNames(agent).join(',')}`
  function install(agent, state) {
    masks.get(agent)?.dispose()
    masks.delete(agent)
    const filter = toolVisibilityFilter(visibleNames(agent), state)
    const dispose = filter ? agent.ctx.tools.restrict(filter) : () => {}
    masks.set(agent, { dispose, key: maskKey(agent, state) })
  }
  function refresh(agent) {
    if (!agent?.ctx?.tools || refreshing) return
    const state = { restricted: isRestricted(agent), whatsapp: contextChannel(agent.session?.events) === 'whatsapp' }
    const previous = masks.get(agent)
    if (!previous && !state.restricted && !state.whatsapp) return
    if (previous?.key === maskKey(agent, state)) return
    refreshing = true
    try {
      install(agent, state)
    } finally {
      refreshing = false
    }
  }
  ctx.on('agent/created', ({ agent }) => refresh(agent), { global: true })
  ctx.on('tools/change', () => { if (!refreshing) for (const agent of ctx.agents.list()) refresh(agent) })
  ctx.on('agent/disposed', ({ agent }) => { masks.delete(agent) }, { global: true })
  return { refresh }
}
