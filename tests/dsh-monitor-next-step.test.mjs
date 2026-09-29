import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadDshPluginSkills } from '../adapters/dsh/plugin-skills.mjs'

test('Monitor follows diagnosis-specific next steps without optional forms', () => {
  const skill = loadDshPluginSkills().find(item => item.name === 'voidr-failure-analysis')

  assert.ok(skill)
  assert.match(skill.content, /optional next step after a completed diagnosis, ask one short question in normal chat/)
  assert.match(skill.content, /application defect, offer to register or update the defect/)
  assert.match(skill.content, /outdated test, offer to correct and validate that exact test/)
  assert.match(skill.content, /test-data gap or environment instability, name the missing prerequisite/)
  assert.match(skill.content, /indeterminate cause, request the specific missing evidence or stop/)
  assert.match(skill.content, /two distinct actions are both evidence-backed and available, show a short Markdown list/)
  assert.match(skill.content, /A suggested action is not approval to create a defect/)
})
