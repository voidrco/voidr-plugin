import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { loadPolicy } from '../scripts/lib/policy.mjs'

const root = resolve(import.meta.dirname, '..')
const skill = readFileSync(
  join(root, 'skills/voidr-failure-analysis/SKILL.md'),
  'utf8'
)

const analysisTools = [
  'playwright_get_execution_analytics',
  'playwright_list_executions',
  'playwright_list_test_results',
  'playwright_list_execution_failures',
  'playwright_get_test_timeline',
  'playwright_get_test_history',
  'playwright_get_test_dom',
  'playwright_get_trace_events',
  'test_plans_get_tag_history',
  'defects_list_defects',
  'defects_get_defect',
  'issue_tracker_list',
  'issue_tracker_list_projects'
]

test('failure analysis uses only exposed evidence tools', () => {
  const policy = loadPolicy()

  for (const tool of analysisTools) {
    assert.match(skill, new RegExp(`\\b${tool}\\b`))
    assert.equal(policy.safeRemoteTools.includes(tool), true)
  }

  assert.doesNotMatch(skill, /\b(?:group|cluster)_diagnosis_/)
  assert.match(skill, /Do not group or deduplicate rows by `failureSignature`/)
  assert.ok(
    skill.indexOf('defects_get_defect') >
      skill.indexOf('defects_list_defects'),
    'existing defects must be listed before loading their full details'
  )
})

test('failure analysis mutations are explicit and write-scoped', () => {
  const policy = loadPolicy()

  for (const tool of [
    'defects_create_defect',
    'defects_create_defect_with_issue',
    'defects_update_defect',
    'defects_update_defect_status',
    'defects_assign_defect',
    'test_plans_update_test_case_tag'
  ]) {
    assert.match(skill, new RegExp(`\\b${tool}\\b`))
    assert.equal(policy.safeRemoteTools.includes(tool), true)
    assert.equal(policy.writeRemoteTools.includes(tool), true)
  }

  assert.match(skill, /ask for explicit confirmation/i)
  assert.match(skill, /Never mutate\s+a defect from a list summary/)
  assert.match(skill, /Use `defects_update_defect` only for/)
  assert.match(skill, /Use `reopened` to reopen a closed defect/)
  assert.match(skill, /Never invent a user ID/)
  assert.match(skill, /verify every confirmed field/)
  assert.match(skill, /Never create a bug-report video/)
  assert.match(skill, /Never change a tag automatically/)
})

test('failure analysis always links the evidence execution', () => {
  assert.match(
    skill,
    /executionUrl = <VOIDR_PLATFORM_URL>\/execution\/<executionId>/
  )
  assert.match(skill, /Never finish a test-case failure analysis without/)
  assert.match(skill, /clickable `Execution` URL/)
  assert.match(skill, /Execution: \[Open execution\]\(<executionUrl>\)/)
  assert.match(skill, /`relations\.executions: \[executionId\]`/)
  assert.match(skill, /`relations\.testCases: \[testCaseSlug\]`/)
  assert.match(skill, /description under `Evidence execution`/)
  assert.match(skill, /Call `defects_get_defect`/)
  assert.match(skill, /show the complete returned defect/i)
  assert.match(skill, /never create a possible duplicate/i)
  assert.match(skill, /Return it and end with the required `Execution` link/)
})
