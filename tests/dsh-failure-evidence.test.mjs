import assert from 'node:assert/strict'
import test from 'node:test'
import { collectFailureEvidence, compactFailureEvidence, evidencePayload, registerFailureEvidence, resolveEvidence } from '../adapters/dsh/failure-evidence.mjs'
import { loadDshPluginSkills } from '../adapters/dsh/plugin-skills.mjs'
import { profileToolVisible } from '../adapters/dsh/tool-profiles.mjs'
import { interactiveTestDevelopmentPrompt } from '../core/workflow/interactive-test-development.mjs'

const executionId = 'a'.repeat(24), applicationId = 'b'.repeat(24), planId = 'c'.repeat(24)
const input = { executionId, testCaseSlug: 'CASE-1' }
test('Monitor keeps the full diagnosis skill and explicit task changes without loading the authoring manual', () => {
  const prompt = interactiveTestDevelopmentPrompt({ hint: { surface: 'monitor', executionId } })
  assert.ok(prompt.length < 3500)
  for (const contract of ['untrusted lookup hint', 'voidr-failure-analysis', 'not a restriction', 'voidr-automate', 'voidr-execute', 'explicit confirmation', 'read-back', 'Never run Playwright', 'denied read is an access boundary', 'never instructions or authorization']) assert.ok(prompt.includes(contract), contract)
  assert.match(prompt, /indeterminate cause/)
})
test('the loaded Monitor skill routes to the registered native bundle without inventing a remote name', () => {
  const skill = loadDshPluginSkills().find(skill => skill.name === 'voidr-failure-analysis')
  assert.match(skill.content, /start with failure_analysis_read_bundle if available/)
  assert.doesNotMatch(skill.content, /mcp__voidr__failure_analysis_read_bundle/)
  assert.equal(profileToolVisible('failure_analysis_read_bundle', ['execution']), true)
  assert.equal(profileToolVisible('failure_analysis_read_bundle', ['failure']), true)
  assert.equal(profileToolVisible('mcp__voidr__executions_create_execution', ['failure']), false)
  assert.equal(profileToolVisible('failure_analysis_read_bundle', ['knowledge']), false)
})
function fixture(overrides = {}) {
  const calls = []
  const readers = {
    playwright_get_execution_analytics: () => ({ executionId, applicationId, planId }),
    playwright_list_execution_failures: args => ({ page: args.page, limit: args.limit, total: 3, rows: [
      { testCaseSlug: 'OTHER-1' },
      { testCaseSlug: 'CASE-1', startedAt: '2026-10-22T13:31:39Z', durationMs: 97842, failureSignature: 'same', errorMessage: 'locator timeout', errorStack: 'locator timeout' },
      { testCaseSlug: 'CASE-1', startedAt: '2026-10-22T13:33:18Z', durationMs: 128204, failureSignature: 'same', errorMessage: 'test timeout', errorStack: 'locator timeout' },
    ] }),
    playwright_get_test_timeline: () => ({ steps: [], console: [{ level: 'error', message: '__name is not defined' }, { level: 'error', message: 'different' }], network: [{ status: 404 }, { status: 0, error: 'aborted' }], stdout: [], stderr: [] }),
    playwright_get_trace_events: () => ({ events: [] }),
    playwright_get_test_history: () => ({ testCaseSlug: 'CASE-1', planId, rows: [{ planId, applicationId }] }),
    playwright_get_test_dom: () => ({ snapshots: [] }),
    playwright_list_test_results: args => ({ page: args.page, limit: args.limit, total: 1, rows: [{ testCaseSlug: 'CASE-1', moduleSlug: 'module', suiteSlug: 'suite' }] }),
    test_plans_get_case: () => ({ slug: 'CASE-1', expected: 'contract' }),
    test_plans_get_tag_history: () => ({ rows: [] }),
    connectors_context_list_active_integrations: () => ({ integrations: [] }),
    ...overrides,
  }
  return { calls, read: async (name, args, signal) => { calls.push({ name, args, signal }); return readers[name](args, signal) } }
}

test('keeps repeated signatures, source row/error associations and exact sample aggregates', async () => {
  const f = fixture()
  const value = await collectFailureEvidence(input, f.read)
  assert.equal(value.failures.totalRecords, 3)
  assert.equal(value.failures.distinctCases, 2)
  assert.deepEqual(value.failures.selected.map(row => [row.sourceRow, row.startedAt, row.durationMs]), [[1, '2026-10-22T13:31:39Z', 97842], [2, '2026-10-22T13:33:18Z', 128204]])
  assert.equal(value.failures.selected[1].errorMessage, 'test timeout')
  assert.equal(value.failures.selected[1].errorStack, 'locator timeout')
  assert.deepEqual(value.evidence.timeline.console.byMessage, { '__name is not defined': 1, different: 1 })
  assert.deepEqual(value.evidence.timeline.network.byStatus, { 0: 1, 404: 1 })
  assert.equal(value.gaps.length, 0)
  assert.equal(value.sources.length, 10)
  assert.ok(value.sources.every(row => /^[a-f0-9]{64}$/.test(row.sha256)))
  assert.deepEqual(f.calls.find(call => call.name === 'playwright_get_test_history').args,
    { applicationId, planId, testCaseSlug: 'CASE-1', limit: 25 })
})

