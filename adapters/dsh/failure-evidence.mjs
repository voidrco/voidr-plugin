import { createHash } from 'node:crypto'
import { createFailureReadWindow, evidenceExcerpt, registerFailureReadPresentation, validateExcerptArguments } from './failure-read-window.mjs'
import { registerFailureReport } from './failure-report.mjs'

const PREFIX = 'mcp__voidr__'
const DETAIL_SOURCES = new Set(['playwright_get_test_timeline', 'playwright_get_trace_events', 'playwright_get_test_dom',
  'playwright_get_test_history', 'test_plans_get_case', 'test_plans_get_tag_history', 'connectors_context_list_active_integrations'])
const sourceFieldPaths = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['$']
  const paths = Object.keys(value).filter(key => /^[A-Za-z0-9_-]+$/.test(key)).slice(0, 12)
  for (const key of [...paths]) {
    const child = Array.isArray(value[key]) ? value[key][0] : value[key]
    if (!child || typeof child !== 'object' || Array.isArray(child)) continue
    for (const field of Object.keys(child)) {
      if (paths.length >= 12) break
      if (/^[A-Za-z0-9_-]+$/.test(field)) paths.push(`${key}${Array.isArray(value[key]) ? '.0' : ''}.${field}`)
    }
  }
  return paths
}
const identity = value => typeof value === 'string' && /^[a-f0-9]{24}$/.test(value)
const countBy = (rows, key) => {
  const counts = new Map()
  for (const row of rows) {
    const value = String(row[key])
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return Object.fromEntries(counts)
}

export function evidencePayload(result) {
  if (result?.isError) throw new Error('Evidence read rejected')
  const value = result?.value ?? result
  if (value?.isError) throw new Error('Evidence read rejected')
  const structured = value?.structuredContent
  if (structured !== undefined) return structured.data ?? structured
  for (const part of value?.content ?? []) {
    if (part.type !== 'text') continue
    try { return JSON.parse(part.text) } catch {}
  }
  throw new Error('Evidence read returned no structured data')
}

export async function resolveEvidence(value, read) {
  if (!value?.artifactId) return value
  if (!/^art_[a-f0-9]{18}$/.test(value.artifactId)) throw new Error('Invalid evidence artifact')
  let reads = 0, items = 0
  const walk = async (path, depth = 0) => {
    if (++reads > 40 || depth > 4) throw new Error('Evidence artifact exceeds bounded hydration')
    const first = await read({ artifactId: value.artifactId, path, offset: 0, limit: 500 })
    if (first.error) throw new Error('Evidence artifact path unavailable')
    if (Array.isArray(first.items)) {
      if (!Number.isSafeInteger(first.total) || first.total < first.items.length || first.offset !== 0)
        throw new Error('Invalid evidence artifact page')
      const rows = [...first.items]
      while (rows.length < first.total) {
        if (++reads > 40 || items + rows.length > 5000) throw new Error('Evidence artifact exceeds bounded hydration')
        const next = await read({ artifactId: value.artifactId, path, offset: rows.length, limit: 500 })
        if (next.total !== first.total || next.offset !== rows.length || !Array.isArray(next.items) || !next.items.length)
          throw new Error('Evidence artifact pagination changed')
        rows.push(...next.items)
      }
      if (rows.length !== first.total || (items += rows.length) > 5000) throw new Error('Evidence artifact item limit exceeded')
      return rows
    }
    if (!Object.hasOwn(first, 'value')) throw new Error('Evidence artifact value unavailable')
    const output = first.value
    if (output && typeof output === 'object' && !Array.isArray(output)) {
      for (const [key, child] of Object.entries(output)) {
        if (child === '{…}' || typeof child === 'string' && /^array\[\d+\]$/.test(child)) {
          if (!/^[A-Za-z0-9_-]+$/.test(key)) throw new Error('Unsupported evidence artifact key')
          output[key] = await walk(path === '$' ? key : `${path}.${key}`, depth + 1)
        }
      }
    }
    return output
  }
  const output = await walk('$')
  if (Buffer.byteLength(JSON.stringify(output)) > 2_000_000) throw new Error('Evidence artifact byte limit exceeded')
  return output
}

function sampledTimeline(value) {
  if (!Array.isArray(value?.steps) || !Array.isArray(value.console) || !Array.isArray(value.network))
    throw new Error('Timeline sections unavailable')
  return {
    steps: value.steps,
    console: { sampledMessages: value.console.length, byLevel: countBy(value.console, 'level'), byMessage: countBy(value.console, 'message') },
    network: { sampledRequests: value.network.length, byStatus: countBy(value.network, 'status'),
      failures: value.network.map((row, sourceRow) => ({ ...row, sourceRow }))
        .filter(row => row.error || Number(row.status) >= 400) },
    stdout: value.stdout, stderr: value.stderr,
    coverage: 'Returned samples only; counts do not establish complete execution coverage.',
  }
}

function failureErrorFacts(value) {
  const text = typeof value === 'string' ? value.replace(/\x1b\[[0-9;]*m/g, '') : ''
  const test = text.match(/^Test timeout of (\d+)ms exceeded/m)
  const assertion = text.match(/Timed out (\d+)ms waiting for expect\(locator\)\./)
  return { kind: test ? 'test-timeout' : assertion ? 'locator-assertion-timeout' : 'other',
    timeoutMs: test || assertion ? Number((test ?? assertion)[1]) : null }
}

export function compactFailureEvidence(bundle) {
  const omissions = []
  const text = (value, limit, path) => {
    if (typeof value !== 'string' || value.length <= limit) return value
    omissions.push({ path, originalCharacters: value.length, returnedCharacters: limit })
    return value.slice(0, limit)
  }
  const pick = (row, keys) => Object.fromEntries(keys.filter(key => row?.[key] !== undefined).map(key => [key, row[key]]))
  const steps = (rows, path) => {
    if (!Array.isArray(rows)) return null
    const failed = new Set(), indices = new Set()
    rows.forEach((row, i) => { if (/fail|error|timed.?out/i.test(row.status ?? '') || row.error) {
      failed.add(i)
      for (let j = Math.max(0, i - 1); j <= Math.min(rows.length - 1, i + 1); j++) indices.add(j)
    } })
    if (!indices.size) for (let i = Math.max(0, rows.length - 4); i < rows.length; i++) indices.add(i)
    const selected = [...new Set([...failed, ...[...indices].filter(i => !failed.has(i)).slice(0, Math.max(0, 12 - failed.size))])].sort((a, b) => a - b)
    if (selected.length !== rows.length) omissions.push({ path, originalRows: rows.length, returnedRows: selected.length })
    return { sampledSteps: rows.length, failedSteps: failed.size, rows: selected.map(sourceRow => ({ sourceRow,
      ...pick(rows[sourceRow], ['stepIndex', 'name', 'status', 'durationMs', 'startedAt', 'selector']),
      error: text(rows[sourceRow].error, 1800, `${path}.${sourceRow}.error`) })) }
  }
  const failures = { ...bundle.failures, selected: bundle.failures.selected.map(row => ({
    ...pick(row, ['sourceRow', 'testCaseSlug', 'title', 'failureSignature', 'startedAt', 'durationMs', 'filePath', 'line', 'selector', 'hasDomSnapshot', 'traceRef', 'screenshotRef']),
    errorMessage: text(row.errorMessage, 2400, `failures.selected.${row.sourceRow}.errorMessage`),
    errorStack: text(row.errorStack, 1000, `failures.selected.${row.sourceRow}.errorStack`),
  })) }
  failures.recordLedger = bundle.failures.selected.map(row => ({ sourceRow: row.sourceRow, startedAt: row.startedAt,
    durationMs: row.durationMs, errorMessage: failureErrorFacts(row.errorMessage), errorStack: failureErrorFacts(row.errorStack) }))
  const original = bundle.evidence, evidence = { ...original }
  if (original.timeline) {
    const network = original.timeline.network
    const seen = new Set()
    const examples = network.failures.filter(row => {
      const key = String(row.status) + ':' + String(row.error)
      if (seen.has(key)) return false
      seen.add(key); return true
    }).slice(0, 6).map(row => ({ ...pick(row, ['sourceRow', 'status', 'method', 'timestampMs']),
      url: text(row.url, 300, `timeline.network.failures.${row.sourceRow}.url`),
      error: text(row.error, 400, `timeline.network.failures.${row.sourceRow}.error`) }))
    evidence.timeline = { steps: steps(original.timeline.steps, 'timeline.steps'), console: original.timeline.console,
      network: { sampledRequests: network.sampledRequests, byStatus: network.byStatus, sampledFailedRequests: network.failures.length,
        examples, examplesCoverage: 'Distinct status/error examples, at most six; not the full failed-request list.' },
      outputCoverage: 'stdout/stderr are not included in this compact view; request a bounded excerpt from the exact timeline source if needed.',
      coverage: original.timeline.coverage }
  }
  if (original.trace) evidence.trace = { steps: steps(original.trace.steps, 'trace.steps'), traceEvidence: original.trace.traceEvidence,
    sampledConsoleMessages: original.trace.console?.length ?? null, sampledNetworkRequests: original.trace.network?.length ?? null,
    detailCoverage: 'Trace console/network/DOM are available from the exact trace source; not repeated in this compact view.' }
  if (original.history) evidence.history = { ...pick(original.history, ['total', 'testCaseSlug', 'planId']),
    returnedRecords: original.history.rows.length, byStatus: countBy(original.history.rows, 'status'),
    rows: original.history.rows.map((row, sourceRow) => ({ sourceRow,
      ...pick(row, ['executionId', 'status', 'retry', 'durationMs', 'startedAt']),
      errorSummary: text(row.errorSummary, 350, `history.rows.${sourceRow}.errorSummary`) }))
      .filter((row, i, rows) => !/^passed$/i.test(row.status ?? '') || i === 0 || i === rows.length - 1),
    rowsCoverage: 'All non-passing records plus first/last returned record. byStatus counts every returned history record; rows are not the full series.' }
  if (original.tagHistory) {
    const rows = original.tagHistory.data ?? original.tagHistory.rows ?? []
    evidence.tagHistory = { ...pick(original.tagHistory, ['total', 'page', 'limit', 'pages']), returnedRecords: rows.length,
      rows: rows.map(row => pick(row, ['from_tag', 'to_tag', 'origin', 'created_at', 'caseDeleted'])) }
  }
  const result = { ...bundle, execution: pick(bundle.execution, ['executionId', 'applicationId', 'planId', 'environment', 'provider', 'status', 'startedAt', 'finishedAt', 'durationMs', 'totalTests', 'passedCount', 'failedCount', 'flakyCount', 'timedOutCount']),
    failures, evidence, view: { kind: 'compact', omissions, instruction: 'This view is not the full source payload. For a concrete unresolved question, read the exact source and scope listed in sources. Never infer absence from an omitted field or treat a prefix as complete text.' } }
  for (const key of ['tagHistory', 'dom', 'testCase']) {
    if (JSON.stringify(result).length <= 38_000) break
    if (evidence[key] !== null && evidence[key] !== undefined) {
      evidence[key] = { detailOmitted: true, reason: 'Compact view size limit; read this exact authorized source if needed.' }
      omissions.push({ path: `evidence.${key}`, reason: 'View size limit' })
    }
  }
  if (JSON.stringify(result).length > 38_000) throw new Error('Evidence exceeds compact view size; use the exact individual source tools')
  return result
}

export async function collectFailureEvidence({ executionId, testCaseSlug }, read, { signal, now = Date.now } = {}) {
  if (!identity(executionId) || typeof testCaseSlug !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(testCaseSlug))
    throw new Error('An exact executionId and testCaseSlug are required')
  signal?.throwIfAborted()
  const sources = [], gaps = [], startedAt = now()
  const call = async (name, args) => {
    signal?.throwIfAborted()
    const started = now()
    const value = await read(name, args, signal)
    signal?.throwIfAborted()
    sources.push({ name, arguments: args, elapsedMs: now() - started,
      sha256: createHash('sha256').update(JSON.stringify(value)).digest('hex'),
      ...(DETAIL_SOURCES.has(name) ? { fieldPaths: sourceFieldPaths(value) } : {}) })
    return value
  }
  const optional = async (name, args, validate = value => value) => {
    try { return validate(await call(name, args)) }
    catch (error) {
      signal?.throwIfAborted()
      gaps.push({ name, reason: 'Read unavailable or returned an invalid scope/shape; no empty-result inference is allowed.' })
      return null
    }
  }
  const analytics = await call('playwright_get_execution_analytics', { executionId })
  if (analytics?.executionId !== executionId || !identity(analytics.applicationId) || !identity(analytics.planId))
    throw new Error('Execution identity was not validated')
  const scope = { executionId, applicationId: analytics.applicationId, planId: analytics.planId, testCaseSlug }
  const rows = []
  let total, complete = false
  for (let page = 1; page <= 10; page++) {
    const value = await call('playwright_list_execution_failures', { executionId, page, limit: 200 })
    if (!Array.isArray(value?.rows) || !Number.isSafeInteger(value.total) || value.total < 0 ||
      value.page !== page || value.limit !== 200 || value.rows.length > 200 ||
      total !== undefined && total !== value.total) throw new Error('Failure pagination changed or was invalid')
    total = value.total
    rows.push(...value.rows)
    if (rows.length > total) throw new Error('Failure pagination exceeded its declared total')
    if (rows.length === total) { complete = true; break }
    if (!value.rows.length) break
  }
  if (!complete) throw new Error('Complete failure pagination is required before selecting a case')
  const selected = rows.map((row, sourceRow) => ({ ...row, sourceRow })).filter(row => row.testCaseSlug === testCaseSlug)
  if (!selected.length) throw new Error('The selected case has no recorded failure in this execution')
  const args = { executionId, testCaseSlug }
  const tasks = [
    ['application', () => optional('applications_get_application', { applicationId: scope.applicationId }, value => {
      if (value?._id !== scope.applicationId && value?.id !== scope.applicationId) throw new Error('Application scope mismatch')
      return value
    })],
    ['timeline', () => optional('playwright_get_test_timeline', { ...args, limit: 500 }, sampledTimeline)],
    ['trace', () => optional('playwright_get_trace_events', { ...args, limit: 200 })],
    ['history', () => optional('playwright_get_test_history', { applicationId: scope.applicationId, planId: scope.planId, testCaseSlug, limit: 25 }, value => {
      if (!Array.isArray(value?.rows) || value.testCaseSlug !== testCaseSlug || value.planId !== scope.planId ||
        value.rows.some(row => row.planId !== scope.planId || row.applicationId !== scope.applicationId)) throw new Error('History scope mismatch')
      return value
    })],
    ['dom', () => optional('playwright_get_test_dom', { ...args, limit: 12 })],
    ['mapping', async () => {
      for (let page = 1; page <= 10; page++) {
        const result = await optional('playwright_list_test_results', { executionId, page, limit: 200 })
        if (!Array.isArray(result?.rows) || result.page !== page || result.limit !== 200 || !Number.isSafeInteger(result.total)) return null
        const row = result.rows.find(row => row.testCaseSlug === testCaseSlug)
        if (row?.moduleSlug && row.suiteSlug) return { moduleSlug: row.moduleSlug, suiteSlug: row.suiteSlug }
        if (!result.rows.length || page * 200 >= result.total) return null
      }
      return null
    }],
    ['integrations', () => optional('connectors_context_list_active_integrations', {})],
  ]
  const evidence = {}
  let cursor = 0
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (cursor < tasks.length) {
      const [name, task] = tasks[cursor++]
      evidence[name] = await task()
    }
  }))
  if (evidence.mapping) evidence.testCase = await optional('test_plans_get_case', { planId: scope.planId, ...evidence.mapping, caseSlug: testCaseSlug })
  else gaps.push({ name: 'test_plans_get_case', reason: 'Module/suite mapping was not resolved; expected behavior is unverified.' })
  evidence.tagHistory = await optional('test_plans_get_tag_history', { planId: scope.planId, caseSlug: testCaseSlug, page: 1, limit: 20 })
  signal?.throwIfAborted()
  return { scope, execution: analytics, failures: { totalRecords: rows.length,
    distinctCases: Object.keys(countBy(rows, 'testCaseSlug')).length, recordsByCase: countBy(rows, 'testCaseSlug'), selected, complete },
    evidence, gaps, sources, elapsedMs: now() - startedAt,
    rules: [
      'The bounded initial evidence pass is complete. Answer the current question from observed failures and explicit gaps. Distinguish the observed failure mechanism from its unconfirmed underlying cause; propose a specific follow-up when the cause cannot be established. Do not repeat successful initial reads merely to obtain larger dumps.',
      'Every selected source row is a separate record; never deduplicate signatures or infer retry/project indices.',
      'Preserve each record’s startedAt, durationMs, errorMessage and errorStack associations; conflicting fields remain separate.',
      'Console and HTTP counts describe samples, not root cause; a DOM snapshot does not prove continuous visibility during an assertion.',
      'A passing later run does not exclude an intermittent application defect. Confirm a cause only with supporting evidence and an established contract.',
      'Unavailable sources are gaps, not empty results. External connector logs remain a separate bounded read when required.',
    ] }
}

