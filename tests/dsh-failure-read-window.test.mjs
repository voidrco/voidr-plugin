import assert from 'node:assert/strict'
import test from 'node:test'
import { createFailureReadWindow, evidenceExcerpt, failureWindowToolVisible, registerFailureReadPresentation } from '../adapters/dsh/failure-read-window.mjs'
import { registerFailureEvidence } from '../adapters/dsh/failure-evidence.mjs'
import { toolVisibilityFilter } from '../adapters/dsh/tool-visibility.mjs'

const scope = { executionId: 'a'.repeat(24), testCaseSlug: 'CASE-1' }
const source = { name: 'playwright_get_test_timeline', arguments: { ...scope, limit: 500 }, sha256: 'old' }
const agent = () => ({ session: { events: [{ type: 'turn/start' }, { type: 'voidr/project-context-hint', data: { surface: 'monitor', ...scope } }] } })

test('selected Monitor moves from collection to bounded details without reopening generic dispatchers', () => {
  const window = createFailureReadWindow(), a = agent()
  assert.equal(window.stage(a), 'collect')
  const state = window.begin(a)
  window.complete(a, state, { scope, sources: [source] })
  assert.equal(window.stage(a), 'answer')
  for (const name of ['mcp__voidr__playwright_get_test_timeline', 'mcp__voidr__system_search_tools', 'mcp__voidr__system_call_tool', 'failure_analysis_read_bundle'])
    assert.equal(failureWindowToolVisible(name, 'answer'), false)
  for (const name of ['failure_analysis_read_detail', 'expand_tool_scope', 'ask_user_question', 'skill'])
    assert.equal(failureWindowToolVisible(name, 'answer'), true)
  for (let i = 0; i < 3; i++) assert.equal(window.reserve(a, { ...scope, source: source.name }), source)
  assert.equal(window.stage(a), 'done')
  assert.equal(failureWindowToolVisible('failure_analysis_read_detail', 'done'), false)
  assert.throws(() => window.reserve(a, { ...scope, source: source.name }), /Three detail reads/)
})

test('a new turn, new user steering or changed context cannot reuse an old bundle or its in-flight completion', () => {
  for (const event of [{ type: 'turn/start' }, { type: 'user/message', data: { source: { kind: 'user' } } },
    { type: 'voidr/project-context-hint', data: { surface: 'monitor', ...scope } }]) {
    const window = createFailureReadWindow(), a = agent(), other = agent()
    const state = window.begin(a)
    a.session.events.push(event)
    window.complete(a, state, { scope, sources: [source] })
    assert.equal(window.stage(a), 'collect')
    assert.throws(() => window.reserve(a, { ...scope, source: source.name }), /current turn/)
    assert.throws(() => window.reserve(other, { ...scope, source: source.name }), /current turn/)
  }
})

test('an initial panel leaves bounded investigation available without publishing it twice', () => {
  const window = createFailureReadWindow(), a = agent(), state = window.begin(a)
  window.complete(a, state, { scope, sources: [source] })
  window.forReport(a, scope).reported = true
  assert.equal(window.stage(a), 'synthesis')
  assert.equal(failureWindowToolVisible('failure_analysis_render_report', window.stage(a)), false)
  assert.equal(failureWindowToolVisible('failure_analysis_read_detail', window.stage(a)), true)
  for (let i = 0; i < 3; i++) window.reserve(a, { ...scope, source: source.name })
  assert.equal(window.stage(a), 'final')
  assert.equal(failureWindowToolVisible('failure_analysis_read_detail', window.stage(a)), false)
  assert.equal(failureWindowToolVisible('expand_tool_scope', window.stage(a)), true)
  assert.throws(() => window.forReport(a, scope), /already published/)
})

test('failed collection releases ordinary reads and unrelated surfaces never enter the selected-case window', () => {
  const window = createFailureReadWindow(), a = agent(), state = window.begin(a)
  window.fail(a, state)
  assert.equal(window.stage(a), null)
  for (const surface of ['echo', 'slack', 'home']) {
    a.session.events.push({ type: 'voidr/project-context-hint', data: { surface, ...scope } })
    assert.equal(window.stage(a), null)
  }
  a.session.events.push({ type: 'voidr/project-context-hint', data: { surface: 'monitor' } })
  assert.equal(window.stage(a), null)
})

