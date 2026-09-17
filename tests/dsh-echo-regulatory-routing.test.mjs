import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { loadDshPluginSkills } from '../adapters/dsh/plugin-skills.mjs'

test('Echo distinguishes Deviations and Journeys summary windows from full lists', () => {
  const text = loadDshPluginSkills().find(skill => skill.name === 'voidr-echo-analysis').content
  assert.match(text, /windowScope: "summary"/)
  assert.match(text, /listWindow: "all"/)
  assert.match(text, /fixed rolling 7d summary, not a user-selected period picker/)
  assert.match(text, /displayed sample, not a\s+complete analytical count/)
})

test('Echo resolves civil days in code and honors the Sessions window', () => {
  const text = loadDshPluginSkills().find(skill => skill.name === 'voidr-echo-analysis').content
  assert.match(text, /mcp__voidr__echo_resolve_analysis_window/)
  assert.match(text, /Today counts as one day/)
  assert.match(text, /September 9–15, not September 8–15/)
  assert.match(text, /seven calendar\s+days including today/)
  assert.match(text, /default, not a screen selection/)
  assert.match(text, /Never replace a UTC `Z` with `-03:00`/)
  assert.match(text, /`all` means no selected time restriction/)
  assert.match(text, /Do not mix rolling\s+overview KPIs with a calendar-day report/)
})

test('Echo copies computed zero-pass counts without grouping low approvals as zero', () => {
  const text = loadDshPluginSkills().find(skill => skill.name === 'voidr-echo-analysis').content
  assert.match(text, /summary\.rubricSummary\.zeroPass\.count/)
  assert.match(text, /`withPass` includes every criterion with at least one/)
  assert.match(text, /`noConclusiveEvaluation`/)
  assert.match(text, /two zero-pass\s+criteria, not four/)
  assert.match(text, /do not invent a consolidated count/)
})

test('the loaded Echo skill routes regulatory counts to canonical control aggregation', () => {
  const text = loadDshPluginSkills().find(skill => skill.name === 'voidr-echo-analysis').content
  assert.match(text, /use\s+`mcp__voidr__echo_summarize_regulatory_controls` as the canonical aggregate/)
  assert.match(text, /call native\s+`echo_render_regulatory_controls`/)
  assert.doesNotMatch(text, /mcp__voidr__echo_render_regulatory_controls/)
  assert.match(text, /distinctNonCompliantControls/)
  assert.match(text, /affectedSessions\.nonCompliant/)
  assert.match(text, /criticalNonCompliantOccurrences/)
  assert.match(text, /A session-wide `NON_COMPLIANT` does not make every mentioned control fail/)
  assert.match(text, /parse\s+`judgeSummary`, run aggregation scripts or delegate this report to subagents/)
  assert.match(text, /`available: false`, timeout or access denial is not zero/)
  assert.match(text, /default `outcome: "NON_COMPLIANT"`/)
  assert.match(text, /top-N `officialCriteria` rows/)
  assert.match(text, /Any definitive claim about the existence, absence or count/)
  assert.match(text, /explicit regulatory\s+request should call the appropriate tool/)
  assert.match(text, /finish the main answer first and then offer it through\s+`ask_user_question`/)
  assert.match(text, /continue immediately in the same turn/)
  assert.match(text, /Never\s+reconstruct or shorten the published table in prose/)
  assert.match(text, /"Most recurrent" means the maximum/)
  assert.match(text, /Never call a control "most relevant"/)
  assert.match(text, /Always include the returned `asOf` cutoff and consistency/)
  assert.match(text, /A later\s+disclaimer does not repair an earlier statement/)
  assert.match(text, /behavioral privacy score cannot rule out regulatory/)
  assert.match(text, /Treat each returned `stableId`, title, non-compliant count and critical count as\s+one atomic row/)
  assert.match(text, /native regulatory\s+widget already validates the complete list and its totals/)
  assert.match(text, /only when `completeControlList` is true/)
  assert.match(text, /keep the first page's `limit` unchanged/)
})

test('Echo scope preserves root and nested Journey filters and does not widen empty results', () => {
  const text = loadDshPluginSkills().find(skill => skill.name === 'voidr-echo-analysis').content
  assert.match(text, /whether at the context root or in `echoContext`/)
  assert.match(text, /"all" alone\s+means all matching records inside the selected scope/)
  assert.match(text, /Never silently omit a Journey filter/)
  assert.match(text, /A zero-session scope must not be widened automatically/)
  const routing = readFileSync(new URL('../adapters/dsh/skills/voidr-echo-analysis/references/tool-routing.md', import.meta.url), 'utf8')
  assert.match(routing, /echo_summarize_regulatory_controls/)
  assert.match(routing, /No\s+subagent delegation, session-by-session scan or custom aggregation script/)
  assert.match(routing, /cannot prove absence of an omitted control/)
  assert.match(routing, /Any definitive claim of zero, some or a specific number/)
  assert.match(routing, /Only call\s+the observed control list complete after the native renderer confirms every\s+page/)
  assert.match(routing, /Samples support examples,\s+not a population-level cause/)
})

test('Echo does not infer causes from marginal cohort totals and renders next-step choices', () => {
  const text = loadDshPluginSkills().find(skill => skill.name === 'voidr-echo-analysis').content
  const routing = readFileSync(new URL('../adapters/dsh/skills/voidr-echo-analysis/references/tool-routing.md', import.meta.url), 'utf8')
  assert.match(text, /Aggregate fields are separate totals unless the tool explicitly returns their\s+intersection/)
  assert.match(text, /do not establish that audio caused silence or a\s+transfer/)
  assert.match(text, /Reading one exact\s+session may establish order in that session only/)
  assert.match(text, /Whenever the response offers two or more distinct next actions, call\s+`ask_user_question`/)
  assert.match(text, /do not end with a prose question/)
  assert.match(text, /After a complete empty cohort, the next tool call must be `ask_user_question`/)
  assert.match(text, /A deviation is an observed classified event or pattern/)
  assert.match(text, /not automatically wrongdoing\s+by the agent or test/)
  assert.match(text, /use only the\s+control-linked `evidenceSamples`/)
  assert.match(text, /For critical examples, use only that\s+control's `criticalEvidenceSamples`/)
  assert.match(text, /Never substitute a recent, severe or status=`deviation` session/)
  assert.match(text, /echo_list_deviations` never establishes root cause/)
  assert.match(text, /Do not claim sessions ran in parallel or shared an execution unless every cited\s+row/)
  assert.match(routing, /Copy regulatory rows atomically/)
})
