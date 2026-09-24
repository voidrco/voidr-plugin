import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../adapters/dsh/index.mjs'
import { loadDshPluginSkills } from '../adapters/dsh/plugin-skills.mjs'
import { qualifyDshVoidrTools } from '../adapters/dsh/skill-parity.mjs'

test('Hero analysis is bundled globally with qualified reads and controlled writes', () => {
  const skill = loadDshPluginSkills().find(item => item.name === 'voidr-hero-analysis')
  assert.ok(skill)
  assert.match(skill.content, /mcp__voidr__hero_list_triaged/)
  assert.match(skill.content, /mcp__voidr__hero_explain_ticket/)
  assert.match(skill.content, /mcp__voidr__hero_list_actionable/)
  assert.match(skill.content, /mcp__voidr__hero_identify_repo/)
  assert.match(skill.content, /mcp__voidr__defects_triage_defect/)
  assert.match(skill.content, /mcp__voidr__hero_reprocess_ticket/)
  assert.match(skill.content, /mode: "restart"/)
  assert.match(skill.content, /supersedeActive: true/)
  assert.match(skill.content, /preset: "hero_run_progress"/)
  assert.match(skill.content, /Do not send `type: "HeroRunProgress"`/)
  assert.equal(qualifyDshVoidrTools('hero_list_triaged'), 'mcp__voidr__hero_list_triaged')
  assert.equal(qualifyDshVoidrTools('hero_run_progress'), 'hero_run_progress')
})

test('Hero skill is discoverable from every DSH surface', () => {
  const variables = new Map()
  apply({
    skills: { register() {} },
    systemPrompt: { section() {}, variable(name, handler) { variables.set(name, handler) } },
    commands: { register() {} },
    tools: { register() {} },
    on() {}
  })
  const prompt = variables.get('voidr_interactive_test_development')({
    agent: { session: { events: [] } }
  })
  assert.match(prompt, /load voidr-hero-analysis/)
})