export function registerFailureEvidence(ctx) {
  const window = createFailureReadWindow()
  registerFailureReadPresentation(ctx, window)
  ctx.tools.register({
    name: 'failure_analysis_read_bundle',
    description: 'Read the evidence for one exact failed test in an execution through the existing authorized tools. Validates execution identity, reads every failure page, preserves all matching records and gathers timeline, trace, plan-scoped history, DOM, Test Plan mapping/case and tag history with at most three concurrent reads. Returns source hashes and explicit gaps. Read-only; does not diagnose, modify data or run tests.',
    parameters: { type: 'object', additionalProperties: false, properties: {
      executionId: { type: 'string', pattern: '^[a-f0-9]{24}$' },
      testCaseSlug: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$' },
    }, required: ['executionId', 'testCaseSlug'] },
    output: { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: async (args, exec) => {
      if (Object.keys(args).some(key => !['executionId', 'testCaseSlug'].includes(key))) throw new Error('Unexpected evidence arguments')
      const signal = exec.signal ? AbortSignal.any([exec.signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000)
      let sequence = 0
      const state = window.begin(exec.agent)
      try {
        const value = compactFailureEvidence(await collectFailureEvidence(args, async (name, arguments_, signal) => {
          const dispatch = async (tool, arguments_) => evidencePayload(await ctx.tools.execute({
            callId: `${exec.callId}:evidence:${++sequence}`, rootCallId: exec.rootCallId,
            name: PREFIX + tool, arguments: arguments_, agent: exec.agent, parent: exec.token, signal }))
          return resolveEvidence(await dispatch(name, arguments_), args => dispatch('artifacts_read', args))
        }, { signal }))
        window.complete(exec.agent, state, value)
        return value
      } catch (error) { window.fail(exec.agent, state); throw error }
    },
  })
  ctx.tools.register({
    name: 'failure_analysis_read_detail',
    description: 'Read a bounded excerpt for one concrete unanswered question after a successful failure evidence bundle. Reuses the exact authorized source arguments and calls the original tool again under current permissions. Choose a field path and optional literal filter instead of requesting a complete timeline or trace dump. At most three detail reads per turn; expand an exact tool for a justified deeper investigation.',
    parameters: { type: 'object', additionalProperties: false, properties: {
      executionId: { type: 'string', pattern: '^[a-f0-9]{24}$' }, testCaseSlug: { type: 'string' },
      source: { type: 'string', enum: ['playwright_get_test_timeline', 'playwright_get_trace_events', 'playwright_get_test_dom', 'playwright_get_test_history', 'test_plans_get_case', 'test_plans_get_tag_history', 'connectors_context_list_active_integrations'] },
      question: { type: 'string', minLength: 12, maxLength: 400 },
      path: { type: 'string', default: '$', description: 'Use a fieldPaths entry from this source descriptor, such as steps or snapshots.0.html. These refer to the original source, not the compact evidence.trace or evidence.timeline wrapper. An optional $. prefix is accepted. No JSONPath expressions or wildcards.' }, contains: { type: 'string', maxLength: 120 },
      offset: { type: 'integer', minimum: 0, default: 0 }, limit: { type: 'integer', minimum: 1, maximum: 50, default: 12 },
    }, required: ['executionId', 'testCaseSlug', 'source', 'question', 'path'] },
    output: { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: async (args, exec) => {
      if (typeof args.question !== 'string' || args.question.trim().length < 12 || args.question.length > 400 ||
        Object.keys(args).some(key => !['executionId', 'testCaseSlug', 'source', 'question', 'path', 'contains', 'offset', 'limit'].includes(key)))
        throw new Error('Name one concrete unresolved question using only the declared excerpt arguments')
      validateExcerptArguments(args)
      const source = window.reserve(exec.agent, args)
      const signal = exec.signal ? AbortSignal.any([exec.signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000)
      signal.throwIfAborted()
      let sequence = 0
      const dispatch = async (name, arguments_) => evidencePayload(await ctx.tools.execute({
        callId: `${exec.callId}:detail:${++sequence}`, rootCallId: exec.rootCallId,
        name: PREFIX + name, arguments: arguments_, agent: exec.agent, parent: exec.token, signal }))
      const value = await resolveEvidence(await dispatch(source.name, source.arguments), args => dispatch('artifacts_read', args))
      signal.throwIfAborted()
      const serialized = JSON.stringify(value)
      if (Buffer.byteLength(serialized) > 2_000_000) throw new Error('Evidence source exceeds the bounded detail limit')
      const sha256 = createHash('sha256').update(serialized).digest('hex')
      return { scope: { executionId: args.executionId, testCaseSlug: args.testCaseSlug }, question: args.question,
        source: { ...source, collectedSha256: source.sha256, sha256, changedSinceCollection: sha256 !== source.sha256 }, ...evidenceExcerpt(value, args) }
    },
  })
  registerFailureReport(ctx, window)
  return window
}
