const RESOLVE = 'echo_resolve_analysis_window'
const EXACT = new Set(['echo_analyze_session_cohort', 'echo_analyze_judge_criterion', 'echo_summarize_regulatory_controls', 'echo_summarize_deviation_group'])
const LISTS = new Set(['echo_list_sessions', 'echo_list_deviations'])
const RELATIVE = new Set(['echo_get_overview', 'echo_get_deviation_summary'])
const REGULATORY = 'echo_summarize_regulatory_controls'
const DEVIATIONS = 'echo_list_deviations'
const CRITERION = 'echo_analyze_judge_criterion'
const CRITERION_DETAIL = new Set(['echo_get_judge_run', 'echo_read_evidence'])

function criterionSummaryRequest(events, startIndex) {
  const message = events.slice(startIndex + 1).find(event =>
    event.type === 'user/message' && event.data?.source?.kind === 'user')
  const text = message?.data?.content?.filter(item => item.type === 'text')
    .map(item => item.text).join(' ') ?? ''
  const request = text
    .replace(/\bsem\s+(?:inferir|afirmar|concluir|tirar)\s+(?:causas?|conclus[õo]es?\s+causais?)(?:\s+sem\s+evid[eê]ncia)?/giu, '')
    .replace(/\bn[aã]o\s+tire\s+conclus[õo]es?\s+causais?/giu, '')
  return /\b(?:quantas?|contagem|total|n[uú]mero|quebre|distribui[cç][aã]o)\b/iu.test(request) &&
    !/\b(?:por\s*qu[êe]|porque|causa|motivo|raz[aã]o|explic(?:a|ar)|evid[eê]ncia|trecho|transcri[cç][aã]o|why|cause|reason|explain|rationale)\b/iu.test(request)
}

function payload(result) {
  if (result.isError) return null
  try { return JSON.parse(result.content?.find(item => item.type === 'text')?.text) }
  catch { return null }
}

function appendContract(result, contract) {
  return {
    ...result,
    content: [...(result.content ?? []), { type: 'text', text: JSON.stringify(contract) }]
  }
}

function regulatoryContract(evidence) {
  const data = evidence?.data
  const controls = Array.isArray(data?.controls) ? data.controls : []
  if (!controls.length) return null
  const pagination = data.pagination
  const completeControlList = pagination?.page === 1 && pagination.hasMore === false &&
    pagination.total === controls.length
  const criticalControls = controls
    .filter(control => Number(control.criticalNonCompliantSessions) > 0)
    .map(control => ({
      stableId: control.stableId,
      title: control.title,
      nonCompliantSessions: Number(control.nonCompliantSessions),
      criticalNonCompliantSessions: Number(control.criticalNonCompliantSessions)
    }))
  const derivedCriticalOccurrences = criticalControls.reduce(
    (total, control) => total + control.criticalNonCompliantSessions,
    0
  )
  const maxNonCompliantSessions = Math.max(
    ...controls.map(control => Number(control.nonCompliantSessions) || 0)
  )
  const maxCriticalOccurrences = Math.max(
    0,
    ...criticalControls.map(control => control.criticalNonCompliantSessions)
  )
  const mostRecurrentControls = controls
    .filter(control => Number(control.nonCompliantSessions) === maxNonCompliantSessions)
    .map(control => ({
      stableId: control.stableId,
      title: control.title,
      nonCompliantSessions: Number(control.nonCompliantSessions)
    }))
  const mostRecurrentCriticalControls = criticalControls
    .filter(control => control.criticalNonCompliantSessions === maxCriticalOccurrences)
  return {
    kind: 'echo_regulatory_report_contract',
    controlsReturned: controls.length,
    totalControls: pagination?.total,
    completeControlList,
    criticalControls,
    returnedCriticalOccurrences: data.totals?.criticalNonCompliantOccurrences,
    derivedCriticalOccurrences,
    mostRecurrentControls: completeControlList ? mostRecurrentControls : [],
    mostRecurrentCriticalControls: completeControlList ? mostRecurrentCriticalControls : [],
    criticalTotalMatchesRows: completeControlList
      ? derivedCriticalOccurrences === Number(data.totals?.criticalNonCompliantOccurrences)
      : null,
    instruction: 'Treat every stableId/title/count tuple as atomic. Never move a count to another control or replace an exact count with a nearby row. ' +
      (completeControlList
        ? 'The complete list can be compared with the global critical total. Rank only exact returned values, including ties. If totals differ, report the inconsistency.'
        : 'These rows are one page, while returnedCriticalOccurrences is global. Do not compare them, claim an inconsistency, or rank the entire control set. Keep the same limit on every page. If the native widget already published the complete list, use its validated totals.'),
  }
}

