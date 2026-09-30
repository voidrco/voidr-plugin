import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../adapters/dsh/index.mjs'
import { loadDshPluginSkills } from '../adapters/dsh/plugin-skills.mjs'

test('Gate skill is bundled with the stored-verdict and governance reads', () => {
  const skill = loadDshPluginSkills().find(item => item.name === 'voidr-gate-analysis')
  assert.ok(skill)
  assert.match(skill.content, /mcp__voidr__voidr_gate_list_pr_analyses/)
  assert.match(skill.content, /mcp__voidr__voidr_gate_get_pr_analysis/)
  assert.match(skill.content, /mcp__voidr__voidr_gate_get_governance/)
  assert.match(skill.content, /JourneyProposalConfirm/)
  assert.match(skill.content, /declare_journey/)
  assert.match(skill.content, /confirmed: true/)
  assert.match(skill.content, /MatchJobProgress/)
  assert.match(skill.content, /one specific, evidence-backed next action/)
  assert.match(skill.content, /not a menu or `ask_user_question` form/)
  assert.match(skill.content, /not consent to create a journey, decide governance/)
})

test('Gate screen loads its skill and preserves the scoped navigation hint', () => {
  let promptVariable
  let contextCommand
  apply({
    skills: { register() {} },
    systemPrompt: { section() {}, variable(_name, handler) { promptVariable = handler } },
    commands: { register(command) { if (command.name === 'assistant-context') contextCommand = command } },
    tools: { register() {} },
    on() {}
  })
  const events = []
  const gateContext = { gateScreen: 'change', analysisId: 'analysis-1' }
  const rawInput = Buffer.from(JSON.stringify({ surface: 'voidr-gate', gateContext })).toString('base64url')
  assert.equal(contextCommand.handler({ agent: { id: 'session-1', session: { append(type, data) { events.push({ type, data }) } } }, rawInput }).kind, 'success')
  assert.deepEqual(events[0].data.gateContext, gateContext)
  assert.match(promptVariable({ agent: { session: { events } } }), /Active surface skill: voidr-gate-analysis/)
})
