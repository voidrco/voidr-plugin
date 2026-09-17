import { test } from 'node:test'
import assert from 'node:assert/strict'
import { regulatoryScopeArguments } from '../adapters/dsh/echo-regulatory-scope.mjs'
import { registerEchoActor } from '../adapters/dsh/echo-actor.mjs'

const tool = 'echo_summarize_regulatory_controls'
const applicationId = '6a6cfa72d43cf76203eaf843'
const moduleSlug = 'vivo-autopilot-consulta-debitos'
const hint = { surface: 'echo', applicationId, moduleSlug }

test('fills the omitted scope with the selected Journey without mutating model arguments', () => {
  const args = { applicationId, limit: 100 }
  const expected = { ...args, scope: { type: 'journey', moduleSlug } }
  assert.deepEqual(regulatoryScopeArguments(tool, args, hint), expected)
  assert.deepEqual(regulatoryScopeArguments(tool, args, { surface: 'echo', echoContext: hint }), expected)
  assert.equal(args.scope, undefined)
})

test('blocks null, widening, mismatches, invalid and missing context', () => {
  for (const scope of [null, { type: 'application' }, { type: 'journey', moduleSlug: 'other' }]) {
    assert.throws(() => regulatoryScopeArguments(tool, { applicationId, scope }, hint))
  }
  assert.throws(() => regulatoryScopeArguments(tool, { applicationId: '6a61a47d077f855e0b440b63' }, hint))
  for (const context of [null, { surface: 'echo' }, { ...hint, moduleSlug: '' }, { ...hint, echoContext: { moduleSlug: 'other' } }]) {
    assert.throws(() => regulatoryScopeArguments(tool, { applicationId }, context))
  }
})

test('no selected Journey allows application or a requested narrower Journey; unrelated tools are unchanged', () => {
  const context = { surface: 'echo', applicationId }
  assert.deepEqual(regulatoryScopeArguments(tool, {}, context), { applicationId, scope: { type: 'application' } })
  const args = { applicationId, scope: { type: 'journey', moduleSlug } }
  assert.deepEqual(regulatoryScopeArguments(tool, args, context), args)
  assert.equal(regulatoryScopeArguments('echo_get_session', args, hint), args)
})

test('the deviation-group summary inherits the selected Echo scope', () => {
  const groupTool = 'echo_summarize_deviation_group'
  assert.deepEqual(regulatoryScopeArguments(groupTool, { applicationId, group: 'improper_transfer' }, hint), {
    applicationId, group: 'improper_transfer', scope: { type: 'journey', moduleSlug }
  })
  assert.throws(() => regulatoryScopeArguments(groupTool, { applicationId, scope: { type: 'application' } }, hint), /selected Echo Journey/)
})

test('both actor transport entry points inject scope and use only the latest session context', async () => {
  const hooks = new Map(), bodies = []
  let command
  const ctx = { on: (name, fn) => hooks.set(name, fn), commands: { register: c => { command = c } }, tools: { register() {} } }
  const invoke = registerEchoActor(ctx, {
    env: { DSH_VOIDR_MCP_URL: 'http://local/mcp', DSH_VOIDR_MCP_AUTHORIZATION: 'Basic test' },
    fetchImpl: async (url, init) => {
      if (init.body) bodies.push(JSON.parse(init.body))
      return { ok: true, json: async () => url.endsWith('/tools/list')
        ? { tools: [{ name: tool, inputSchema: {} }] } : { content: [] } }
    }
  })
  const agent = { id: 'one', session: { events: [{ type: 'voidr/project-context-hint', data: hint }] } }
  await command.handler({ agent, rawInput: 'signed' })
  await hooks.get('tools/execute')({ name: 'mcp__voidr__' + tool, arguments: { applicationId }, agent }, () => assert.fail())
  assert.deepEqual(bodies[0].arguments.scope, { type: 'journey', moduleSlug })
  await assert.rejects(invoke(agent, tool, { applicationId, scope: { type: 'application' } }))
  assert.equal(bodies.length, 1)
  agent.session.events.push({ type: 'voidr/project-context-hint', data: { surface: 'echo', applicationId } })
  await invoke(agent, tool, { applicationId })
  assert.deepEqual(bodies[1].arguments.scope, { type: 'application' })
})
