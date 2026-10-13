import assert from 'node:assert/strict'
import test from 'node:test'
import { apply } from '../adapters/dsh/index.mjs'
import { loadDshPluginSkills } from '../adapters/dsh/plugin-skills.mjs'

const spendKey = Symbol.for('voidr.dsh.litellm-contexts.v1')

test('bundles the preventive Monitor skill with authenticated lifecycle tools and confirmation gates', () => {
  const skill = loadDshPluginSkills().find(item => item.name === 'blip-preventive-monitor')
  assert.ok(skill)
  assert.equal(skill.provider, 'voidr-plugin')
  for (const tool of [
    'preventive_monitor_list_journeys',
    'preventive_monitor_create_journey',
    'preventive_monitor_update_journey',
    'preventive_monitor_run_journey',
    'preventive_monitor_list_radar_situations',
    'preventive_monitor_update_radar_situation',
    'preventive_monitor_diagnose_radar_situation',
    'preventive_monitor_update_threshold_state',
    'preventive_monitor_update_knowledge_pattern_state',
    'preventive_monitor_get_dashboard'
  ]) assert.match(skill.content, new RegExp(tool))
  assert.match(skill.content, /confirmação explícita/)
  assert.match(skill.content, /Hive executa diagnósticos assíncronos/)
  assert.match(skill.content, /Nunca despache um agente do Hive diretamente/)
})

test('loads the skill and preserves scoped Radar context on the preventive Monitor surface', () => {
  delete globalThis[spendKey]
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
  const context = {
    surface: 'preventive-monitor',
    route: '/monitor/preventive-signals',
    intent: 'explain-radar-situation',
    assistantAction: 'explain',
    radarSituationId: 'radar-1',
    radarSituationTitle: 'Latência crescente no Iris',
    radarSituationStatus: 'observing',
    radarDecisionSummary: 'Faltam dois critérios',
    radarDecisionCriteria: [{ key: 'latency', met: false }],
    radarSignals: [{ source: 'metrics', value: 1.4 }]
  }
  const rawInput = Buffer.from(JSON.stringify(context)).toString('base64url')
  const agent = { id: 'session-preventive', session: { append(type, data) { events.push({ type, data }) } } }
  assert.equal(contextCommand.handler({ agent, rawInput }).kind, 'success')
  assert.deepEqual(events[0].data, context)
  assert.deepEqual(globalThis[spendKey].get(agent.id), {
    surface: 'preventive-monitor', action: 'voidr_dsh_general'
  })
  assert.match(promptVariable({ agent: { session: { events } } }), /Active surface skill: blip-preventive-monitor/)
  delete globalThis[spendKey]
})
