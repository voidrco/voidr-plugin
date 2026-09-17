import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerEchoRenderDeviations, validateEchoDeviationsFilters, echoDeviationsSchema } from '../adapters/dsh/echo-render-deviations.mjs'
import { registerEchoActor } from '../adapters/dsh/echo-actor.mjs'
import { loadDshPluginSkills } from '../adapters/dsh/plugin-skills.mjs'

const filters = { applicationId: '6a6cfa72d43cf76203eaf843', occurredFrom: '2026-09-14T00:00:00-03:00', occurredToExclusive: '2026-09-16T00:00:00-03:00' }
const result = total => ({ structuredContent: { data: { completeness: { complete: true }, data: { data: [], total, pages: Math.ceil(total / 20) } } } })
function setup(call = async () => result(526)) {
  let tool
  const events = []
  registerEchoRenderDeviations({ tools: { register: value => { tool = value } } }, call)
  return { tool, events, exec: { agent: { session: { append: (type, data) => events.push({ type, data }) } } } }
}

test('closed schema and runtime validation reject unknown fields and invalid intervals', () => {
  assert.equal(echoDeviationsSchema.additionalProperties, false)
  for (const args of [{ ...filters, rows: [] }, { ...filters, organizationId: 'other' }, { ...filters, spec: {} },
    { ...filters, applicationId: { $ne: null } }, { ...filters, occurredFrom: 'yesterday' },
    { ...filters, occurredToExclusive: filters.occurredFrom }, { ...filters, timezone: 'invalid/zone' }, { ...filters, environment: '' }]) {
    assert.throws(() => validateEchoDeviationsFilters(args))
  }
})

test('queries only one bounded page and publishes filters, never rows or credentials', async () => {
  const calls = []
  const { tool, exec, events } = setup(async (...args) => { calls.push(args); return result(526) })
  const output = await tool.execute(filters, exec)
  assert.equal(output.total, 526)
  assert.equal(output.pages, 27)
  assert.equal(calls.length, 1)
  assert.equal(calls[0][1], 'echo_list_deviations')
  assert.deepEqual(calls[0][2], { applicationId: filters.applicationId, occurredFrom: '2026-09-14T03:00:00.000Z', occurredToExclusive: '2026-09-16T03:00:00.000Z', page: 1, limit: 20, sort: 'recent' })
  assert.equal(events[0].type, 'voidr/widget')
  assert.equal(events[0].data.widget.interactive, false)
  assert.equal(events[0].data.widget.spec.elements.report.type, 'EchoDeviationsTable')
  assert.deepEqual(events[0].data.widget.spec.elements.report.props, validateEchoDeviationsFilters(filters))
  assert.doesNotMatch(JSON.stringify(events), /rows|token|authorization|multi_select/)
  assert.equal((await tool.execute(filters, exec)).widgetId, output.widgetId)
})

test('zero is a valid empty report; query failures, incomplete responses and cancellation publish nothing', async () => {
  const empty = setup(async () => result(0))
  assert.equal((await empty.tool.execute(filters, empty.exec)).total, 0)
  assert.equal(empty.events.length, 1)
  for (const call of [async () => { throw Error('unavailable') }, async () => ({}), async () => ({ structuredContent: { data: { completeness: { complete: false }, data: { data: [], total: 526, pages: 27 } } } })]) {
    const { tool, exec, events } = setup(call)
    await assert.rejects(tool.execute(filters, exec))
    assert.equal(events.length, 0)
  }
  const cancelled = setup()
  await assert.rejects(cancelled.tool.execute(filters, { ...cancelled.exec, signal: AbortSignal.abort() }))
  assert.equal(cancelled.events.length, 0)
})

test('report transport requires the Echo surface and an actor bound to that exact session', async () => {
  let command
  const requests = []
  const call = registerEchoActor({ on() {}, commands: { register: value => { command = value } }, tools: { register() {} } }, {
    env: { DSH_VOIDR_MCP_URL: 'http://localhost/v1/mcp', DSH_VOIDR_MCP_AUTHORIZATION: 'Basic local' },
    fetchImpl: async (url, init) => { requests.push(init); return { ok: true, json: async () => url.endsWith('/tools/list') ? { tools: [{ name: 'echo_list_deviations', inputSchema: {} }] } : result(526) } }
  })
  const agent = { id: 'one', session: { events: [{ type: 'voidr/project-context-hint', data: { surface: 'echo' } }] } }
  await assert.rejects(call(agent, 'echo_list_deviations', filters), /authorization/)
  await command.handler({ agent, rawInput: 'signed-actor' })
  await call(agent, 'echo_list_deviations', filters)
  assert.equal(requests.at(-1).headers['x-voidr-session'], 'signed-actor')
  await assert.rejects(call({ ...agent, id: 'two' }, 'echo_list_deviations', filters), /authorization/)
  await assert.rejects(call({ ...agent, session: { events: [] } }, 'echo_list_deviations', filters), /Echo surface/)
})

test('Echo strategy chooses the native report without prefetching all pages or claiming analysis', () => {
  const text = loadDshPluginSkills().find(skill => skill.name === 'voidr-echo-analysis').content
  assert.match(text, /call native `echo_render_deviations`/)
  assert.match(text, /Do not prefetch all pages/)
  assert.match(text, /Publishing\s+a table is not causal analysis/)
  assert.match(text, /do not drop those filters/)
})
