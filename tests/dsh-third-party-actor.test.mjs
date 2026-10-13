import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerThirdPartyActor } from '../adapters/dsh/third-party-actor.mjs'

const names = ['third_party_catalog', 'third_party_read', 'third_party_change', 'third_party_map_journeys',
  'third_party_get_journey_mapping', 'third_party_review_journey_mapping', 'third_party_get_simulation_preparation', 'third_party_submit_simulation_proposal']

async function fixture(response) {
  const hooks = new Map(), commands = new Map(), agent = { id: 'session' }
  const call = registerThirdPartyActor({ on: (name, fn) => hooks.set(name, fn), tools: { register: () => {} },
    commands: { register: command => commands.set(command.name, command) } }, {
    env: { DSH_VOIDR_MCP_URL: 'https://fixture.invalid', DSH_VOIDR_MCP_AUTHORIZATION: 'fixture' },
    fetchImpl: async url => ({ ok: true, json: async () => url.endsWith('/tools/list') ? { tools: names.map(name => ({ name })) } : response }),
  })
  assert.equal((await commands.get('third-party-actor').handler({ agent, rawInput: 'signed-fixture' })).kind, 'success')
  return () => call(agent, 'voidr_gate_get_clone_url', { repositoryId: 'repository' })
}

test('repository lookup accepts structured and text results', async () => {
  const data = { repoUrl: 'https://fixture.invalid/repo.git', defaultBranch: 'main' }
  assert.deepEqual(await (await fixture({ structuredContent: { data } }))(), data)
  assert.deepEqual(await (await fixture({ content: [{ type: 'text', text: JSON.stringify(data) }] }))(), data)
})

test('empty and malformed repository results produce a useful error', async () => {
  for (const response of [{}, { content: [] }, { content: [{ type: 'image' }] }, { content: [{ type: 'text', text: 'invalid' }] }])
    await assert.rejects((await fixture(response))(), /no usable clone target/)
})
