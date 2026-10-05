import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createEchoAnalysisGuard } from '../adapters/dsh/echo-analysis-guard.mjs'
import { compareEchoPeriods } from '../adapters/dsh/echo-period-comparison.mjs'
import { registerEchoActor } from '../adapters/dsh/echo-actor.mjs'

const applicationId = '6a6cfa72d43cf76203eaf843'
const timezone = 'America/Sao_Paulo'
const interval = { occurredFrom: '2026-10-01T03:00:00.000Z', occurredToExclusive: '2026-10-05T03:00:00.000Z', timezone }
const first = { label: 'October 1', occurredFrom: interval.occurredFrom, occurredToExclusive: '2026-10-02T03:00:00.000Z' }
const second = { label: 'October 4', occurredFrom: '2026-10-04T03:00:00.000Z', occurredToExclusive: interval.occurredToExclusive }
const envelope = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] })
const parse = result => JSON.parse(result.content[0].text)
const selection = { applicationId, environment: 'production', moduleSlug: 'plan-info' }
const hint = { surface: 'echo', applicationId, moduleSlug: selection.moduleSlug, echoContext: { environmentSlug: selection.environment } }
const resolveArgs = { period: { type: 'dates', from: '2026-10-01', to: '2026-10-04' }, timezone }
const noRequest = () => assert.fail('Rejected before transport')
function fixture() {
  const guard = createEchoAnalysisGuard()
  const agent = { id: 'comparison', session: { events: [{ type: 'turn/start', seq: 1 }] } }
  const call = (tool, args, read) => guard.call(agent, tool, args, hint, read)
  return { call, resolve: () => call('echo_resolve_analysis_window', resolveArgs, async () => envelope(interval)) }
}

test('both reported days work inside the selected interval; widening, invalid bounds and scope changes fail', async () => {
  const { call, resolve } = fixture()
  await resolve()
  for (const period of [first, second]) {
    for (const tool of ['echo_analyze_session_cohort', 'echo_analyze_judge_criterion']) {
      const args = { ...selection, ...period, timezone }
      assert.deepEqual(await call(tool, args, async checked => checked), args)
    }
  }
  for (const changes of [{ occurredFrom: '2026-09-30T03:00:00Z' },
    { occurredToExclusive: first.occurredFrom }, { timezone: 'UTC' },
    { environment: 'staging' }, { moduleSlug: 'other' }, { applicationId: 'other' }]) {
    await assert.rejects(call('echo_analyze_session_cohort', { ...selection, ...first, timezone, ...changes }, noRequest))
  }
})

test('Service list schemas: deviations are exclusive, sessions are inclusive; wrong fields never reach transport', async () => {
  const { call, resolve } = fixture()
  await resolve()
  const common = { ...selection, occurredFrom: first.occurredFrom }
  const exclusive = { ...common, occurredToExclusive: first.occurredToExclusive }
  const inclusive = { ...common, occurredTo: '2026-10-02T02:59:59.999Z' }
  assert.deepEqual(await call('echo_list_deviations', exclusive, async args => args), exclusive)
  assert.deepEqual(await call('echo_list_sessions', inclusive, async args => args), inclusive)
  await assert.rejects(call('echo_list_deviations', inclusive, noRequest), /interval mismatch/)
  await assert.rejects(call('echo_list_sessions', exclusive, noRequest), /interval mismatch/)
  await assert.rejects(call('echo_list_deviations', { ...exclusive, occurredTo: inclusive.occurredTo }, noRequest), /interval mismatch/)
})

test('disjoint comparisons are declared before reads and labels cannot widen an empty result', async () => {
  const { call, resolve } = fixture()
  await resolve()
  const previous = { occurredFrom: '2026-09-20T03:00:00Z', occurredToExclusive: '2026-09-21T03:00:00Z', timezone }
  const args = { period: { type: 'dates', from: '2026-09-20', to: '2026-09-20' }, comparisonLabel: 'baseline' }
  let requests = 0
  const read = async forwarded => { requests++; assert.equal(forwarded.comparisonLabel, undefined); return envelope(previous) }
  await Promise.all([call('echo_resolve_analysis_window', args, read), call('echo_resolve_analysis_window', args, read)])
  assert.equal(requests, 1)
  await call('echo_analyze_session_cohort', { ...selection, ...interval }, async () => envelope({ completeness: { complete: true }, data: { summary: { totalSessions: 0 } } }))
  await call('echo_analyze_session_cohort', { ...selection, ...previous }, async () => envelope({ data: { available: false } }))
  await assert.rejects(call('echo_resolve_analysis_window', { ...args, comparisonLabel: 'fallback' }, noRequest), /fixed until the user/)
  await assert.rejects(call('echo_analyze_session_cohort', { ...selection, ...interval, occurredFrom: previous.occurredFrom }, noRequest), /interval mismatch/)
})

