/** @typedef {{label: string, occurredFrom: string, occurredToExclusive: string}} Period */
/** @typedef {{applicationId: string, environment?: string, moduleSlug?: string, timezone: string, periods: Period[], criteria?: {criterionId: string, evaluationKind?: string}[]}} ComparisonArgs */
/** @typedef {{content?: {type: string, text?: string}[], isError?: boolean}} ToolResult */
/** @typedef {(tool: string, args: Record<string, unknown>) => Promise<ToolResult>} ReadTool */

export const COMPARISON_TOOL = 'echo_compare_periods'
export const comparisonSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    applicationId: { type: 'string', pattern: '^[a-f\\d]{24}$' },
    environment: { type: 'string', minLength: 1 }, moduleSlug: { type: 'string', minLength: 1 },
    timezone: { type: 'string', minLength: 1 },
    periods: { type: 'array', minItems: 2, maxItems: 2, items: {
      type: 'object', additionalProperties: false,
      properties: { label: { type: 'string', minLength: 1, maxLength: 80 },
        occurredFrom: { type: 'string', format: 'date-time' }, occurredToExclusive: { type: 'string', format: 'date-time' } },
      required: ['label', 'occurredFrom', 'occurredToExclusive'],
    } },
    criteria: { type: 'array', maxItems: 5, items: {
      type: 'object', additionalProperties: false,
      properties: { criterionId: { type: 'string', pattern: '^[a-z\\d][a-z\\d_-]*$' },
        evaluationKind: { type: 'string', enum: ['behavior', 'customer_scorecard', 'knowledge', 'regulatory'] } },
      required: ['criterionId'],
    } },
  }, required: ['applicationId', 'timezone', 'periods'],
}

/** @param {unknown} pass @param {unknown} fail */
function calculateRate(pass, fail) {
  if (!Number.isSafeInteger(pass) || !Number.isSafeInteger(fail) || pass < 0 || fail < 0) return null
  const denominator = pass + fail
  return { numerator: pass, denominator, percent: denominator ? 100 * pass / denominator : null }
}

/** @param {number | null | undefined} before @param {number | null | undefined} after */
function calculateDelta(before, after) {
  return typeof before === 'number' && typeof after === 'number' && Number.isFinite(before) && Number.isFinite(after)
    ? after - before : null
}

/** @param {ReadTool} read @param {string} tool @param {Record<string, unknown>} args */
async function readEvidence(read, tool, args) {
  const result = await read(tool, args)
  if (result.isError) throw new Error('Echo comparison read failed; no comparison was produced.')
  const evidence = JSON.parse(result.content?.find(item => item.type === 'text')?.text ?? 'null')
  if (!evidence?.data || evidence.data.available === false) throw new Error('Echo comparison data unavailable; do not treat it as an empty period.')
  const interval = evidence.data.interval
  if (Date.parse(interval?.occurredFrom) !== Date.parse(String(args.occurredFrom)) ||
      Date.parse(interval?.occurredToExclusive) !== Date.parse(String(args.occurredToExclusive)) ||
      interval?.timezone !== args.timezone) throw new Error('Echo comparison returned a different interval; no comparison was produced.')
  return evidence
}

/** @param {ComparisonArgs} args @param {Period} period @param {ReadTool} read */
async function readPeriod(args, period, read) {
  const query = { applicationId: args.applicationId, timezone: args.timezone,
    ...(args.environment ? { environment: args.environment } : {}), ...(args.moduleSlug ? { moduleSlug: args.moduleSlug } : {}),
    occurredFrom: period.occurredFrom, occurredToExclusive: period.occurredToExclusive }
  const cohort = await readEvidence(read, 'echo_analyze_session_cohort', { ...query, bucket: 'day' })
  const criteria = []
  for (const criterion of args.criteria ?? []) {
    const evidence = await readEvidence(read, 'echo_analyze_judge_criterion', { ...query, criterionId: criterion.criterionId, evaluationKind: criterion.evaluationKind ?? 'behavior', sampleLimit: 1, top: 1 })
    criteria.push({ criterionId: criterion.criterionId, evaluationKind: criterion.evaluationKind ?? 'behavior',
      evidence, conclusiveSuccessRate: calculateRate(evidence.data.totals?.passSessions, evidence.data.totals?.failSessions) })
  }
  const judge = cohort.data.summary?.judgeLifecycle
  return { label: period.label, cohort, criteria,
    officialConclusiveSuccessRate: calculateRate(judge?.officialPass, judge?.officialFail) }
}

/** @param {ComparisonArgs} args */
function validateComparison(args) {
  if (!Array.isArray(args.periods) || args.periods.length !== 2 ||
      args.periods.some(period => typeof period.label !== 'string' || !period.label.trim() || period.label.length > 80 ||
        !(Date.parse(period.occurredFrom) < Date.parse(period.occurredToExclusive))) ||
      args.periods[0].label === args.periods[1].label) throw new Error('Comparison requires two distinct labels and valid exclusive intervals.')
  if (args.criteria !== undefined && (!Array.isArray(args.criteria) || args.criteria.length > 5 ||
      args.criteria.some(criterion => !/^[a-z\d][a-z\d_-]*$/.test(criterion.criterionId)))) throw new Error('Invalid comparison criteria.')
}

/** @param {ComparisonArgs} args @param {ReadTool} read */
export async function compareEchoPeriods(args, read) {
  validateComparison(args)
  const before = await readPeriod(args, args.periods[0], read)
  const after = await readPeriod(args, args.periods[1], read)
  const complete = [before, after].every(period => period.cohort.completeness?.complete === true &&
    period.criteria.every(criterion => criterion.evidence.completeness?.complete === true))
  const report = { kind: 'echo_period_comparison', complete, periods: [before, after],
    deltaDirection: 'second minus first',
    officialSuccessRateDeltaPercentagePoints: complete ? calculateDelta(before.officialConclusiveSuccessRate?.percent, after.officialConclusiveSuccessRate?.percent) : null,
    criterionDeltas: complete ? before.criteria.map((criterion, index) => ({ criterionId: criterion.criterionId,
      evaluationKind: criterion.evaluationKind, conclusiveSuccessRateDeltaPercentagePoints:
        calculateDelta(criterion.conclusiveSuccessRate?.percent, after.criteria[index].conclusiveSuccessRate?.percent) })) : [],
    instruction: 'Each cohort and criterion was read separately for its labeled interval. Use the returned numerators, denominators and percentage-point deltas. Inconclusive results are excluded from conclusive rates and must be reported separately. Do not substitute lifecycle status or evaluatedSessions for that denominator. Latency exists only at the scope of each returned cohort; never infer daily latency from a multi-day aggregate. If incomplete, report coverage limitations; no population-wide comparison or causal conclusion is supported. Do not widen an empty period.' }
  return { content: [{ type: 'text', text: JSON.stringify(report) }] }
}
