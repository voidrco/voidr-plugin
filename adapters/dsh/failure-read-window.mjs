const BUNDLE = 'failure_analysis_read_bundle'
const DETAIL = 'failure_analysis_read_detail'
const COMMON = new Set(['skill', 'read', 'todo_write', 'ask_user_question', 'render_widget', 'expand_tool_scope', 'mcp__voidr__assistant_help_request'])

export function failureWindowToolVisible(name, stage) {
  if (!stage) return true
  return COMMON.has(name) || stage === 'collect' && name === BUNDLE || stage === 'answer' && name === DETAIL
}

export function registerFailureReadPresentation(ctx, window) {
  const stageFor = agent => {
    const events = agent?.session?.events
    return expandedDomains(events).length || expandedToolNames(events).length ? null : window.stage(agent)
  }
  ctx.on?.('system-prompt/assemble', async (_assembly, { agent }, next) => {
    const result = await next()
    const stage = stageFor(agent)
    return stage ? { ...result, tools: result.tools.filter(tool => failureWindowToolVisible(tool.name, stage)) } : result
  })
  ctx.tools?.guard?.(exec => {
    const stage = stageFor(exec.agent)
    if (!stage || exec.parent || failureWindowToolVisible(exec.name, stage)) return
    return stage === 'collect'
      ? 'Use failure_analysis_read_bundle for this selected case first. For an explicit task change or a missing capability, expand the exact authorized tool or domain.'
      : 'The initial evidence pass is complete. Answer from it or use failure_analysis_read_detail for one concrete unresolved question. Do not repeat a full source dump. Expand an exact authorized tool only for a justified deeper investigation or task change.'
  })
}

function boundary(agent) {
  const events = agent?.session?.events ?? []
  return [events.findLast(event => event.type === 'turn/start'),
    events.findLast(event => event.type === 'user/message' && event.data?.source?.kind === 'user'),
    events.findLast(event => event.type === 'voidr/project-context-hint')]
}

export function createFailureReadWindow() {
  const states = new WeakMap()
  const current = agent => {
    const state = states.get(agent)
    return state && boundary(agent).every((event, i) => event === state.boundary[i]) ? state : null
  }
  return {
    begin(agent) {
      const state = { boundary: boundary(agent), completed: false, failed: false, sources: [], reads: 0 }
      if (agent) states.set(agent, state)
      return state
    },
    complete(agent, state, value) {
      if (current(agent) !== state) return
      state.completed = true
      state.scope = value.scope
      state.sources = value.sources
    },
    fail(agent, state) { if (current(agent) === state) state.failed = true },
    stage(agent) {
      const hint = boundary(agent)[2]?.data
      if (hint?.surface !== 'monitor' || !/^[a-f0-9]{24}$/.test(hint.executionId ?? '') ||
        !/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(hint.testCaseSlug ?? '')) return null
      const state = current(agent)
      if (state?.failed) return null
      if (state?.reads >= 3) return 'done'
      return state?.completed ? 'answer' : 'collect'
    },
    reserve(agent, args) {
      const state = current(agent)
      if (!state?.completed || state.scope.executionId !== args.executionId || state.scope.testCaseSlug !== args.testCaseSlug)
        throw new Error('Read a successful evidence bundle for this exact case in the current turn first')
      const source = state.sources.find(source => source.name === args.source)
      if (!source) throw new Error('This source was not successfully collected; use its original authorized tool')
      if (state.reads >= 3) throw new Error('Three detail reads attempted; answer from the evidence or explicitly expand one exact tool for an unresolved question')
      state.reads++
      return source
    },
  }
}

export function validateExcerptArguments({ path = '$', contains, offset = 0, limit = 12 }) {
  if (typeof path !== 'string' || !/^(?:\$|(?:\$\.)?[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){0,3})$/.test(path) ||
    path.split('.').some(key => ['__proto__', 'prototype', 'constructor'].includes(key)) ||
    !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50 ||
    contains !== undefined && (typeof contains !== 'string' || !contains.trim() || contains.length > 120))
    throw new Error('Use an exact field path, optional literal filter, offset and limit from 1 to 50')
}

export function evidenceExcerpt(value, { path = '$', contains, offset = 0, limit = 12 }) {
  validateExcerptArguments({ path, contains, offset, limit })
  let section = value
  const fieldPath = path.startsWith('$.') ? path.slice(2) : path
  if (fieldPath !== '$') for (const key of fieldPath.split('.')) {
    if (!section || !Object.hasOwn(section, key)) throw new Error('Evidence path is absent; absence is not an empty result')
    section = section[key]
  }
  const rows = Array.isArray(section) ? section : typeof section === 'string' ? section.split('\n') : [section]
  const needle = contains?.toLocaleLowerCase('en-US')
  const selected = rows.map((value, sourceRow) => ({ sourceRow, value }))
    .filter(row => !needle || JSON.stringify(row.value).toLocaleLowerCase('en-US').includes(needle))
  const items = []
  for (const row of selected.slice(offset, offset + limit)) {
    if (JSON.stringify([...items, row]).length > 12_000) break
    items.push(row)
  }
  if (selected.length > offset && !items.length) throw new Error('One evidence row exceeds the excerpt limit; choose a narrower field path')
  return { path, ...(contains ? { contains } : {}), sourceRows: rows.length, matchedRows: selected.length,
    offset, items, nextOffset: offset + items.length < selected.length ? offset + items.length : null,
    coverage: 'Exact rows from this authorized source and field. A literal filter is not semantic or causal evidence. This excerpt is not the full source.' }
}
import { expandedDomains, expandedToolNames } from './tool-profiles.mjs'

