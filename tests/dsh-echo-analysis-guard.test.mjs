import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createEchoAnalysisGuard } from '../adapters/dsh/echo-analysis-guard.mjs'
import { registerEchoActor } from '../adapters/dsh/echo-actor.mjs'
import { loadDshPluginSkills } from '../adapters/dsh/plugin-skills.mjs'

const applicationId = '6a6cfa72d43cf76203eaf843'
const hint = { surface: 'echo', applicationId }
const window = { occurredFrom: '2026-09-14T21:48:18.047Z', occurredToExclusive: '2026-09-15T21:48:18.047Z', timezone: 'America/Sao_Paulo' }
const period = { period: { type: 'rolling_hours', hours: 24 } }
const envelope = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] })
function fixture() {
  const guard = createEchoAnalysisGuard()
  const agent = { id: 'case6', session: { events: [{ type: 'turn/start', seq: 17 }] } }
  const call = (tool, args, invoke, context = hint) => guard.call(agent, tool, args, context, invoke)
  const resolve = () => call('echo_resolve_analysis_window', period, async () => envelope(window))
  return { guard, agent, call, resolve }
}

test('case 6: an empty 24h cohort cannot be replaced with September 14 or another app', async () => {
  const { call, resolve } = fixture()
  await resolve()
  const result = await call('echo_analyze_session_cohort', { applicationId, ...window }, async () => envelope({
    completeness: { complete: true }, data: { interval: window, filters: { applicationId },
      summary: { totalSessions: 0, judgeLifecycle: { officialPass: 0 } } },
  }))
  assert.equal(JSON.parse(result.content[1].text).empty, true)
  const noRequest = () => assert.fail('must reject before transport')
  await assert.rejects(call('echo_analyze_session_cohort', { applicationId, ...window, occurredFrom: '2026-09-14T03:00:00Z' }, noRequest), /interval mismatch/)
  await assert.rejects(call('echo_analyze_session_cohort', { ...window, applicationId: '6a61a47d077f855e0b440b63' }, noRequest), /selected Echo application/)
  await assert.rejects(call('echo_resolve_analysis_window', { period: { type: 'calendar_days', days: 7 } }, noRequest), /fixed until the user/)
  await assert.rejects(call('echo_get_overview', { applicationId, window: '7d' }, noRequest), /relative-window/)
  await assert.rejects(call('echo_list_sessions', { applicationId, limit: 5 }, noRequest), /interval mismatch/)
})

test('improper-transfer summary preserves the resolved window and selected Journey', async () => {
  const { call, resolve } = fixture()
  await resolve()
  const context = { ...hint, moduleSlug: 'vivo-autopilot-info-plano', echoContext: { applicationId, moduleSlug: 'vivo-autopilot-info-plano', environmentSlug: 'principal' } }
  const args = { applicationId, ...window, group: 'improper_transfer', scope: { type: 'journey', moduleSlug: 'vivo-autopilot-info-plano' }, environment: 'principal' }
  const noRequest = () => assert.fail('must reject before transport')
  await assert.rejects(call('echo_summarize_deviation_group', { ...args, scope: { type: 'application' } }, noRequest, context), /selected Echo Journey/)
  await assert.rejects(call('echo_summarize_deviation_group', { ...args, occurredFrom: '2026-09-13T21:48:18.047Z' }, noRequest, context), /interval mismatch/)
  const result = await call('echo_summarize_deviation_group', args, async () => envelope({ data: { totalRecords: 52 } }), context)
  assert.equal(JSON.parse(result.content[0].text).data.totalRecords, 52)
})

