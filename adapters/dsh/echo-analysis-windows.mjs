/** @typedef {{occurredFrom: string, occurredToExclusive: string, timezone: string}} AnalysisWindow */
/** @typedef {{content?: {type: string, text?: string}[], isError?: boolean}} ToolResult */
/** @typedef {{key: string, result: Promise<ToolResult>, window?: AnalysisWindow}} Resolution */
/** @typedef {{resolutions?: Map<string, Resolution>, readsStarted?: boolean}} WindowState */

/** @param {ToolResult} result @returns {AnalysisWindow | null} */
function readWindow(result) {
  if (result.isError) return null
  try {
    const window = JSON.parse(result.content?.find(item => item.type === 'text')?.text ?? 'null')
    return window && Date.parse(window.occurredFrom) < Date.parse(window.occurredToExclusive) &&
      typeof window.timezone === 'string' ? window : null
  } catch { return null }
}

/** @param {Record<string, unknown>} schema @returns {Record<string, unknown>} */
export function addComparisonSchema(schema) {
  return { ...schema, properties: { ...schema.properties, comparisonLabel: {
    type: 'string', minLength: 1, maxLength: 80,
    description: 'Label for a separate period explicitly requested by the user. Resolve ALL comparison periods before the first analytical read. Never use this to replace an empty period.',
  } } }
}

/** @param {WindowState} state @param {Record<string, unknown>} args @param {(args: Record<string, unknown>) => Promise<ToolResult>} invoke */
export function resolveAnalysisWindow(state, args, invoke) {
  const { comparisonLabel, ...forwarded } = args
  const label = comparisonLabel === undefined ? 'primary' : comparisonLabel
  if (typeof label !== 'string' || !label.trim() || label.length > 80) throw new Error('Invalid comparison label')
  const period = /** @type {Record<string, unknown>} */ (args.period ?? {})
  const key = JSON.stringify([period.type, period.days, period.hours, period.from, period.to, args.timezone ?? 'America/Sao_Paulo'])
  state.resolutions ??= new Map()
  const previous = state.resolutions.get(label)
  if (previous?.key === key) return previous.result
  if (previous || state.readsStarted) throw new Error('Echo analysis period is fixed until the user supplies a new instruction. Resolve labeled comparison periods before reading data; do not replace an empty result autonomously.')
  const resolution = /** @type {Resolution} */ ({ key })
  resolution.result = Promise.resolve().then(() => invoke(forwarded)).then(result => {
    resolution.window = readWindow(result) ?? undefined
    if (!resolution.window) state.resolutions.delete(label)
    return result
  }).catch(error => { state.resolutions.delete(label); throw error })
  state.resolutions.set(label, resolution)
  return resolution.result
}

/** @param {WindowState} state @param {string} tool @param {Record<string, unknown>} args */
export async function validateAnalysisInterval(state, tool, args) {
  state.readsStarted = true
  await Promise.all([...state.resolutions.values()].map(resolution => resolution.result))
  const from = Date.parse(String(args.occurredFrom))
  const to = tool === 'echo_list_sessions' ? Date.parse(String(args.occurredTo)) + 1 : Date.parse(String(args.occurredToExclusive))
  const windows = [...state.resolutions.values()].flatMap(resolution => resolution.window ? [resolution.window] : [])
  if (!windows.length) throw new Error('Analysis window unavailable; do not invent dates or report an empty cohort.')
  const matched = windows.some(window => from < to && from >= Date.parse(window.occurredFrom) &&
    to <= Date.parse(window.occurredToExclusive) && (!args.timezone || args.timezone === window.timezone))
  const wrongBound = tool === 'echo_list_sessions' ? args.occurredToExclusive !== undefined : args.occurredTo !== undefined
  if (!matched || wrongBound) throw new Error('Echo interval mismatch. Use a resolved period or a contained subperiod. Only echo_list_sessions uses inclusive occurredTo (exclusive end minus one millisecond); echo_list_deviations and analytical tools use occurredToExclusive. Do not expand an empty period.')
}