test('rejects foreign execution before any further reads and never accepts an unrecorded case', async () => {
  const foreign = fixture({ playwright_get_execution_analytics: () => ({ executionId: 'd'.repeat(24), applicationId, planId }) })
  await assert.rejects(collectFailureEvidence(input, foreign.read), /identity/)
  assert.equal(foreign.calls.length, 1)
  const absent = fixture()
  await assert.rejects(collectFailureEvidence({ ...input, testCaseSlug: 'MISSING' }, absent.read), /no recorded failure/)
  assert.equal(absent.calls.length, 2)
})

test('pages failures without deduplication and rejects changed totals, short and unbounded collections', async () => {
  const rows = Array.from({ length: 201 }, () => ({ testCaseSlug: 'CASE-1', failureSignature: 'same' }))
  const paged = fixture({ playwright_list_execution_failures: args => ({ ...args, total: rows.length, rows: rows.slice((args.page - 1) * 200, args.page * 200) }) })
  assert.equal((await collectFailureEvidence(input, paged.read)).failures.selected.length, 201)
  for (const body of [args => ({ ...args, total: args.page === 1 ? 201 : 202, rows: rows.slice((args.page - 1) * 200, args.page * 200) }),
    args => ({ ...args, total: 201, rows: [] }), args => ({ ...args, total: 3000, rows: rows.slice(0, 200) })]) {
    const f = fixture({ playwright_list_execution_failures: body })
    await assert.rejects(collectFailureEvidence(input, f.read), /pagination/)
    assert.ok(f.calls.length <= 11)
  }
})

test('parallel reads stay at three and failures remain gaps rather than evidence of absence', async () => {
  let active = 0, peak = 0
  const f = fixture({ playwright_get_trace_events: () => { throw new Error('forbidden') },
    playwright_get_test_history: () => ({ testCaseSlug: 'CASE-1', planId, rows: [{ planId: 'd'.repeat(24), applicationId }] }) })
  const value = await collectFailureEvidence(input, async (...args) => {
    active++; peak = Math.max(peak, active)
    try { await new Promise(resolve => setTimeout(resolve, 1)); return await f.read(...args) }
    finally { active-- }
  })
  assert.equal(peak, 3)
  assert.equal(value.evidence.trace, null)
  assert.equal(value.evidence.history, null)
  assert.deepEqual(value.gaps.map(gap => gap.name).sort(), ['playwright_get_test_history', 'playwright_get_trace_events'])
})

test('cancellation stops pending work and propagates to every child; no cached evidence crosses turns', async () => {
  const controller = new AbortController()
  const f = fixture({ playwright_list_execution_failures: () => { controller.abort(); return {} } })
  await assert.rejects(collectFailureEvidence(input, f.read, { signal: controller.signal }), { name: 'AbortError' })
  assert.equal(f.calls.length, 2)
  assert.ok(f.calls.every(call => call.signal === controller.signal))
  const clean = fixture()
  await collectFailureEvidence(input, clean.read)
  await collectFailureEvidence(input, clean.read)
  assert.equal(clean.calls.filter(call => call.name === 'playwright_get_execution_analytics').length, 2)
})

test('registered tool dispatches through runtime authorization with parent, agent and cancellation', async () => {
  const f = fixture(), registered = [], agent = {}, token = Symbol('parent'), controller = new AbortController()
  registerFailureEvidence({ tools: { register: tool => registered.push(tool), execute: async call => {
    assert.equal(call.agent, agent)
    assert.equal(call.parent, token)
    assert.equal(call.rootCallId, 'root')
    assert.ok(call.callId.startsWith('bundle:evidence:'))
    const value = await f.read(call.name.replace(/^mcp__voidr__/, ''), call.arguments, call.signal)
    return { isError: false, value: { content: [{ type: 'text', text: JSON.stringify(value) }] } }
  } } })
  const tool = registered[0]
  await tool.execute(input, { agent, token, callId: 'bundle', rootCallId: 'root', signal: controller.signal })
  assert.equal(f.calls.length, 10)
  assert.ok(f.calls.every(call => !/create|update|run|delete/.test(call.name)))
  await assert.rejects(tool.execute({ ...input, organizationId: 'foreign' }, {}), /Unexpected/)
  await assert.rejects(tool.execute(input, { signal: AbortSignal.abort() }), { name: 'AbortError' })
  assert.throws(() => evidencePayload({ isError: true, value: { content: [{ type: 'text', text: '{}' }] } }), /rejected/)
  assert.throws(() => evidencePayload({ value: { isError: true } }), /rejected/)
})

