import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { registerThirdPartyActor } from '../../adapters/dsh/third-party-actor.mjs'

const names = ['third_party_catalog', 'third_party_read', 'third_party_change', 'third_party_map_journeys', 'third_party_get_journey_mapping', 'third_party_review_journey_mapping', 'third_party_get_simulation_preparation', 'third_party_submit_simulation_proposal', 'artifacts_read', 'artifacts_query', 'artifacts_aggregate']

test('DSH preparation routes signed context over HTTP and cannot publish, activate or escape to other capabilities', async t => {
  const requests = [], hooks = new Map(), commands = new Map(), tools = new Map()
  const agent = { id: 'synthetic-session' }, other = { id: 'other-session' }
  const server = createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json')
    if (req.headers['x-voidr-session'] !== 'synthetic-signed-assertion') { res.writeHead(403); res.end('{}'); return }
    if (req.url === '/tools/list') { res.end(JSON.stringify({ tools: names.map(name => ({ name, inputSchema: { type: 'object' } })) })); return }
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString())
    requests.push({ body, scope: req.headers['x-mcp-scope'], assertion: req.headers['x-voidr-session'] })
    if (body.arguments.preparationId === 'invalid-proposal') {
      res.end(JSON.stringify({ isError: true, content: [{ type: 'text', text: JSON.stringify({ code: 'ENTITY_SCHEMA_INVALID', details: { issues: [{ path: '/initial/person/0/key' }], schema: { additionalProperties: false } } }) }] })); return
    }
    res.end(JSON.stringify({ content: [{ type: 'text', text: 'accepted' }], structuredContent: { data: body.arguments } }))
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => new Promise(resolve => server.close(resolve)))
  registerThirdPartyActor({ on: (name, hook) => hooks.set(name, hook), tools: { register: tool => tools.set(tool.name, tool) }, commands: { register: command => commands.set(command.name, command) } }, {
    env: { DSH_VOIDR_MCP_URL: `http://127.0.0.1:${server.address().port}`, DSH_VOIDR_MCP_AUTHORIZATION: 'synthetic-runtime' },
    getContext: () => ({ intent: 'third_party_simulation_preparation' }),
  })
  const execute = (name, args = {}, acting = agent) => hooks.get('tools/execute')({ name: `mcp__voidr__${name}`, arguments: args, agent: acting }, () => { throw new Error('Unexpected capability fallback') })
  await assert.rejects(execute('third_party_read'), /authorization required/)
  assert.equal((await commands.get('third-party-actor').handler({ agent, rawInput: 'synthetic-signed-assertion' })).kind, 'success')
  assert.equal(tools.size, names.length)
  const source = await execute('third_party_get_simulation_preparation', { preparationId: 'preparation', offset: 6000 })
  assert.equal(source.value.structuredContent.data.offset, 6000)
  await execute('third_party_change', { operationId: 'validate-simulation-blueprint', body: { rules: [] } })
  await execute('third_party_submit_simulation_proposal', { preparationId: 'preparation', proposal: { blueprint: {}, gaps: ['policy'] } })
  for (const operationId of ['publish-simulation-blueprint', 'activate-simulation-run', 'replace-catalog-integration'])
    await assert.rejects(execute('third_party_change', { operationId }), /Preparation only permits/)
  for (const name of ['third_party_map_journeys', 'third_party_review_journey_mapping', 'shell', 'system_batch_execute'])
    await assert.rejects(execute(name), /Preparation only permits/)
  await assert.rejects(execute('third_party_read', {}, other), /authorization required/)
  for (const tool of ['artifacts_read', 'artifacts_query', 'artifacts_aggregate']) {
    const result = await execute(tool, { artifactId: 'bound-artifact' })
    assert.equal(result.value.structuredContent.data.artifactId, 'bound-artifact')
    await assert.rejects(execute(tool, { artifactId: 'bound-artifact' }, other), /authorization required/)
  }
  await assert.rejects(execute('third_party_submit_simulation_proposal', { preparationId: 'invalid-proposal' }), error => {
    assert.match(error.message, /ENTITY_SCHEMA_INVALID/)
    assert.match(error.message, /initial\/person\/0\/key/)
    assert.match(error.message, /additionalProperties/)
    return true
  })
  assert.equal(requests.length, 7)
  assert.ok(requests.every(item => item.scope === 'assistant-runtime' && item.assertion === 'synthetic-signed-assertion'))
  hooks.get('agent/disposed')({ agent })
  await assert.rejects(execute('third_party_read'), /authorization required/)
  assert.equal((await commands.get('third-party-actor').handler({ agent, rawInput: 'invalid' })).kind, 'error')
  await assert.rejects(execute('third_party_read'), /authorization required/)
})
