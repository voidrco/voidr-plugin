import test from 'node:test'
import assert from 'node:assert/strict'
import { interactiveTestDevelopmentPrompt } from '../core/workflow/interactive-test-development.mjs'
import { loadDshPluginSkills } from '../adapters/dsh/plugin-skills.mjs'

test('selected Monitor starts with diagnostic instructions instead of the authoring manual', () => {
  const hint = { surface: 'monitor', testCaseSlug: 'LOTEX-04', testPlanId: 'plan', applicationId: 'app' }
  const prompt = interactiveTestDevelopmentPrompt({ hint })
  assert.ok(prompt.length < 3000)
  assert.ok(prompt.includes(JSON.stringify(hint)))
  assert.match(prompt, /latest result for this case/)
  assert.match(prompt, /voidr-failure-analysis/)
  assert.doesNotMatch(prompt, /AUTHORING OWNERSHIP|BINDING DECISION|session_coverage_picker|blip-incident-remediation/)
  const skill = loadDshPluginSkills().find(skill => skill.name === 'voidr-failure-analysis')
  assert.match(skill.content, /This skill diagnoses only/)
  assert.match(skill.content, /Visual analysis is optional/)
  assert.match(skill.content, /playwright_get_test_history/)
  assert.match(skill.content, /passed latest result is not a failure/)
})

test('a Monitor without a selected test retains general task discovery', () => {
  assert.match(interactiveTestDevelopmentPrompt({ hint: { surface: 'monitor' } }), /blip-incident-remediation/)
})


test('plan-level Monitor resolves a scoped execution without inventing a case slug', () => {
  const prompt = interactiveTestDevelopmentPrompt({ hint: { surface: 'monitor', testPlanId: 'plan' } })
  assert.match(prompt, /both plan and case are selected/)
  assert.match(prompt, /executions_list_executions scoped to the selected plan/)
})