function regulatoryQueryKey(args) {
  return JSON.stringify([args.applicationId, args.occurredFrom, args.occurredToExclusive,
    args.timezone ?? 'America/Sao_Paulo', args.scope?.type, args.scope?.moduleSlug,
    args.outcome ?? 'NON_COMPLIANT'])
}

function deviationContract(evidence) {
  const page = evidence?.data
  const rows = Array.isArray(page?.data) ? page.data : []
  if (!rows.length && !Number.isFinite(Number(page?.total))) return null
  const total = Number(page.total)
  const pages = Number(page.pages)
  const executionIdPresentForEveryRow = rows.length > 0 &&
    rows.every(row => typeof row.executionId === 'string' && row.executionId.length > 0)
  return {
    kind: 'echo_deviation_page_contract',
    page: Number(page.page),
    pages,
    returnedRows: rows.length,
    totalRows: total,
    completePopulation: Number.isFinite(total) && Number.isFinite(pages) &&
      pages <= 1 && rows.length === total,
    executionIdPresentForEveryRow,
    causalConclusionSupported: false,
    instruction: 'A deviation page reports classified observations, not root cause. evidenceQuote is evidence attached to that deviation, not proof of why it happened. Timestamp proximity is correlation. Do not claim an outage, dependency failure, shared execution, parallel execution or population-wide explanation unless a separate exact read returns that property for every cited session. State the inspected page coverage and present any cause only as a hypothesis.'
  }
}

function latestAnsweredQuestion(events, startIndex) {
  for (let i = events.length - 1; i > startIndex; i--) {
    const event = events[i]
    if (event.type !== 'tool/result') continue
    const message = event.data?.message
    const callId = message?.source?.callId
    if (!callId) continue
    const call = events.slice(startIndex + 1, i).findLast(item =>
      item.type === 'tool/call' && item.data?.callId === callId && item.data.name === 'ask_user_question')
    if (!call) continue
    try {
      const args = typeof call.data.arguments === 'string' ? JSON.parse(call.data.arguments) : call.data.arguments
      const result = message.content?.find(item => item.type === 'tool-result' && item.toolCallId === callId)
      if (!result || result.isError) continue
      const response = payload(result)
      if (!response || response.cancelled || response.canceled || !Array.isArray(response.answers)) continue
      const answers = response.answers.flatMap(answer => {
        const question = args.questions?.find(q => q.id === answer.id)
        if (!question) return []
        const custom = typeof answer.custom === 'string' ? answer.custom.trim() : ''
        const selected = Array.isArray(answer.selected) &&
          answer.selected.every(value => question.options?.some(option => option.label === value))
          ? answer.selected : []
        return custom || selected.length ? [...selected, custom].filter(Boolean) : []
      })
      if (answers.length) return { callId, periodChange: answers.some(value =>
        /\b(?:últim[oa]s?|last|hoje|ontem|today|yesterday|per[ií]odo|datas?|dias?|horas?|semanas?|\d+[hdw])\b/iu.test(value)) }
    } catch { /* Malformed results are not user instructions. */ }
  }
  return null
}