function evidence(tool, args, complete = true) {
  const isFirst = args.occurredFrom === first.occurredFrom
  const data = { interval: { occurredFrom: args.occurredFrom, occurredToExclusive: args.occurredToExclusive, timezone }, filters: selection }
  if (tool === 'echo_analyze_session_cohort') data.summary = {
    totalSessions: isFirst ? 151 : 94,
    judgeLifecycle: { officialPass: isFirst ? 24 : 14, officialFail: isFirst ? 122 : 79, evaluated: isFirst ? 148 : 94 },
    experience: { sessionLatencyP95MedianMs: isFirst ? 26000 : 31000 },
  }
  else data.totals = { evaluatedSessions: isFirst ? 148 : 94, passSessions: isFirst ? 72 : 31,
    failSessions: isFirst ? 75 : 63, inconclusiveSessions: isFirst ? 1 : 0 }
  return envelope({ source: 'fixture', completeness: { complete }, data })
}
const comparisonArgs = { ...selection, timezone, periods: [first, second], criteria: [{ criterionId: 'procedural_adherence' }] }

test('comparison reads each cohort and criterion separately and computes true percentage-point deltas', async () => {
  const { call, resolve } = fixture()
  await resolve()
  const requests = []
  const result = parse(await compareEchoPeriods(comparisonArgs, (tool, args) => call(tool, args, async checked => {
    requests.push({ tool, args: checked }); return evidence(tool, checked)
  })))
  assert.equal(requests.length, 4)
  assert.deepEqual(requests.map(request => request.args.occurredFrom), [first.occurredFrom, first.occurredFrom, second.occurredFrom, second.occurredFrom])
  assert.equal(result.complete, true)
  assert.equal(result.periods[0].officialConclusiveSuccessRate.denominator, 146)
  assert.equal(result.periods[1].officialConclusiveSuccessRate.denominator, 93)
  assert.equal(result.officialSuccessRateDeltaPercentagePoints, 100 * 14 / 93 - 100 * 24 / 146)
  assert.equal(result.criterionDeltas[0].conclusiveSuccessRateDeltaPercentagePoints, 100 * 31 / 94 - 100 * 72 / 147)
  assert.deepEqual(result.periods.map(period => period.cohort.data.summary.experience.sessionLatencyP95MedianMs), [26000, 31000])
})

test('incomplete, empty, unavailable and mismatched results never manufacture a comparison', async () => {
  const partial = parse(await compareEchoPeriods(comparisonArgs, async (tool, args) => evidence(tool, args, false)))
  assert.equal(partial.complete, false)
  assert.equal(partial.officialSuccessRateDeltaPercentagePoints, null)
  assert.deepEqual(partial.criterionDeltas, [])
  const empty = parse(await compareEchoPeriods({ ...comparisonArgs, criteria: [] }, async (tool, args) => {
    const result = parse(evidence(tool, args)); result.data.summary.judgeLifecycle = { officialPass: 0, officialFail: 0 }
    return envelope(result)
  }))
  assert.equal(empty.periods[0].officialConclusiveSuccessRate.percent, null)
  assert.equal(empty.officialSuccessRateDeltaPercentagePoints, null)
  await assert.rejects(compareEchoPeriods(comparisonArgs, async () => envelope({ data: { available: false } })), /unavailable/)
  await assert.rejects(compareEchoPeriods(comparisonArgs, async (tool, args) => evidence(tool, { ...args, occurredToExclusive: interval.occurredToExclusive })), /different interval/)
  await assert.rejects(compareEchoPeriods({ ...comparisonArgs, periods: [first] }, noRequest), /two distinct/)
})

test('native actor hook advertises and executes local comparison through authorized guarded Service reads', async () => {
  const hooks = new Map(), registered = new Map(), requests = []
  let command
  registerEchoActor({ on: (name, fn) => hooks.set(name, fn), commands: { register: value => { command = value } },
    tools: { register: value => registered.set(value.name, value) } }, {
    env: { DSH_VOIDR_MCP_URL: 'http://fixture/mcp', DSH_VOIDR_MCP_AUTHORIZATION: 'Basic fixture' },
    fetchImpl: async (url, init) => {
      assert.equal(init.headers['x-voidr-session'], 'fixture-actor')
      if (url.endsWith('/tools/list')) return { ok: true, json: async () => ({ tools: [
        'echo_resolve_analysis_window', 'echo_analyze_session_cohort', 'echo_analyze_judge_criterion',
      ].map(name => ({ name, inputSchema: { type: 'object', properties: {} } })) }) }
      const body = JSON.parse(init.body); requests.push(body)
      return { ok: true, json: async () => body.tool === 'echo_resolve_analysis_window' ? envelope(interval) : evidence(body.tool, body.arguments) }
    },
  })
  const agent = { id: 'native', session: { events: [{ type: 'turn/start', seq: 1 }, { type: 'voidr/project-context-hint', data: hint }] } }
  await command.handler({ agent, rawInput: 'fixture-actor' })
  assert.ok(registered.get('mcp__voidr__echo_resolve_analysis_window').parameters.properties.comparisonLabel)
  assert.ok(registered.has('mcp__voidr__echo_compare_periods'))
  const execute = (name, args) => hooks.get('tools/execute')({ name: `mcp__voidr__${name}`, arguments: args, agent }, noRequest)
  await execute('echo_resolve_analysis_window', { ...resolveArgs, comparisonLabel: 'selected' })
  const result = await execute('echo_compare_periods', comparisonArgs)
  assert.equal(parse(result).complete, true)
  assert.equal(requests.length, 5)
  assert.ok(requests.every(request => request.tool !== 'echo_compare_periods' && request.arguments.comparisonLabel === undefined))
})