test('nonempty report distinguishes two official approvals from zero lifecycle passed', async () => {
  const { call, resolve } = fixture()
  await resolve()
  const data = { interval: window, filters: { applicationId }, summary: {
    totalSessions: 491, sessionLifecycle: { passed: 0 },
    judgeLifecycle: { officialPass: 2, officialFail: 352, officialInconclusive: 20 },
  } }
  const result = await call('echo_analyze_session_cohort', { applicationId, ...window }, async () => envelope({ completeness: { complete: true }, data }))
  const report = JSON.parse(result.content[1].text)
  assert.equal(report.officialEvaluation.approvedSessions, 2)
  assert.equal(report.empty, false)
  assert.deepEqual(report.reportScope, { interval: window, filters: { applicationId } })
  assert.deepEqual(JSON.parse(result.content[0].text).data, data)
})

test('regulatory contract preserves control/count identity and accounts for every critical occurrence', async () => {
  const { call, resolve } = fixture()
  await resolve()
  const controls = [
    ['offer-contract', 'Fornecimento da oferta contratada', 123, 123],
    ['product-info', 'Informação adequada sobre produtos', 79, 79],
    ['offer-consumer', 'Fornecimento da oferta ao consumidor', 23, 23],
    ['refusal', 'Recusa injustificada', 4, 4],
    ['article-31', 'Informações corretas', 4, 4],
    ['protocol', 'Informação do protocolo', 337, 0],
  ].map(([stableId, title, nonCompliantSessions, criticalNonCompliantSessions]) => ({
    stableId, title, nonCompliantSessions, criticalNonCompliantSessions,
  }))
  const result = await call('echo_summarize_regulatory_controls', {
    applicationId, ...window, scope: { type: 'application' },
  }, async () => envelope({ data: {
    totals: { criticalNonCompliantOccurrences: 233 }, controls,
    pagination: { page: 1, limit: 100, total: controls.length, hasMore: false },
  } }))
  const contract = JSON.parse(result.content[1].text)
  assert.equal(contract.kind, 'echo_regulatory_report_contract')
  assert.equal(contract.controlsReturned, 6)
  assert.equal(contract.completeControlList, true)
  assert.equal(contract.derivedCriticalOccurrences, 233)
  assert.equal(contract.criticalTotalMatchesRows, true)
  assert.deepEqual(contract.mostRecurrentControls, [{
    stableId: 'protocol', title: 'Informação do protocolo', nonCompliantSessions: 337,
  }])
  assert.deepEqual(contract.mostRecurrentCriticalControls.map(control => [
    control.stableId, control.criticalNonCompliantSessions,
  ]), [['offer-contract', 123]])
  assert.deepEqual(contract.criticalControls.map(control => [
    control.stableId, control.nonCompliantSessions, control.criticalNonCompliantSessions,
  ]), [
    ['offer-contract', 123, 123],
    ['product-info', 79, 79],
    ['offer-consumer', 23, 23],
    ['refusal', 4, 4],
    ['article-31', 4, 4],
  ])
})

test('regulatory pages cannot produce a false total mismatch or change page size', async () => {
  const { call, resolve } = fixture()
  await resolve()
  const controls = Array.from({ length: 23 }, (_, index) => ({
    stableId: `control-${index + 1}`, title: `Controle ${index + 1}`,
    nonCompliantSessions: 1,
    criticalNonCompliantSessions: ({ 0: 115, 1: 72, 12: 22, 13: 7 })[index] ?? 0,
  }))
  const query = { applicationId, ...window, scope: { type: 'application' }, outcome: 'NON_COMPLIANT' }
  let requests = 0
  const invoke = async args => {
    requests++
    const { page, limit } = args
    return envelope({ data: {
      totals: { criticalNonCompliantOccurrences: 216 },
      controls: controls.slice((page - 1) * limit, page * limit),
      pagination: { page, limit, total: controls.length, hasMore: page * limit < controls.length },
    } })
  }
  const first = await call('echo_summarize_regulatory_controls', { ...query, page: 1, limit: 10 }, invoke)
  const firstContract = JSON.parse(first.content[1].text)
  assert.equal(firstContract.completeControlList, false)
  assert.equal(firstContract.derivedCriticalOccurrences, 187)
  assert.equal(firstContract.returnedCriticalOccurrences, 216)
  assert.equal(firstContract.criticalTotalMatchesRows, null)
  assert.deepEqual(firstContract.mostRecurrentCriticalControls, [])
  await assert.rejects(call('echo_summarize_regulatory_controls', { ...query, page: 2, limit: 13 }, invoke), /keep limit 10/)
  assert.equal(requests, 1)
  const second = await call('echo_summarize_regulatory_controls', { ...query, page: 2, limit: 10 }, invoke)
  const third = await call('echo_summarize_regulatory_controls', { ...query, page: 3, limit: 10 }, invoke)
  assert.equal(requests, 3)
  const returned = [first, second, third].flatMap(result => JSON.parse(result.content[0].text).data.controls)
  assert.equal(returned.length, 23)
  assert.equal(returned.reduce((sum, control) => sum + control.criticalNonCompliantSessions, 0), 216)
})

