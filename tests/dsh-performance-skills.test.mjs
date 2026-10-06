import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../adapters/dsh/index.mjs'
import { loadDshPluginSkills } from '../adapters/dsh/plugin-skills.mjs'
import { qualifyDshVoidrTools } from '../adapters/dsh/skill-parity.mjs'

const skills = Object.fromEntries(loadDshPluginSkills().map(skill => [skill.name, skill.content]))

test('DSH bundles four distinct performance stages with exact tool namespaces', () => {
  for (const name of [
    'voidr-performance-setup',
    'voidr-performance-author',
    'voidr-performance-validate',
    'voidr-performance-execute'
  ]) assert.ok(skills[name], name)

  assert.match(skills['voidr-performance-setup'], /mcp__voidr__performance_resolve_context/)
  assert.match(skills['voidr-performance-setup'], /performance_app_picker/)
  assert.match(skills['voidr-performance-setup'], /type: API/)
  assert.match(skills['voidr-performance-author'], /mcp__performance-authoring__author_performance_artifact/)
  assert.match(skills['voidr-performance-author'], /mcp__performance-authoring__apply_performance_artifact/)
  assert.match(skills['voidr-performance-validate'], /mcp__voidr__performance_validate_scenario/)
  assert.match(skills['voidr-performance-validate'], /done: true.*passed: true/)
  assert.match(skills['voidr-performance-validate'], /mcp__voidr__performance_get_preflight_result/)
  assert.match(skills['voidr-performance-execute'], /mcp__voidr__performance_prepare_run/)
  assert.match(skills['voidr-performance-execute'], /mcp__voidr__performance_create_run/)
  assert.match(skills['voidr-performance-execute'], /mcp__voidr__performance_analyze_run/)
  assert.equal(qualifyDshVoidrTools('performance_get_run'), 'mcp__voidr__performance_get_run')
})

test('performance surface loads setup and explicit load intent routes there globally', () => {
  const variables = new Map()
  apply({
    skills: { register() {} },
    systemPrompt: { section() {}, variable(name, handler) { variables.set(name, handler) } },
    commands: { register() {} },
    tools: { register() {} },
    on() {}
  })
  const promptFor = events => variables.get('voidr_interactive_test_development')({
    agent: { session: { events } }
  })
  const performance = promptFor([{
    type: 'voidr/project-context-hint', data: { surface: 'performance' }
  }])
  assert.match(performance, /Active surface skill: voidr-performance-setup/)
  assert.match(performance, /mcp__voidr__performance_resolve_context/)
  assert.match(performance, /PerformancePlan, PerformanceRun and PerformanceReport/)
  assert.doesNotMatch(performance, /The persisted Test Plan binding is authoritative/)
  assert.match(promptFor([]), /load voidr-performance-setup/)
})
