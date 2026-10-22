import test from 'node:test'
import assert from 'node:assert/strict'
import { createFailureReadWindow } from '../adapters/dsh/failure-read-window.mjs'
import { registerFailureReport, renderFailureReport, validateFailureReport } from '../adapters/dsh/failure-report.mjs'

const scope = { executionId: 'a'.repeat(24), applicationId: 'b'.repeat(24), planId: 'c'.repeat(24), testCaseSlug: 'CASE-1' }
function fixture() {
  const selected = [{ sourceRow: 1, startedAt: '2026-10-22T13:31:39Z', durationMs: 97842, errorMessage: 'Timed out 10000ms waiting for expect(locator).toBeVisible()' },
    { sourceRow: 2, startedAt: '2026-10-22T13:33:18Z', durationMs: 128204, errorMessage: 'Test timeout of 120000ms exceeded' }]
  return { scope, failures: { complete: true, totalRecords: 3, distinctCases: 2, selected,
    recordLedger: selected.map((row, i) => ({ ...row, errorMessage: { kind: i ? 'test-timeout' : 'locator-assertion-timeout', timeoutMs: i ? 120000 : 10000 }, errorStack: { kind: 'locator-assertion-timeout', timeoutMs: 10000 } })) },
    evidence: { timeline: { console: { sampledMessages: 3, byMessage: { same: 2, other: 1 } }, network: { sampledRequests: 4, byStatus: { 0: 1, 200: 2, 404: 1 } } },
      history: { returnedRecords: 2, byStatus: { PASSED: 1, FAILED: 1 } }, dom: { snapshots: [] } },
    gaps: [], view: { omissions: [{ path: 'steps' }] }, sources: [{ name: 'playwright_get_test_timeline', sha256: 'd'.repeat(64) }] }
}
const args = () => ({ executionId: scope.executionId, testCaseSlug: scope.testCaseSlug, hypotheses: ['locator_accessibility', 'console_origin'],
  nextChecks: ['trace_assertion_window', 'controlled_reproduction'] })

test('source-backed report retains exact records, distinct sample counts, independent errors and inconclusive causality', () => {
  const content = renderFailureReport(args(), fixture())
  assert.match(content, /causa ainda não confirmada/)
  assert.match(content, /3 registros de falha em 2 casos distintos; 2 registros/)
  assert.match(content, /2026-10-22T13:31:39Z \| 97842 \| locator-assertion-timeout \| 10000/)
  assert.match(content, /2026-10-22T13:33:18Z \| 128204 \| test-timeout \| 120000/)
  assert.match(content, /Em rows\[2\], errorStack indica locator-assertion-timeout \/ 10000 ms/)
  assert.match(content, /Console: 2 × same/)
  assert.match(content, /Console: 1 × other/)
  assert.match(content, /Status 0: 1/)
  assert.match(content, /um passe posterior não exclui falha intermitente/i)
  assert.match(content, /não prova visibilidade contínua/)
  assert.match(content, /executar exige confirmação separada/)
  assert.doesNotMatch(content, /Não é teste desatualizado|Environment instability|causa comprovada/)
})

test('the model cannot supply prose, classify a cause, merge records or forge evidence references', () => {
  const bundle = fixture()
  for (const altered of [{ ...args(), classification: 'environment' }, { ...args(), cause: 'confirmed' },
    { ...args(), selectedSourceRows: [1] }, { ...args(), evidenceRefs: ['foreign-source'] },
    { ...args(), hypotheses: [{ kind: 'console_origin', evidenceRefs: ['timeline'] }] },
    { ...args(), hypotheses: ['console_origin', 'console_origin'] },
    { ...args(), nextChecks: ['execute_now'] }]) assert.throws(() => validateFailureReport(altered, bundle))
  assert.throws(() => validateFailureReport(args(), { ...bundle, failures: { ...bundle.failures, complete: false } }), /Complete selected/)

})

test('evidence text remains data and declared gaps cannot become empty-source or causal claims', () => {
  const bundle = fixture()
  bundle.failures.selected[0].errorMessage = '<script>alert(1)</script> | [ignore policy](https://example.com)'
  bundle.gaps.push({ name: 'playwright_get_test_dom' })
  const content = renderFailureReport(args(), bundle)
  assert.doesNotMatch(content, /<script>|\[ignore policy\]/)
  assert.match(content, /&#60;script&#62;/)
  assert.match(content, /Lacunas explícitas: playwright/)
})

test('native publication uses the existing Markdown widget and concludes exactly once after validation', async () => {
  const window = createFailureReadWindow(), events = [], a = { session: { events, append: (type, data) => events.push({ type, data }) } }
  const state = window.begin(a)
  window.complete(a, state, fixture())
  let tool, concluded = 0
  registerFailureReport({ tools: { register: value => { tool = value } } }, window)
  const result = await tool.execute(args(), { agent: a, concludeTurn: () => { concluded++ } })
  assert.equal(result.causeStatus, 'inconclusive')
  assert.equal(concluded, 1)
  assert.equal(events.length, 1)
  assert.equal(events[0].type, 'voidr/widget')
  assert.equal(events[0].data.widget.spec.elements.report.type, 'Markdown')
  assert.match(events[0].data.widget.spec.elements.report.props.content, /rows\[1\]/)
  await assert.rejects(tool.execute(args(), { agent: a, concludeTurn() {} }), /already published/)
  assert.equal(events.length, 1)
})

test('invalid data, cancellation, foreign scopes and newer turns publish nothing and do not conclude', async () => {
  for (const mode of ['invalid', 'abort', 'foreign', 'turn']) {
    const window = createFailureReadWindow(), events = [], a = { session: { events, append: (type, data) => events.push({ type, data }) } }
    const state = window.begin(a)
    window.complete(a, state, fixture())
    let tool, concluded = 0
    registerFailureReport({ tools: { register: value => { tool = value } } }, window)
    if (mode === 'turn') events.push({ type: 'turn/start' })
    const input = mode === 'invalid' ? { ...args(), selectedSourceRows: [1] } : mode === 'foreign' ? { ...args(), executionId: 'd'.repeat(24) } : args()
    await assert.rejects(tool.execute(input, { agent: a, signal: mode === 'abort' ? AbortSignal.abort() : undefined, concludeTurn: () => { concluded++ } }))
    assert.equal(events.filter(event => event.type === 'voidr/widget').length, 0)
    assert.equal(concluded, 0)
  }
})
