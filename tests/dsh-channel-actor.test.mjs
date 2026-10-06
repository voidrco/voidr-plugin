import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerChannelActor } from '../adapters/dsh/channel-actor.mjs'

function fixture() {
  const hooks = new Map(), calls = [], tools = new Map()
  let command, clock = 0, denied = false
  registerChannelActor({
    on: (event, fn) => hooks.set(event, fn),
    commands: { register: value => { command = value } },
    tools: { register: value => tools.set(value.name, value), get: name => tools.get(name) },
  }, {
    env: { DSH_VOIDR_MCP_URL: 'http://fixture.invalid', DSH_VOIDR_MCP_AUTHORIZATION: 'Basic private' },
    now: () => clock,
    fetchImpl: async (url, init) => {
      calls.push({ url, ...init })
      if (denied) return { ok: false, status: 403 }
      return { ok: true, json: async () => url.endsWith('/tools/list')
        ? { tools: [{ name: 'test_plans_list', description: 'Read plans', inputSchema: { type: 'object' } }] }
        : { content: [{ type: 'text', text: 'fixture evidence' }] } }
    },
  })
  const agent = (id, surface = 'teams') => ({ id, session: { events: [{ type: 'voidr/project-context-hint', data: { surface } }] } })
  const invoke = (current, name = 'mcp__voidr__test_plans_list', next = () => { throw new Error('SA fallback forbidden') }) =>
    hooks.get('tools/execute')({ name, agent: current, arguments: { limit: 2 } }, next)
  return { command, calls, tools, hooks, agent, invoke, tick: value => { clock = value }, deny: () => { denied = true } }
}

test('Teams registers general tools without requiring Echo and delegates with the member assertion', async () => {
  const f = fixture(), one = f.agent('one'), two = f.agent('two')
  assert.equal((await f.command.handler({ agent: one, rawInput: 'signed.one.token' })).kind, 'success')
  await f.command.handler({ agent: two, rawInput: 'signed.two.token' })
  await Promise.all([f.invoke(one), f.invoke(two)])
  assert.deepEqual(f.calls.filter(call => call.body).map(call => call.headers['x-voidr-session']), ['signed.one.token', 'signed.two.token'])
  assert.equal(f.calls[0].headers['x-mcp-scope'], 'assistant-runtime')
  assert.equal(f.command.recordInput, false)
  assert.equal(f.tools.size, 1)
  await assert.rejects(f.invoke(one, 'mcp__voidr__test_plans_delete'), /unavailable/)
})

test('Teams never falls through to the service account without delegation or after expiry/disposal', async () => {
  const f = fixture(), one = f.agent('one')
  await assert.rejects(f.invoke(one), /authorization required/)
  await f.command.handler({ agent: one, rawInput: 'signed.one.token' })
  f.tick(30 * 60_000 + 1)
  await assert.rejects(f.invoke(one), /authorization required/)
  f.tick(0)
  f.hooks.get('agent/disposed')({ agent: one })
  await assert.rejects(f.invoke(one), /authorization required/)
})

test('Teams invalidates the previous delegation when a refresh is denied and hides upstream details', async () => {
  const f = fixture(), one = f.agent('one')
  await f.command.handler({ agent: one, rawInput: 'signed.one.token' })
  f.deny()
  const result = await f.command.handler({ agent: one, rawInput: 'signed.one.token' })
  assert.match(result.text, /CHANNEL_ACTOR_FORBIDDEN/)
  assert.doesNotMatch(result.text, /signed|private/)
  await assert.rejects(f.invoke(one), /authorization required/)
})

test('Other surfaces retain their own tool paths and cannot register a Teams delegation', async () => {
  const f = fixture(), echo = f.agent('echo', 'echo')
  assert.equal((await f.command.handler({ agent: echo, rawInput: 'signed.one.token' })).kind, 'error')
  assert.equal(await f.invoke(echo, undefined, () => 'echo path'), 'echo path')
  assert.equal(f.calls.length, 0)
})

test('Malformed assertions fail before the upstream request', async () => {
  const f = fixture()
  assert.equal((await f.command.handler({ agent: f.agent('one'), rawInput: 'invalid' })).kind, 'error')
  assert.equal(f.calls.length, 0)
})