export function createEchoAnalysisGuard() {
  const states = new Map()
  return {
    dispose: id => states.delete(id),
    async call(agent, tool, args, hint, invoke) {
      const events = agent.session.events
      const startIndex = events.findLastIndex(event => event.type === 'turn/start')
      const start = events[startIndex]
      const turn = start?.seq ?? start?.time ?? start?.data?.turn
      const answer = latestAnsweredQuestion(events, startIndex)
      let state = states.get(agent.id)
      if (!state || state.turn !== turn) {
        state = { turn, answer: answer?.callId ?? null }
        states.set(agent.id, state)
      } else if (state.answer !== (answer?.callId ?? null)) {
        state = answer?.periodChange
          ? { turn, answer: answer.callId }
          : { ...state, answer: answer?.callId ?? null, criterionSummaryOnly: false }
        states.set(agent.id, state)
      }
      if (state.criterionSummaryOnly && CRITERION_DETAIL.has(tool)) {
        throw new Error('The exact criterion report already provides counts, Journey totals and verified failed-session examples. Return those results now; inspect judge runs or evidence only after an explicit request to explain a failure or quote its evidence.')
      }
      if ((tool === 'system_call_tool' && args.name?.startsWith('echo_')) ||
          (state.resolution && ['system_batch_execute', 'system_run_script'].includes(tool))) {
        throw new Error('Use the native Echo tools so the analysis interval can be checked; do not route this report through generic execution tools.')
      }
      if (tool === RESOLVE) {
        const key = JSON.stringify([args.period?.type, args.period?.days, args.period?.hours,
          args.period?.from, args.period?.to, args.timezone ?? 'America/Sao_Paulo'])
        if (state.resolution) {
          if (state.key !== key) throw new Error('Echo analysis period is fixed until the user supplies a new instruction. Ask for the intended period and continue after the answered form; do not replace an empty result autonomously.')
          return state.resolution
        }
        state.key = key
        state.resolution = Promise.resolve().then(() => invoke(args)).then(result => {
          const window = payload(result)
          if (!window || !Number.isFinite(Date.parse(window.occurredFrom)) ||
              !Number.isFinite(Date.parse(window.occurredToExclusive))) {
            state.resolution = undefined
            return result
          }
          state.window = window
          return result
        }).catch(error => { state.resolution = undefined; throw error })
        return state.resolution
      }
      if (!EXACT.has(tool) && !LISTS.has(tool) && !RELATIVE.has(tool)) return invoke(args)
      const selected = hint.applicationId ?? hint.echoContext?.applicationId
      const moduleSlug = hint.moduleSlug ?? hint.echoContext?.moduleSlug
      const environment = hint.echoContext?.environmentSlug
      if (selected && args.applicationId !== selected) throw new Error('Keep the selected Echo application; change the screen and send a new message to switch applications.')
      if (['echo_analyze_session_cohort', 'echo_analyze_judge_criterion'].includes(tool) &&
          ((moduleSlug && args.moduleSlug !== moduleSlug) || (environment && args.environment !== environment))) {
        throw new Error('Keep the selected Echo Journey and environment in the analytical query.')
      }
      if (tool === 'echo_summarize_deviation_group' &&
          ((moduleSlug && args.scope && (args.scope.type !== 'journey' || args.scope.moduleSlug !== moduleSlug)) ||
            (environment && args.environment !== environment))) {
        throw new Error('Keep the selected Echo Journey and environment in the deviation group query.')
      }
      if (['echo_analyze_session_cohort', 'echo_analyze_judge_criterion', 'echo_summarize_deviation_group'].includes(tool) && !state.resolution) {
        throw new Error('Resolve the analysis window before querying this cohort; reuse its exact boundaries.')
      }
      if (state.resolution) {
        await state.resolution
        const window = state.window
        if (!window) throw new Error('Analysis window unavailable; do not invent dates or report an empty cohort.')
        if (RELATIVE.has(tool)) {
          throw new Error('A relative-window tool cannot reuse the frozen interval. Use echo_analyze_session_cohort for this analysis; do not mix independently timed KPI reads.')
        }
        const to = LISTS.has(tool) ? args.occurredTo : args.occurredToExclusive
        const expectedTo = LISTS.has(tool) ? Date.parse(window.occurredToExclusive) - 1 : Date.parse(window.occurredToExclusive)
        if (Date.parse(args.occurredFrom) !== Date.parse(window.occurredFrom) || Date.parse(to) !== expectedTo ||
            (args.timezone && args.timezone !== window.timezone)) {
          throw new Error('Echo interval mismatch. Reuse the resolved occurredFrom/occurredToExclusive; inclusive list occurredTo must be one millisecond before the exclusive end. Do not expand an empty period.')
        }
      }
      const regulatoryKey = tool === REGULATORY ? regulatoryQueryKey(args) : null
      if (regulatoryKey && Number(args.page ?? 1) > 1) {
        const previousLimit = state.regulatoryPageSizes?.get(regulatoryKey)
        if (previousLimit !== undefined && Number(args.limit) !== previousLimit) {
          throw new Error(`Echo regulatory pagination must keep limit ${previousLimit} on every page. Retry this page with that limit; no query was sent.`)
        }
      }
      const result = await invoke(args)
      const evidence = payload(result)
      if (tool === REGULATORY) {
        const pagination = evidence?.data?.pagination
        if (pagination?.page === 1 && Number.isSafeInteger(pagination.limit)) {
          state.regulatoryPageSizes ??= new Map()
          state.regulatoryPageSizes.set(regulatoryKey, pagination.limit)
        }
        const contract = regulatoryContract(evidence)
        return contract ? appendContract(result, contract) : result
      }
      if (tool === DEVIATIONS) {
        const contract = deviationContract(evidence)
        return contract ? appendContract(result, contract) : result
      }
      if (tool === CRITERION && evidence?.data?.totals && evidence.data.available !== false) {
        state.criterionSummaryOnly = criterionSummaryRequest(events, startIndex)
        return appendContract(result, {
          kind: 'echo_criterion_analysis_contract',
          criterionId: evidence.data.filters?.criterionId,
          interval: evidence.data.interval,
          evaluatedSessions: evidence.data.totals.evaluatedSessions,
          failedSessions: evidence.data.totals.failSessions,
          failedSamplesReturned: evidence.data.failedSessionSamples?.length ?? 0,
          journeyRowsReturned: evidence.data.journeys?.rows?.length ?? 0,
          journeyTotal: evidence.data.journeys?.total,
          journeyHasMore: evidence.data.journeys?.hasMore,
          causalConclusionSupported: false,
          instruction: 'These samples have FAIL for this exact criterion in their current judge run; they are not generic deviation sessions. Global totals are complete only when completeness.complete is true. Samples and journey rows may be bounded. For counts, Journey split and example links, return this report without more reads. A negative instruction not to infer cause does not request causal investigation. Criterion outcome alone does not show NLU accuracy, causal stage or root cause. Inspect exact judge run and evidence only when explicitly asked to explain an individual failure; do not generalize an example to the population.'
        })
      }
      if (tool !== 'echo_analyze_session_cohort') return result
      if (!evidence?.data?.summary || evidence.data.available === false) return result
      const data = evidence.data
      return appendContract(result, {
        reportScope: { interval: data.interval, filters: data.filters },
        officialEvaluation: {
          approvedSessions: data.summary.judgeLifecycle?.officialPass,
          failedSessions: data.summary.judgeLifecycle?.officialFail,
          inconclusiveSessions: data.summary.judgeLifecycle?.officialInconclusive,
        },
        empty: evidence.completeness?.complete === true && data.summary.totalSessions === 0,
        instruction: 'Use only this reportScope for these counts. Official approvals are not sessionLifecycle.passed. A complete empty cohort must not trigger another period or application.',
      })
    },
  }
}
