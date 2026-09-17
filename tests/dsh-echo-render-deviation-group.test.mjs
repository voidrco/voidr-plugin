import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerEchoRenderDeviationGroup } from '../adapters/dsh/echo-render-deviation-group.mjs'
import { registerEchoActor } from '../adapters/dsh/echo-actor.mjs'

const filters = {
  applicationId: '6a6cfa72d43cf76203eaf843',
  occurredFrom: '2026-08-18T03:00:00.000Z',
  occurredToExclusive: '2026-09-16T18:33:17.949Z',
  group: 'improper_transfer'
}

function fixture(data, completeness = { complete: true }) {
  let command
  const widgets = [], calls = []
  const ctx = { tools: { register(value) { command = value } } }
  registerEchoRenderDeviationGroup(ctx, async (_agent, name, args) => {
    calls.push({ name, args })
    return { content: [{ type: 'text', text: JSON.stringify({ asOf: '2026-09-16T18:34:10.000Z', completeness, data }) }] }
  })
  const exec = { agent: { session: { append(_type, value) { widgets.push(value.widget) } } } }
  return { command, widgets, calls, exec }
}

test('renders only reconciled service counts, not a model-authored total', async () => {
  const data = {
    group: 'improper_transfer', definitionVersion: 'improper-transfer-v1',
    totalRecords: 52,
    includedCodes: ['premature_transfer_before_request', 'premature_transfer_without_diagnosis'],
    byCode: [
      { code: 'premature_transfer_before_request', records: 46 },
      { code: 'premature_transfer_without_diagnosis', records: 6 }
    ],
    examples: [{ sessionCode: 'CONOFE-2264', sessionUrl: 'http://localhost:3030/echo/sessions/6aa83901f9efc1425d8f0817' }]
  }
  const { command, widgets, calls, exec } = fixture(data)
  const result = await command.execute(filters, exec)
  assert.equal(result.totalRecords, 52)
  assert.equal(result.codesRendered, 2)
  assert.equal(widgets.length, 1)
  assert.equal(widgets[0].spec.elements.report.props.rows.length, 2)
  assert.equal(widgets[0].title, '52 registros de transferências indevidas')
  assert.deepEqual(calls[0].name, 'echo_summarize_deviation_group')
  assert.deepEqual(calls[0].args.group, 'improper_transfer')
})

test('rejects mismatched counts and incomplete reads without publishing a widget', async () => {
  for (const [data, completeness] of [
    [{ group: 'improper_transfer', definitionVersion: 'v1', totalRecords: 46,
      includedCodes: ['transfer'], byCode: [{ code: 'transfer', records: 52 }], examples: [] }, { complete: true }],
    [{ group: 'improper_transfer', definitionVersion: 'v1', totalRecords: 0,
      includedCodes: [], byCode: [], examples: [] }, { complete: false }]
  ]) {
    const { command, widgets, exec } = fixture(data, completeness)
    await assert.rejects(command.execute(filters, exec))
    assert.equal(widgets.length, 0)
  }
})

test('the native report reaches the scoped MCP summary from a selected Journey', async () => {
  const registered = new Map(), requests = []
  let command
  const ctx = {
    on() {},
    commands: { register(value) { command = value } },
    tools: { register(value) { registered.set(value.name, value) }, get() { return null } }
  }
  const data = { group: 'improper_transfer', definitionVersion: 'improper-transfer-v1',
    totalRecords: 0, includedCodes: [], byCode: [], examples: [] }
  const callEchoTool = registerEchoActor(ctx, {
    env: { DSH_VOIDR_MCP_URL: 'http://local/mcp', DSH_VOIDR_MCP_AUTHORIZATION: 'Basic test' },
    fetchImpl: async (url, init) => {
      if (url.endsWith('/tools/list')) return { ok: true, json: async () => ({ tools: [{ name: 'echo_resolve_analysis_window', inputSchema: {} }, { name: 'echo_summarize_deviation_group', inputSchema: {} }] }) }
      const body = JSON.parse(init.body)
      requests.push(body)
      return { ok: true, json: async () => body.tool === 'echo_resolve_analysis_window'
        ? { content: [{ type: 'text', text: JSON.stringify({ occurredFrom: filters.occurredFrom, occurredToExclusive: filters.occurredToExclusive, timezone: 'America/Sao_Paulo' }) }] }
        : { content: [{ type: 'text', text: JSON.stringify({ asOf: '2026-09-16T18:34:10.000Z', completeness: { complete: true }, data }) }] } }
    }
  })
  registerEchoRenderDeviationGroup(ctx, callEchoTool)
  const widgets = []
  const agent = { id: 'selected-journey', session: { events: [
    { type: 'turn/start', seq: 1 },
    { type: 'voidr/project-context-hint', data: { surface: 'echo', applicationId: filters.applicationId, moduleSlug: 'vivo-autopilot-info-plano' } }
  ], append(_type, value) { widgets.push(value.widget) } } }
  await command.handler({ agent, rawInput: 'signed' })
  await callEchoTool(agent, 'echo_resolve_analysis_window', { period: { type: 'calendar_days', days: 30 } })
  const result = await registered.get('echo_render_deviation_group').execute(filters, { agent })
  assert.equal(result.totalRecords, 0)
  assert.equal(widgets.length, 1)
  assert.deepEqual(requests[1].arguments.scope, { type: 'journey', moduleSlug: 'vivo-autopilot-info-plano' })
})