test('a complete regulatory list still reports a real critical-total mismatch', async () => {
  const { call, resolve } = fixture()
  await resolve()
  const result = await call('echo_summarize_regulatory_controls', {
    applicationId, ...window, scope: { type: 'application' }, page: 1, limit: 100,
  }, async () => envelope({ data: {
    totals: { criticalNonCompliantOccurrences: 216 },
    controls: [{ stableId: 'control-1', title: 'Controle 1', nonCompliantSessions: 1,
      criticalNonCompliantSessions: 215 }],
    pagination: { page: 1, limit: 100, total: 1, hasMore: false },
  } }))
  const contract = JSON.parse(result.content[1].text)
  assert.equal(contract.completeControlList, true)
  assert.equal(contract.criticalTotalMatchesRows, false)
})

test('deviation page contract forbids causal and shared-execution claims from a bounded page', async () => {
  const { call, resolve } = fixture()
  await resolve()
  const result = await call('echo_list_deviations', {
    applicationId,
    occurredFrom: window.occurredFrom,
    occurredTo: '2026-09-15T21:48:18.046Z',
    page: 1,
    limit: 20,
  }, async () => envelope({ data: {
    data: [
      { sessionCode: 'CONOFE-1', code: 'X2', evidenceQuote: 'O sistema não respondeu.' },
      { sessionCode: 'CONOFE-2', code: 'X2', evidenceQuote: 'Vou verificar.' },
    ],
    page: 1,
    pages: 3,
    total: 42,
  } }))
  const contract = JSON.parse(result.content[1].text)
  assert.equal(contract.kind, 'echo_deviation_page_contract')
  assert.equal(contract.returnedRows, 2)
  assert.equal(contract.totalRows, 42)
  assert.equal(contract.completePopulation, false)
  assert.equal(contract.executionIdPresentForEveryRow, false)
  assert.equal(contract.causalConclusionSupported, false)
})

test('concurrent identical resolutions reuse one instant; new user turns allow a new period', async () => {
  const { agent, call } = fixture()
  let reads = 0
  const invoke = async () => { reads++; return envelope(window) }
  await Promise.all([call('echo_resolve_analysis_window', period, invoke), call('echo_resolve_analysis_window', period, invoke)])
  assert.equal(reads, 1)
  agent.session.events.push({ type: 'turn/start', seq: 800 })
  await call('echo_resolve_analysis_window', { period: { type: 'calendar_days', days: 7 } }, invoke)
  assert.equal(reads, 2)
})

test('unavailable/error is not empty, failed resolution can be retried, and disposal clears state', async () => {
  const { guard, agent, call, resolve } = fixture()
  await call('echo_resolve_analysis_window', period, async () => ({ isError: true, content: [] }))
  await resolve()
  for (const result of [{ isError: true, content: [] }, envelope({ data: { available: false } })]) {
    assert.equal(await call('echo_analyze_session_cohort', { applicationId, ...window }, async () => result), result)
  }
  guard.dispose(agent.id)
  await call('echo_resolve_analysis_window', { period: { type: 'calendar_days', days: 7 } }, async () => envelope(window))
})

