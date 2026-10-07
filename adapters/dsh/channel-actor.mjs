import { createHash } from 'node:crypto'
import { createEchoAnalysisGuard } from './echo-analysis-guard.mjs'

const PREFIX = 'mcp__voidr__'
const MAX_AGE_MS = 30 * 60_000
function publicName(raw) {
  const name = PREFIX + raw
  return name.length <= 64 ? name : name.slice(0, 51) + '_' +
    createHash('sha256').update('voidr\0' + raw).digest('hex').slice(0, 12)
}

/** Teams calls carry the linked member's delegation; never fall through to the SA. */
export function registerChannelActor(ctx, { fetchImpl = fetch, env = process.env, now = Date.now } = {}) {
  const bindings = new Map()
  const names = new Map()
  const registered = new Set()
  const analysis = createEchoAnalysisGuard()
  const hintFor = agent => agent?.session?.events.findLast(event =>
    event.type === 'voidr/project-context-hint')?.data
  async function request(path, token, body, signal) {
    const response = await fetchImpl(env.DSH_VOIDR_MCP_URL.replace(/\/$/, '') + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        authorization: env.DSH_VOIDR_MCP_AUTHORIZATION,
        'content-type': 'application/json',
        'x-mcp-scope': 'assistant-runtime',
        'x-voidr-session': token,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: 'error',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
    })
    if (!response.ok) {
      const error = new Error('Channel actor access unavailable')
      error.status = response.status
      throw error
    }
    return response.json()
  }
  ctx.commands.register({
    name: 'channel-actor',
    description: 'Attach server-signed Teams member authorization',
    recordInput: false,
    handler: async ({ agent, rawInput }) => {
      if (!agent || hintFor(agent)?.surface !== 'teams')
        return { kind: 'error', text: 'Channel actor requires the Teams surface' }
      bindings.delete(agent.id)
      try {
        const token = rawInput.trim()
        if (token.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token))
          throw new Error('Invalid delegation')
        const result = await request('/tools/list', token)
        if (!Array.isArray(result.tools) || !result.tools.length) throw new Error('No authorized tools')
        const allowed = new Set()
        for (const tool of result.tools) {
          const name = publicName(tool.name)
          names.set(name, tool.name)
          allowed.add(tool.name)
          if (registered.has(name) || ctx.tools.get?.(name)) continue
          ctx.tools.register({
            name, description: tool.description, parameters: tool.inputSchema,
            output: {
              schema: { type: 'object', properties: { content: { type: 'array', items: {} }, structuredContent: {} }, required: ['content'], additionalProperties: false },
              render: (_args, value) => value.content.filter(item => item.type === 'text'),
            },
            execute: async () => { throw new Error('Channel actor authorization required') },
          })
          registered.add(name)
        }
        bindings.set(agent.id, { token, allowed, registeredAt: now() })
        return { kind: 'success', text: 'Channel actor registered' }
      } catch (error) {
        return { kind: 'error', text: error.status === 403
          ? 'Channel actor authorization failed [CHANNEL_ACTOR_FORBIDDEN]'
          : 'Channel actor integration unavailable [CHANNEL_ACTOR_UNAVAILABLE]' }
      }
    },
  })
  ctx.on('tools/execute', async (exec, next) => {
    if (!exec.name.startsWith(PREFIX) || hintFor(exec.agent)?.surface !== 'teams') return next()
    const binding = bindings.get(exec.agent.id)
    if (!binding || now() - binding.registeredAt > MAX_AGE_MS)
      throw new Error('Channel actor authorization required; send a new message to reconnect')
    const tool = names.get(exec.name) ?? exec.name.slice(PREFIX.length)
    if (!binding.allowed.has(tool)) throw new Error('Tool unavailable to this channel actor')
    const send = args => request('/tools/call', binding.token, { tool, arguments: args }, exec.signal)
    const result = await analysis.call(exec.agent, tool, exec.arguments, hintFor(exec.agent), send)
    if (!Array.isArray(result.content) || result.isError)
      throw new Error('Channel tool rejected; no result was confirmed')
    const value = { content: result.content, ...(result.structuredContent !== undefined ? { structuredContent: result.structuredContent } : {}) }
    return { isError: false, value, content: value.content }
  })
  ctx.on('agent/disposed', ({ agent }) => { bindings.delete(agent.id); analysis.dispose(agent.id) })
}
