import { createHash } from 'node:crypto'
import { regulatoryScopeArguments } from './echo-regulatory-scope.mjs'
import { createEchoAnalysisGuard } from './echo-analysis-guard.mjs'

const PREFIX = 'mcp__voidr__'

function publicName(raw) {
  const name = PREFIX + raw
  return name.length <= 64 ? name : name.slice(0, 51) + '_' +
    createHash('sha256').update('voidr\0' + raw).digest('hex').slice(0, 12)
}

export function registerEchoActor(ctx, { fetchImpl = fetch, env = process.env } = {}) {
  const assertions = new Map()
  const registered = new Set()
  const names = new Map()
  const analysis = createEchoAnalysisGuard()
  async function request(path, assertion, body, signal, scope = 'assistant-runtime') {
    const response = await fetchImpl(env.DSH_VOIDR_MCP_URL.replace(/\/$/, '') + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        authorization: env.DSH_VOIDR_MCP_AUTHORIZATION,
        'content-type': 'application/json',
        'x-mcp-scope': scope,
        'x-voidr-session': assertion
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000)
    })
    if (!response.ok) throw new Error('Echo access request failed (HTTP ' + response.status + ')')
    return response.json()
  }
  ctx.commands.register({
    name: 'echo-actor',
    description: 'Attach server-signed Echo actor authorization',
    recordInput: false,
    handler: async ({ agent, rawInput }) => {
      assertions.delete(agent.id)
      try {
        const assertion = rawInput.trim()
        const result = await request('/tools/list', assertion)
        for (const tool of result.tools ?? []) names.set(publicName(tool.name), tool.name)
        const tools = result.tools?.filter(tool => tool.name.startsWith('echo_')) ?? []
        if (!tools.length) throw new Error('Echo access unavailable')
        for (const tool of tools) {
          const name = publicName(tool.name)
          names.set(name, tool.name)
          if (registered.has(name) || ctx.tools.get?.(name)) continue
          ctx.tools.register({
            name,
            description: tool.description,
            parameters: tool.inputSchema,
            output: {
              schema: { type: 'object', properties: { content: { type: 'array', items: {} }, structuredContent: {} }, required: ['content'], additionalProperties: false },
              render: (_args, value) => value.content.filter(item => item.type === 'text')
            },
            execute: async () => { throw new Error('Echo actor authorization required') }
          })
          registered.add(name)
        }
        assertions.set(agent.id, assertion)
        return { kind: 'success', text: 'Echo actor registered' }
      } catch {
        return { kind: 'error', text: 'Echo actor authorization failed' }
      }
    }
  })
  ctx.on('tools/execute', async (exec, next) => {
    if (!exec.name.startsWith(PREFIX)) return next()
    const hint = exec.agent?.session.events.findLast(event => event.type === 'voidr/project-context-hint')?.data
    if (hint?.surface !== 'echo') return next()
    const assertion = assertions.get(exec.agent?.id)
    if (!assertion) throw new Error('Echo actor authorization required; send a new message to reconnect')
    const tool = names.get(exec.name) ?? exec.name.slice(PREFIX.length)
    const result = await analysis.call(exec.agent, tool, exec.arguments, hint, args => request('/tools/call', assertion, {
      tool,
      arguments: regulatoryScopeArguments(tool, args, hint)
    }, exec.signal))
    if (result.isError) throw new Error('Echo tool rejected: ' +
      (result.content ?? []).filter(item => item.type === 'text').map(item => item.text).join('\n'))
    const value = { content: result.content ?? [], ...(result.structuredContent !== undefined ? { structuredContent: result.structuredContent } : {}) }
    return { isError: false, value, content: value.content }
  })
  ctx.on('agent/disposed', ({ agent }) => { assertions.delete(agent.id); analysis.dispose(agent.id) })
  return async (agent, tool, args, signal) => {
    const hint = agent?.session.events.findLast(event => event.type === 'voidr/project-context-hint')?.data
    if (hint?.surface !== 'echo') throw new Error('This tool requires the Echo surface')
    const assertion = assertions.get(agent?.id)
    if (!assertion) throw new Error('Echo actor authorization required; send a new message to reconnect')
    const result = await analysis.call(agent, tool, args, hint, checked => request('/tools/call', assertion, { tool, arguments: regulatoryScopeArguments(tool, checked, hint) }, signal))
    if (result.isError) throw new Error('Echo query failed; no report was published')
    return result
  }
}