test('scope, inclusive list bounds, metadata exceptions and helper routing are explicit', async () => {
  const { call, resolve } = fixture()
  const ok = async args => args
  await assert.rejects(call('echo_analyze_session_cohort', { applicationId, ...window }, ok), /Resolve the analysis window/)
  await resolve()
  await assert.rejects(call('echo_analyze_session_cohort', { applicationId, ...window }, ok,
    { ...hint, moduleSlug: 'vivo-autopilot-consulta-debitos' }), /Journey/)
  await assert.rejects(call('system_call_tool', { name: 'echo_analyze_session_cohort', arguments: { applicationId } }, ok), /native Echo tools/)
  await assert.rejects(call('system_run_script', { script: 'ignored' }, ok), /native Echo tools/)
  const list = { applicationId, occurredFrom: window.occurredFrom, occurredTo: '2026-09-15T21:48:18.046Z' }
  assert.deepEqual(await call('echo_list_sessions', list, ok), list)
  assert.deepEqual(await call('echo_get_session', { sessionId: 'exact' }, ok), { sessionId: 'exact' })
})

test('actor direct and widget calls share the same frozen window', async () => {
  const hooks = new Map(), bodies = []
  let command
  const ctx = { on: (name, fn) => hooks.set(name, fn), commands: { register: c => { command = c } }, tools: { register() {} } }
  const invoke = registerEchoActor(ctx, {
    env: { DSH_VOIDR_MCP_URL: 'http://local/mcp', DSH_VOIDR_MCP_AUTHORIZATION: 'Basic test' },
    fetchImpl: async (url, init) => {
      if (url.endsWith('/tools/list')) return { ok: true, json: async () => ({ tools: [{ name: 'echo_resolve_analysis_window', inputSchema: {} }] }) }
      bodies.push(JSON.parse(init.body))
      return { ok: true, json: async () => envelope(window) }
    },
  })
  const agent = { id: 'transport', session: { events: [{ type: 'voidr/project-context-hint', data: hint }, { type: 'turn/start', seq: 17 }] } }
  await command.handler({ agent, rawInput: 'signed-test' })
  await hooks.get('tools/execute')({ name: 'mcp__voidr__echo_resolve_analysis_window', arguments: period, agent }, () => assert.fail())
  await assert.rejects(invoke(agent, 'echo_list_deviations', { applicationId, occurredFrom: '2026-09-01T00:00:00Z', occurredTo: window.occurredToExclusive }), /interval mismatch/)
  assert.equal(bodies.length, 1)
})

test('loaded Echo policy prevents connector detours, empty fallback and status substitution', () => {
  const text = loadDshPluginSkills().find(skill => skill.name === 'voidr-echo-analysis').content
  assert.match(text, /Autopilot is the application, not a connector ID/)
  assert.match(text, /When complete results contain zero sessions, stop/)
  assert.match(text, /sessionLifecycle\.passed=0 and judgeLifecycle\.officialPass=2 means two official/)
  assert.match(text, /Use Portuguese for progress and final text/)
  assert.match(text, /continue immediately/)
  assert.match(text, /not only for an empty period/)
  assert.match(text, /Never ask the user\s+to repeat an already submitted choice/)
  assert.match(text, /For counts, a Journey split and links to failed examples, this tool is sufficient/)
})

function addAnswer(agent, { id = 'period_choice', selected = ['Últimos 7 dias'], custom,
  options = ['Últimos 7 dias'], callId = 'form-one', error = false,
  cancelled = false, tool = 'ask_user_question' } = {}) {
  agent.session.events.push({ type: 'tool/call', data: { callId, name: tool, arguments: JSON.stringify({
    questions: [{ id: 'period_choice', options: options.map(label => ({ label })) }],
  }) } })
  agent.session.events.push({ type: 'tool/result', data: { message: { source: { kind: 'tool', callId }, content: [{
    type: 'tool-result', toolCallId: callId, isError: error,
    ...envelope({ cancelled, answers: [{ id, selected, ...(custom === undefined ? {} : { custom }) }] }),
  }] } } })
}

