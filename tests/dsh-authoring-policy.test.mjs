import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { apply, inject } from '../adapters/dsh/index.mjs'
import { loadDshPluginSkills } from '../adapters/dsh/plugin-skills.mjs'
import { AGENT_OWNED_AUTHORING_TOOLS } from '../core/policies/agent-owned-authoring.mjs'
import { interactiveTestDevelopmentPrompt } from '../core/workflow/interactive-test-development.mjs'
import { loadPolicy } from '../scripts/lib/policy.mjs'

test('DSH registers the three agent-owned authoring skills', () => {
  const skills = loadDshPluginSkills()
  assert.deepEqual(
    skills.map(skill => skill.name),
    ['voidr-automate', 'voidr-journeys', 'voidr-spec']
  )
  assert.equal(inject.includes('skills'), true)
  for (const skill of skills) {
    assert.equal(skill.provider, 'voidr-plugin')
    assert.equal(skill.content.length > 300, true)
  }
})

test('DSH denies every delegated authoring tool before execution', async () => {
  const handlers = new Map()
  const registeredSkills = []
  apply({
    skills: { register: skill => registeredSkills.push(skill) },
    systemPrompt: { section: () => undefined },
    commands: { register: () => undefined },
    tools: {},
    on: (event, handler) => handlers.set(event, handler)
  })

  assert.equal(registeredSkills.length, 3)
  const preExecute = handlers.get('tools/pre-execute')
  assert.equal(typeof preExecute, 'function')

  for (const [tool, skill] of Object.entries(AGENT_OWNED_AUTHORING_TOOLS)) {
    const decision = await preExecute(
      { name: `mcp__voidr__${tool}`, args: {} },
      async () => ({ kind: 'allow' })
    )
    assert.equal(decision.kind, 'deny', tool)
    assert.match(decision.reason, new RegExp(skill), tool)
  }

  const allowed = await preExecute(
    { name: 'mcp__voidr__test_plans_get_test_plan', args: {} },
    async () => ({ kind: 'allow' })
  )
  assert.deepEqual(allowed, { kind: 'allow' })
})

test('shared policy blocks the same authoring shortcuts on every plugin host', () => {
  const policy = loadPolicy()
  for (const tool of Object.keys(AGENT_OWNED_AUTHORING_TOOLS)) {
    assert.equal(policy.forbiddenTools.includes(tool), true, tool)
    assert.equal(policy.safeRemoteTools.includes(tool), false, tool)
  }
})

test('authoring skills route persistence through deterministic Service tools', () => {
  const byName = Object.fromEntries(loadDshPluginSkills().map(skill => [skill.name, skill]))
  assert.match(byName['voidr-spec'].content, /test_plans_update_module_spec/)
  assert.match(byName['voidr-journeys'].content, /test_plans_create_case/)
  assert.match(byName['voidr-journeys'].content, /test_plans_update_case/)
  assert.match(byName['voidr-automate'].content, /assistant_workspace_deploy_validation/)
  assert.match(byName['voidr-automate'].content, /assistant_workspace_run_validation/)

  const prompt = readFileSync(
    new URL('../core/workflow/interactive-test-development.mjs', import.meta.url),
    'utf8'
  )
  for (const skill of Object.keys(byName)) assert.match(prompt, new RegExp(skill))
})

test('each DSH authoring skill owns an interactive intake and write gate', () => {
  const byName = Object.fromEntries(loadDshPluginSkills().map(skill => [skill.name, skill]))

  for (const skill of Object.values(byName)) {
    assert.match(skill.content, /ask_user_question/)
    assert.match(skill.content, /IDs?\s+estáve(?:l|is)/)
    assert.match(skill.content, /não repita/i)
  }

  for (const id of ['spec-destination', 'spec-source', 'spec-scope', 'spec-focus', 'spec-approve']) {
    assert.match(byName['voidr-spec'].content, new RegExp(id))
  }
  for (const id of [
    'journeys-target',
    'journeys-destination',
    'journeys-source',
    'journeys-coverage',
    'journeys-volume',
    'journeys-approve'
  ]) {
    assert.match(byName['voidr-journeys'].content, new RegExp(id))
  }
  for (const id of [
    'automate-cases',
    'automate-scope',
    'automate-environment',
    'automate-approve-edit',
    'automate-promote',
    'automate-publish'
  ]) {
    assert.match(byName['voidr-automate'].content, new RegExp(id))
  }

  const prompt = interactiveTestDevelopmentPrompt()
  assert.match(prompt, /mandatory interactive intake/)
  assert.match(prompt, /ask_user_question/)
})

test('DSH uses product widgets for recording and file evidence', () => {
  const prompt = interactiveTestDevelopmentPrompt()
  assert.match(prompt, /session_coverage_picker/)
  assert.match(prompt, /document_input/)
  assert.match(prompt, /Do not ask the user to describe a browser flow in a text field/)

  const byName = Object.fromEntries(loadDshPluginSkills().map(skill => [skill.name, skill]))
  assert.match(byName['voidr-spec'].content, /session_coverage_picker/)
  assert.match(byName['voidr-journeys'].content, /session_coverage_picker/)
  assert.match(byName['voidr-automate'].content, /document_input/)
})

test('spec and journey intake always preserve the three evidence paths', () => {
  const byName = Object.fromEntries(loadDshPluginSkills().map(skill => [skill.name, skill]))

  for (const name of ['voidr-spec', 'voidr-journeys']) {
    assert.match(byName[name].content, /Gravar nova sessão/)
    assert.match(byName[name].content, /Usar sessões gravadas/)
    assert.match(byName[name].content, /Enviar documentação/)
    assert.match(byName[name].content, /session_coverage_picker/)
    assert.match(byName[name].content, /document_input/)
  }

  assert.match(
    interactiveTestDevelopmentPrompt(),
    /record a new session, use recorded sessions, and send documentation/
  )
})