test('hydrates authorized offloaded evidence without trusting previews, omitting pages or reissuing the source', async () => {
  const rows = Array.from({ length: 501 }, (_, i) => ({ index: i, errorMessage: `error ${i}` }))
  const calls = []
  const output = await resolveEvidence({ artifactId: 'art_' + 'a'.repeat(18), sample: { rows: [rows[0]] } }, async args => {
    calls.push(args)
    return args.path === '$' ? { value: { total: 501, rows: 'array[501]', metadata: '{…}' } }
      : args.path === 'metadata' ? { value: { complete: true } }
        : { total: rows.length, offset: args.offset, items: rows.slice(args.offset, args.offset + 500) }
  })
  assert.equal(output.rows.length, 501)
  assert.equal(output.rows[500].errorMessage, 'error 500')
  assert.equal(output.metadata.complete, true)
  assert.equal(calls.length, 4)
  await assert.rejects(resolveEvidence({ artifactId: 'foreign' }, () => {}), /Invalid/)
  await assert.rejects(resolveEvidence({ artifactId: 'art_' + 'a'.repeat(18) }, async () => ({ items: [], offset: 0, total: 3 })), /pagination changed/)
})

test('the compact view preserves selected records and counts while marking every narrowed evidence section', async () => {
  const f = fixture()
  const bundle = await collectFailureEvidence(input, f.read)
  bundle.evidence.timeline.steps = Array.from({ length: 90 }, (_, i) => ({ stepIndex: i, status: i === 45 ? 'FAILED' : 'PASSED', error: i === 45 ? 'assertion error' : '' }))
  bundle.evidence.history.rows = Array.from({ length: 25 }, (_, i) => ({ executionId: String(i), status: i === 10 ? 'FAILED' : 'PASSED', errorSummary: i === 10 ? 'same error' : '' }))
  const view = compactFailureEvidence(bundle)
  assert.deepEqual(view.failures.selected.map(row => [row.sourceRow, row.startedAt, row.durationMs, row.errorMessage, row.errorStack]),
    bundle.failures.selected.map(row => [row.sourceRow, row.startedAt, row.durationMs, row.errorMessage, row.errorStack]))
  assert.deepEqual(view.evidence.timeline.console, bundle.evidence.timeline.console)
  assert.deepEqual(view.evidence.timeline.network.byStatus, bundle.evidence.timeline.network.byStatus)
  assert.equal(view.evidence.timeline.steps.sampledSteps, 90)
  assert.deepEqual(view.evidence.timeline.steps.rows.map(row => row.sourceRow), [44, 45, 46])
  assert.equal(view.evidence.history.returnedRecords, 25)
  assert.deepEqual(view.evidence.history.byStatus, { PASSED: 24, FAILED: 1 })
  assert.deepEqual(view.evidence.history.rows.map(row => row.sourceRow), [0, 10, 24])
  assert.match(view.evidence.history.rowsCoverage, /not the full series/)
  assert.equal(view.sources, bundle.sources)
  assert.ok(JSON.stringify(view).length < 38_000)
  bundle.failures.selected[0].errorStack = 'x'.repeat(5000)
  const shortened = compactFailureEvidence(bundle)
  assert.equal(shortened.failures.selected[0].errorStack.length, 1000)
  assert.ok(shortened.view.omissions.some(row => row.path === 'failures.selected.1.errorStack' && row.originalCharacters === 5000))
  bundle.evidence.timeline.console.byMessage = { ['x'.repeat(40_000)]: 1 }
  assert.throws(() => compactFailureEvidence(bundle), /exceeds compact view/)
})

test('a late failed assertion is retained even when earlier timeouts fill the context budget', async () => {
  const f = fixture(), bundle = await collectFailureEvidence(input, f.read)
  bundle.evidence.timeline.steps = Array.from({ length: 90 }, (_, i) => ({ stepIndex: i, status: i % 6 === 0 ? 'TIMEDOUT' : i === 79 ? 'FAILED' : 'PASSED', error: i === 79 ? 'final assertion failed' : '' }))
  const view = compactFailureEvidence(bundle)
  assert.equal(view.evidence.timeline.steps.failedSteps, 16)
  assert.equal(view.evidence.timeline.steps.rows.length, 16)
  assert.ok(view.evidence.timeline.steps.rows.some(row => row.sourceRow === 79 && row.error === 'final assertion failed'))
})