test('regression: 24h empty -> answered 7d form -> new analysis in the same technical turn', async () => {
  const { agent, call, resolve } = fixture()
  await resolve()
  addAnswer(agent)
  const nextWindow = { ...window, occurredFrom: '2026-09-09T03:00:00.000Z' }
  let queries = 0
  await call('echo_resolve_analysis_window', { period: { type: 'calendar_days', days: 7 } }, async () => envelope(nextWindow))
  await call('echo_analyze_session_cohort', { applicationId, ...nextWindow }, async () => { queries++; return envelope({ data: { available: false } }) })
  assert.equal(queries, 1)
  assert.equal(agent.session.events.filter(e => e.type === 'turn/start').length, 1)
  await assert.rejects(call('echo_resolve_analysis_window', period, () => assert.fail()), /fixed until the user/)
  await assert.rejects(call('echo_analyze_session_cohort', { applicationId, ...window }, () => assert.fail()), /interval mismatch/)
})

test('custom-only answers unlock once; later independently answered forms unlock again', async () => {
  const { agent, call, resolve } = fixture()
  await resolve()
  addAnswer(agent, { selected: [], custom: 'Analise os últimos 30 dias' })
  const next = { period: { type: 'calendar_days', days: 30 } }
  let reads = 0
  await call('echo_resolve_analysis_window', next, async () => { reads++; return envelope(window) })
  await call('echo_resolve_analysis_window', next, () => assert.fail('must reuse resolution'))
  assert.equal(reads, 1)
  addAnswer(agent, { callId: 'form-two' })
  await resolve()
})

test('non-period follow-up keeps the exact resolved window across answered forms', async () => {
  const { agent, call } = fixture()
  const sevenDays = { period: { type: 'calendar_days', days: 7 } }
  let resolutions = 0
  const invoke = async () => { resolutions++; return envelope(window) }
  await call('echo_resolve_analysis_window', sevenDays, invoke)
  addAnswer(agent, { selected: ['Examinar sessões reprovadas'], options: ['Examinar sessões reprovadas'] })
  await call('echo_resolve_analysis_window', sevenDays, invoke)
  assert.equal(resolutions, 1)
  const exact = { applicationId, ...window }
  await assert.rejects(call('echo_list_sessions', {
    applicationId, occurredFrom: '2026-09-13T03:00:00.000Z',
    occurredTo: '2026-09-15T21:48:18.046Z',
  }, () => assert.fail('must reject before transport')), /interval mismatch/)
  await call('echo_analyze_session_cohort', exact, async () => envelope({ data: { available: false } }))
  const criterion = await call('echo_analyze_judge_criterion', {
    ...exact, criterionId: 'intent_understanding', evaluationKind: 'behavior',
  }, async () => envelope({ completeness: { complete: true }, data: {
    interval: window, filters: { criterionId: 'intent_understanding' },
    totals: { evaluatedSessions: 2, failSessions: 1 },
    journeys: { rows: [{ journeyFlowId: 'journey-a', failSessions: 1 }], total: 2, hasMore: true },
    failedSessionSamples: [{ sessionId: 'session-1' }],
  } }))
  const contract = JSON.parse(criterion.content[1].text)
  assert.equal(contract.kind, 'echo_criterion_analysis_contract')
  assert.equal(contract.criterionId, 'intent_understanding')
  assert.equal(contract.failedSessions, 1)
  assert.equal(contract.journeyHasMore, true)
  assert.equal(contract.causalConclusionSupported, false)
  await assert.rejects(call('echo_analyze_judge_criterion', {
    ...exact, occurredFrom: '2026-09-13T03:00:00.000Z', criterionId: 'intent_understanding',
  }, () => assert.fail('must reject before transport')), /interval mismatch/)
  addAnswer(agent, { selected: ['Quebrar por jornada'], options: ['Quebrar por jornada'], callId: 'form-two' })
  await assert.rejects(call('echo_resolve_analysis_window', period, () => assert.fail()), /fixed until the user/)
  await call('echo_analyze_session_cohort', exact, async () => envelope({ data: { available: false } }))
})