test('literal excerpts retain source row positions, exact filtering, pagination and explicit incomplete coverage', () => {
  const value = { network: [{ status: 0 }, { status: 200 }, { status: 404 }, { status: 404 }] }
  const first = evidenceExcerpt(value, { path: 'network', contains: '404', limit: 1 })
  assert.deepEqual([first.sourceRows, first.matchedRows, first.nextOffset], [4, 2, 1])
  assert.deepEqual(first.items, [{ sourceRow: 2, value: { status: 404 } }])
  assert.deepEqual(evidenceExcerpt(value, { path: '$.network', contains: '404', limit: 1 }).items, first.items)
  assert.deepEqual(evidenceExcerpt(value, { path: 'network', contains: '404', limit: 1, offset: 1 }).items,
    [{ sourceRow: 3, value: { status: 404 } }])
  assert.match(first.coverage, /not the full source/)
  assert.throws(() => evidenceExcerpt(value, { path: 'missing' }), /absent/)
  for (const args of [{ path: '__proto__' }, { path: 'constructor.name' }, { path: 'network[0]' }, { offset: -1 }, { limit: 51 }, { contains: '' }])
    assert.throws(() => evidenceExcerpt(value, args), /exact field path/)
  const bounded = evidenceExcerpt({ rows: Array.from({ length: 10 }, () => ({ error: 'x'.repeat(2500) })) }, { path: 'rows' })
  assert.ok(JSON.stringify(bounded.items).length <= 12_000)
  assert.ok(bounded.nextOffset > 0)
  assert.throws(() => evidenceExcerpt({ rows: ['x'.repeat(12_001)] }, { path: 'rows' }), /narrower field path/)
})

test('bounded excerpts still pass through the original runtime authorization and cancellation', async () => {
  const tools = new Map(), a = agent(), calls = [], token = Symbol('parent')
  const window = registerFailureEvidence({ tools: {
    register(tool) { tools.set(tool.name, tool) },
    async execute(call) {
      calls.push(call)
      assert.equal(call.agent, a)
      assert.equal(call.parent, token)
      assert.equal(call.rootCallId, 'root')
      assert.deepEqual(call.arguments, source.arguments)
      assert.ok(call.signal)
      return { isError: false, value: { structuredContent: { steps: [{ status: 'FAILED' }] } } }
    },
  } })
  const state = window.begin(a)
  window.complete(a, state, { scope, sources: [source] })
  const tool = tools.get('failure_analysis_read_detail')
  const input = { ...scope, source: source.name, question: 'Which exact assertion failed?', path: 'steps' }
  const result = await tool.execute(input, { agent: a, token, callId: 'detail', rootCallId: 'root' })
  assert.deepEqual(result.items, [{ sourceRow: 0, value: { status: 'FAILED' } }])
  assert.equal(result.source.changedSinceCollection, true)
  assert.equal(result.source.collectedSha256, 'old')
  await assert.rejects(tool.execute({ ...input, path: '__proto__' }, { agent: a }), /exact field path/)
  await assert.rejects(tool.execute({ ...input, executionId: 'b'.repeat(24) }, { agent: a }), /current turn/)
  assert.equal(calls.length, 1)
  await assert.rejects(tool.execute(input, { agent: a, signal: AbortSignal.abort() }), { name: 'AbortError' })
  assert.equal(calls.length, 1)
})

test('the presentation narrows only already-visible tools; authorized child execution remains available and explicit expansion is retained', async () => {
  const hooks = new Map(), window = createFailureReadWindow(), a = agent()
  let guard
  registerFailureReadPresentation({ on: (event, handler) => hooks.set(event, handler), tools: { guard: fn => { guard = fn } } }, window)
  const names = ['failure_analysis_read_detail', 'mcp__voidr__defects_create_defect', 'mcp__voidr__system_call_tool', 'expand_tool_scope']
  const filter = toolVisibilityFilter(names, { domains: ['failure'] })
  const assembly = { tools: names.filter(name => !filter.deny.includes(name)).map(name => ({ name })) }
  const state = window.begin(a)
  window.complete(a, state, { scope, sources: [source] })
  const assemble = () => hooks.get('system-prompt/assemble')({}, { agent: a }, async () => assembly)
  const narrowed = await assemble()
  assert.deepEqual(narrowed.tools.map(tool => tool.name), ['failure_analysis_read_detail', 'expand_tool_scope'])
  assert.ok(assembly.tools.some(tool => tool.name === 'mcp__voidr__system_call_tool'))
  assert.match(guard({ agent: a, name: 'mcp__voidr__playwright_get_test_timeline' }), /Do not repeat/)
  assert.equal(guard({ agent: a, name: 'mcp__voidr__playwright_get_test_timeline', parent: Symbol('bundle') }), undefined)
  assert.equal(guard({ agent: a, name: 'failure_analysis_read_detail' }), undefined)
  a.session.events.push({ type: 'voidr/tool-scope-expanded', data: { toolName: 'mcp__voidr__playwright_get_test_timeline' } })
  assert.equal(await assemble(), assembly)
  assert.ok(!assembly.tools.some(tool => tool.name === 'mcp__voidr__defects_create_defect'))
  assert.equal(guard({ agent: a, name: 'mcp__voidr__playwright_get_test_timeline' }), undefined)
})
