import { assertReviewedCatalogChange } from './third-party-discovery.mjs'

const PREFIX = 'mcp__voidr__'
const ARTIFACT_TOOLS = new Set(['artifacts_read', 'artifacts_query', 'artifacts_aggregate'])
const TOOL_NAMES = new Set(['third_party_catalog', 'third_party_read', 'third_party_change', 'third_party_map_journeys', 'third_party_get_journey_mapping', 'third_party_review_journey_mapping', 'third_party_get_simulation_preparation', 'third_party_submit_simulation_proposal'])

export function registerThirdPartyActor(ctx, { fetchImpl = fetch, env = process.env, getContext = () => null } = {}) {
  const assertions = new Map()
  const registered = new Set()
  async function request(path, assertion, body, signal) {
    const response = await fetchImpl(env.DSH_VOIDR_MCP_URL.replace(/\/$/, '') + path, {
      method: body ? 'POST' : 'GET',
      redirect: 'error',
      headers: { authorization: env.DSH_VOIDR_MCP_AUTHORIZATION, 'content-type': 'application/json',
        'x-mcp-scope': 'assistant-runtime', 'x-voidr-session': assertion },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(75000)]) : AbortSignal.timeout(75000)
    })
    if (!response.ok) throw new Error('Third Parties access request failed (HTTP ' + response.status + ')')
    return response.json()
  }
  ctx.commands.register({ name: 'third-party-actor', description: 'Attach server-signed Third Parties actor authorization', recordInput: false,
    handler: async ({ agent, rawInput }) => {
      assertions.delete(agent.id)
      try {
        const assertion = rawInput.trim()
        const result = await request('/tools/list', assertion)
        const tools = result.tools?.filter(tool => TOOL_NAMES.has(tool.name) || (getContext(agent)?.intent === 'third_party_simulation_preparation' && ARTIFACT_TOOLS.has(tool.name))) ?? []
        if (tools.filter(tool => TOOL_NAMES.has(tool.name)).length !== TOOL_NAMES.size) throw new Error('Third Parties tools unavailable')
        for (const tool of tools) {
          const name = PREFIX + tool.name
          if (registered.has(name) || ctx.tools.get?.(name)) continue
          ctx.tools.register({ name, description: tool.description, parameters: tool.inputSchema,
            output: { schema: { type: 'object', properties: { content: { type: 'array', items: {} }, structuredContent: {} }, required: ['content'], additionalProperties: false },
              render: (_args, value) => value.content.filter(item => item.type === 'text') },
            execute: async () => { throw new Error('Third Parties actor authorization required') }
          })
          registered.add(name)
        }
        assertions.set(agent.id, assertion)
        return { kind: 'success', text: 'Third Parties actor registered' }
      } catch { return { kind: 'error', text: 'Third Parties actor authorization failed' } }
    }
  })
  ctx.on('tools/execute', async (exec, next) => {
    const name = exec.name.startsWith(PREFIX) ? exec.name.slice(PREFIX.length) : ''
    const preparation = getContext(exec.agent)?.intent === 'third_party_simulation_preparation'
    if (preparation) {
      const allowed = ['third_party_catalog', 'third_party_read', 'third_party_get_simulation_preparation', 'third_party_submit_simulation_proposal']
      const validation = name === 'third_party_change' && exec.arguments?.operationId === 'validate-simulation-blueprint'
      const discovery = exec.name === PREFIX + 'system_search_tools'
      const skill = exec.name === 'skill' && exec.arguments?.name === 'voidr-third-parties'
      if (!allowed.includes(name) && !ARTIFACT_TOOLS.has(name) && !validation && !discovery && !skill) throw new Error('Preparation only permits reading context, validating and submitting a proposal')
    }
    if (!TOOL_NAMES.has(name) && !(preparation && ARTIFACT_TOOLS.has(name))) return next()
    const assertion = assertions.get(exec.agent?.id)
    if (!assertion) throw new Error('Third Parties actor authorization required; reopen the integration from the Platform')
    if (name === 'third_party_change') await assertReviewedCatalogChange({ exec, args: exec.arguments,
      readCurrent: async () => {
        const response = await request('/tools/call', assertion, { tool: 'third_party_read', arguments: {
          operationId: exec.arguments.operationId.replace(/^replace-/, 'get-'), id: exec.arguments.id,
        } }, exec.signal)
        if (response.isError) throw new Error('Read the existing catalog resource before replacing it')
        return response.structuredContent?.data?.data?.data
      },
    })
    const result = await request('/tools/call', assertion, { tool: name, arguments: exec.arguments }, exec.signal)
    if (result.isError) throw new Error('Third Parties request rejected: ' +
      (result.content ?? []).filter(item => item.type === 'text').map(item => item.text).join('\n'))
    const value = { content: result.content ?? [], ...(result.structuredContent !== undefined ? { structuredContent: result.structuredContent } : {}) }
    return { isError: false, value, content: value.content }
  })
  ctx.on('agent/disposed', ({ agent }) => assertions.delete(agent.id))
  return async (agent, tool, args, signal) => {
    if (tool !== 'voidr_gate_get_clone_url') throw new Error('Unsupported codebase capability')
    const assertion = assertions.get(agent?.id)
    if (!assertion) throw new Error('Open Third Parties in the Platform before preparing a codebase')
    const result = await request('/tools/call', assertion, { tool, arguments: args }, signal)
    if (result.isError) throw new Error('The selected repository could not be authorized for inspection')
    if (result.structuredContent?.data) return result.structuredContent.data
    const text = result.content?.find(item => item.type === 'text' && typeof item.text === 'string' && item.text.trim())?.text
    try {
      const data = text ? JSON.parse(text) : null
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error()
      return data
    } catch { throw new Error('Repository authorization returned no usable clone target; retry the repository lookup') }
  }
}