test('criterion count requests stop at verified samples unless detail was requested', async () => {
  const result = { completeness: { complete: true }, data: {
    available: true,
    interval: window,
    filters: { criterionId: 'intent_understanding' },
    totals: { evaluatedSessions: 2, failSessions: 1 },
    journeys: { rows: [], total: 0, hasMore: false },
    failedSessionSamples: [{ sessionId: 'session-1' }],
  } }
  const { agent, call, resolve } = fixture()
  agent.session.events.push({ type: 'user/message', data: {
    source: { kind: 'user' }, content: [{ type: 'text',
      text: 'Quantas sessões reprovaram? Quebre por jornada e dê exemplos, sem inferir causa sem evidência.' }],
  } })
  await resolve()
  await call('echo_analyze_judge_criterion', { applicationId, ...window, criterionId: 'intent_understanding' },
    async () => envelope(result))
  await assert.rejects(call('echo_read_evidence', {}, () => assert.fail('must not read evidence')),
    /Return those results now/)
  await assert.rejects(call('echo_get_judge_run', {}, () => assert.fail('must not read judge run')),
    /Return those results now/)

  const detail = fixture()
  detail.agent.session.events.push({ type: 'user/message', data: {
    source: { kind: 'user' }, content: [{ type: 'text',
      text: 'Quantas sessões reprovaram e por que uma sessão falhou? Mostre a evidência.' }],
  } })
  await detail.resolve()
  await detail.call('echo_analyze_judge_criterion', { applicationId, ...window, criterionId: 'intent_understanding' },
    async () => envelope(result))
  await detail.call('echo_read_evidence', {}, async () => envelope({ data: 'exact evidence' }))
})

test('empty, cancelled, errored, unknown-question, fabricated-option and unrelated results stay locked', async () => {
  for (const invalid of [{ selected: [] }, { selected: [], custom: '  ' }, { cancelled: true },
    { error: true }, { id: 'unknown' }, { selected: ['not offered'] }, { tool: 'echo_get_session' }]) {
    const { agent, call, resolve } = fixture()
    await resolve()
    addAnswer(agent, invalid)
    await assert.rejects(call('echo_resolve_analysis_window', { period: { type: 'calendar_days', days: 7 } }, () => assert.fail()), /fixed until the user/)
  }
})

test('a pending or malformed form does not unlock, and another session cannot consume the answer', async () => {
  const { guard, agent, call, resolve } = fixture()
  await resolve()
  addAnswer(agent)
  const other = { id: 'other', session: { events: [{ type: 'turn/start', seq: 17 }] } }
  await guard.call(other, 'echo_resolve_analysis_window', period, hint, async () => envelope(window))
  await assert.rejects(guard.call(other, 'echo_resolve_analysis_window', { period: { type: 'calendar_days', days: 7 } }, hint, () => assert.fail()), /fixed until the user/)
  agent.session.events.pop()
  await assert.rejects(call('echo_resolve_analysis_window', { period: { type: 'calendar_days', days: 7 } }, () => assert.fail()), /fixed until the user/)
  agent.session.events.push({ type: 'tool/result', data: { message: { source: { callId: 'form-one' }, content: [{ type: 'tool-result', toolCallId: 'form-one', content: [{ type: 'text', text: 'invalid JSON' }] }] } } })
  await assert.rejects(call('echo_resolve_analysis_window', { period: { type: 'calendar_days', days: 7 } }, () => assert.fail()), /fixed until the user/)
})
