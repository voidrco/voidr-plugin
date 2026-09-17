import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerEchoRenderRegulatoryControls, echoRegulatoryReportSchema } from '../adapters/dsh/echo-render-regulatory-controls.mjs'
import { validateEchoDeviationsFilters } from '../adapters/dsh/echo-render-deviations.mjs'

const filters = {
  applicationId: '6a6cfa72d43cf76203eaf843',
  occurredFrom: '2026-09-09T00:00:00-03:00',
  occurredToExclusive: '2026-09-15T21:21:54-03:00',
  timezone: 'America/Sao_Paulo'
}

function control(index, overrides = {}) {
  return {
    stableId: `control-${index}`, title: `Controle ${index}`,
    nonCompliantSessions: index, criticalNonCompliantSessions: 0,
    inconclusiveSessions: index + 10, ...overrides
  }
}

function response(controls, { page = 1, total = controls.length, nextPage = null, coverage = {} } = {}) {
  return { structuredContent: { data: {
    asOf: '2026-09-16T00:28:19.498Z', completeness: { complete: false },
    data: {
      available: true, consistency: 'live_read_not_immutable_snapshot',
      controls, coverage: { selectedSessions: 1164, missing_control_results: 39, ...coverage },
      affectedSessions: { nonCompliant: 525 },
      totals: {
        distinctNonCompliantControls: total,
        nonCompliantOccurrences: controls.reduce((sum, row) => sum + row.nonCompliantSessions, 0),
        criticalNonCompliantOccurrences: controls.reduce((sum, row) => sum + row.criticalNonCompliantSessions, 0)
      },
      pagination: { outcome: 'NON_COMPLIANT', page, limit: 100, total,
        hasMore: nextPage !== null, nextPage }
    }
  } } }
}

function setup(call) {
  let tool
  const events = []
  registerEchoRenderRegulatoryControls({ tools: { register: value => { tool = value } } }, call)
  return { tool, events, exec: { agent: { session: { append: (type, data) => events.push({ type, data }) } } } }
}

test('publishes all 23 canonical controls without converting zero to unavailable', async () => {
  const controls = Array.from({ length: 23 }, (_, index) => control(index + 1))
  controls[6] = control(7, { title: 'Fornecimento de informações da Oferta contratada',
    regulatoryCitationLabel: 'Art. 74 — cláusula 2.23', nonCompliantSessions: 123,
    criticalNonCompliantSessions: 123, inconclusiveSessions: 507 })
  controls[9] = control(10, { title: 'Informação adequada e clara sobre produtos e serviços',
    nonCompliantSessions: 79, criticalNonCompliantSessions: 79, inconclusiveSessions: 298 })
  controls[12] = control(13, { title: 'Fornecimento de informações da Oferta ao consumidor',
    nonCompliantSessions: 23, criticalNonCompliantSessions: 23, inconclusiveSessions: 505 })
  controls[22] = control(23, { inconclusiveSessions: null })
  const calls = []
  const { tool, exec, events } = setup(async (...args) => {
    calls.push(args)
    return response(controls)
  })
  const output = await tool.execute(filters, exec)
  const widget = events[0].data.widget
  const rows = widget.spec.elements.report.props.rows
  assert.equal(calls.length, 1)
  assert.equal(calls[0][1], 'echo_summarize_regulatory_controls')
  assert.deepEqual(calls[0][2], {
    ...validateEchoDeviationsFilters(filters), outcome: 'NON_COMPLIANT', page: 1, limit: 100
  })
  assert.equal(output.controlsRendered, 23)
  assert.equal(output.controlsTotal, 23)
  assert.equal(widget.spec.elements.report.type, 'Table')
  assert.equal(rows.length, 23)
  assert.deepEqual(rows[6], ['Fornecimento de informações da Oferta contratada (Art. 74 — cláusula 2.23)', '123', '123', '507'])
  assert.deepEqual(rows[9], ['Informação adequada e clara sobre produtos e serviços', '79', '79', '298'])
  assert.deepEqual(rows[12], ['Fornecimento de informações da Oferta ao consumidor', '23', '23', '505'])
  assert.equal(rows[0][2], '0')
  assert.equal(rows[22][3], 'Indisponível')
  assert.equal(output.coverage.missing_control_results, 39)
  assert.deepEqual(output.mostRecurrentControls.map(row => row.stableId), ['control-7'])
  assert.deepEqual(output.mostCriticalControls.map(row => row.stableId), ['control-7'])
  assert.equal(widget.interactive, false)
})

test('reads all pages before publishing and rejects mismatched totals', async () => {
  const all = [control(1), control(2), control(3)]
  const calls = []
  const first = response(all.slice(0, 2), { total: 3, nextPage: 2 })
  first.structuredContent.data.data.totals.nonCompliantOccurrences = 6
  const second = response(all.slice(2), { page: 2, total: 3 })
  second.structuredContent.data.data.totals.nonCompliantOccurrences = 6
  const { tool, exec, events } = setup(async (_agent, _name, args) => {
    calls.push(args)
    return args.page === 1 ? first : second
  })
  assert.equal((await tool.execute(filters, exec)).controlsRendered, 3)
  assert.deepEqual(calls.map(call => call.page), [1, 2])
  assert.equal(events[0].data.widget.spec.elements.report.props.rows.length, 3)

  const invalid = setup(async () => response([control(1)], { total: 3 }))
  await assert.rejects(invalid.tool.execute(filters, invalid.exec), /Incomplete regulatory report/)
  assert.equal(invalid.events.length, 0)
})

test('rejects model-supplied rows, duplicate controls, invalid counts and cancellation', async () => {
  assert.equal(echoRegulatoryReportSchema.additionalProperties, false)
  assert.throws(() => validateEchoDeviationsFilters({ ...filters, rows: [] }))
  for (const rows of [[control(1), control(1)], [control(1, { criticalNonCompliantSessions: 2 })],
    [control(1, { inconclusiveSessions: 'missing' })]]) {
    const instance = setup(async () => response(rows))
    await assert.rejects(instance.tool.execute(filters, instance.exec))
    assert.equal(instance.events.length, 0)
  }
  const cancelled = setup(async () => response([control(1)]))
  await assert.rejects(cancelled.tool.execute(filters, { ...cancelled.exec, signal: AbortSignal.abort() }))
  assert.equal(cancelled.events.length, 0)
})
