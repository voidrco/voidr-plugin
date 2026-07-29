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
  'defects_list_defects'
]

test('failure analysis uses only exposed evidence tools', () => {
  const policy = loadPolicy()

  for (const tool of analysisTools) {
    assert.match(skill, new RegExp(`\\b${tool}\\b`))
    assert.equal(policy.safeRemoteTools.includes(tool), true)
  }

  assert.doesNotMatch(skill, /\b(?:group|cluster)_diagnosis_/)
  assert.match(skill, /Do not group or deduplicate rows by `failureSignature`/)
})

test('failure analysis mutations are explicit and write-scoped', () => {
  const policy = loadPolicy()

  for (const tool of [
    'defects_create_defect',
    'test_plans_update_test_case_tag'
  ]) {
    assert.match(skill, new RegExp(`\\b${tool}\\b`))
    assert.equal(policy.safeRemoteTools.includes(tool), true)
    assert.equal(policy.writeRemoteTools.includes(tool), true)
  }

  assert.match(skill, /ask for explicit confirmation/i)
  assert.match(skill, /Never create a bug-report video/)
  assert.match(skill, /Never change a tag automatically/)
})
