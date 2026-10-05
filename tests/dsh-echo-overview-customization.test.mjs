import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { registerEchoProposeOverviewChange, buildPreviewArguments, echoProposeOverviewChangeSchema } from '../adapters/dsh/echo-propose-overview-change.mjs'
import { registerEchoMemberPolicy, echoMemberToolDenial } from '../adapters/dsh/echo-member-policy.mjs'
import { registerEchoActor } from '../adapters/dsh/echo-actor.mjs'
import { loadDshPluginSkills } from '../adapters/dsh/plugin-skills.mjs'

const APP = '6a6cfa72d43cf76203eaf843'
const proposal = { applicationId: APP, intent: 'edit', name: 'Operação', summary: 'Adiciona KPI de transferência', operations: [{ action: 'add_kpi', metric: 'transfer_rate' }] }
const ready = { status: 'ready', proposalId: 'p1', applicationId: APP, kind: 'create', name: 'Operação', presetName: null, changes: [{ kind: 'added' }], warnings: [] }
const envelope = data => ({ structuredContent: { data } })

function setup(call = async () => envelope(ready)) {
  let tool
  const events = []
  const calls = []
  registerEchoProposeOverviewChange({ tools: { register: value => { tool = value } } }, async (...args) => { calls.push(args); return call(...args) })
  const agent = { session: { events: [{ type: 'voidr/project-context-hint', data: { surface: 'echo', echoContext: { applicationId: APP } } }], append: (type, data) => events.push({ type, data }) } }
  return { tool, events, calls, exec: { agent } }
}

test('closed schema rejects unknown fields and requires a product', () => {
  assert.equal(echoProposeOverviewChangeSchema.additionalProperties, false)
  assert.equal(echoProposeOverviewChangeSchema.properties.operations.items.additionalProperties, false)
  assert.throws(() => buildPreviewArguments({ ...proposal, color: '#f00' }), /Unsupported fields: color/)
  assert.throws(() => buildPreviewArguments({ intent: 'edit', summary: 'x' }, {}), /No product is selected/)
  assert.deepEqual(buildPreviewArguments({ intent: 'delete', summary: 'x' }, { echoContext: { applicationId: APP } }), { intent: 'delete', summary: 'x', applicationId: APP, operations: [] })
})

test('a ready preview calls the service tool once and publishes a card that only references the proposal', async () => {
  const { tool, events, calls, exec } = setup()
  const { applicationId, ...withoutApp } = proposal
  const output = await tool.execute(withoutApp, exec)
  assert.equal(applicationId, APP)
  assert.equal(calls.length, 1)
  assert.equal(calls[0][1], 'echo_preview_overview_change')
  assert.deepEqual(calls[0][2], { ...withoutApp, applicationId: APP })
  assert.deepEqual(calls[0][4], { allowError: true })
  assert.deepEqual(output, { status: 'ready', proposalId: 'p1', kind: 'create', name: 'Operação', presetName: null, changes: 1, warnings: [] })
  assert.equal(events.length, 1)
  assert.equal(events[0].type, 'voidr/widget')
  assert.equal(events[0].data.widget.interactive, false)
  assert.deepEqual(events[0].data.widget.spec.elements.proposal, { type: 'EchoOverviewProposal', props: { proposalId: 'p1', applicationId: APP } })
  assert.match(tool.output.render(proposal, output)[0].text, /Nothing changed yet/)
})

test('invalid proposals, service errors and cancellation publish nothing', async () => {
  const invalid = setup(async () => envelope({ status: 'invalid', issues: [{ operation: 0, code: 'unknown_metric', message: 'Unknown metric revenue' }] }))
  const output = await invalid.tool.execute(proposal, invalid.exec)
  assert.equal(output.status, 'invalid')
  assert.match(invalid.tool.output.render(proposal, output)[0].text, /operation 0: Unknown metric revenue/)
  assert.equal(invalid.events.length, 0)
  const rejected = setup(async () => ({ isError: true, content: [{ type: 'text', text: 'operations.0.metric: Invalid enum value' }] }))
  await assert.rejects(rejected.tool.execute(proposal, rejected.exec), /Overview change rejected: operations\.0\.metric/)
  assert.equal(rejected.events.length, 0)
  const malformed = setup(async () => envelope({ status: 'applied' }))
  await assert.rejects(malformed.tool.execute(proposal, malformed.exec), /no preview was published/)
  const cancelled = setup()
  await assert.rejects(cancelled.tool.execute(proposal, { ...cancelled.exec, signal: AbortSignal.abort() }))
  assert.equal(cancelled.events.length, 0)
})

test('the raw preview tool stays hidden from the model and refuses direct calls', async () => {
  const registered = []
  const hooks = new Map()
  let command
  registerEchoActor({ on: (event, fn) => hooks.set(event, fn), commands: { register: value => { command = value } }, tools: { register: value => registered.push(value.name) } }, {
    env: { DSH_VOIDR_MCP_URL: 'http://localhost/v1/mcp', DSH_VOIDR_MCP_AUTHORIZATION: 'Basic local' },
    fetchImpl: async url => ({ ok: true, json: async () => url.endsWith('/tools/list')
      ? { tools: ['echo_get_overview_view', 'echo_preview_overview_change'].map(name => ({ name, description: name, inputSchema: { type: 'object' } })) }
      : { content: [{ type: 'text', text: '{}' }] } })
  })
  const agent = { id: 'a', session: { events: [{ type: 'voidr/project-context-hint', data: { surface: 'echo' } }] } }
  await command.handler({ agent, rawInput: 'signed' })
  assert.ok(registered.includes('mcp__voidr__echo_get_overview_view'))
  assert.ok(!registered.some(name => name.includes('echo_preview_overview_change')))
  await assert.rejects(hooks.get('tools/execute')({ name: 'mcp__voidr__echo_preview_overview_change', agent, arguments: {} }, () => null), /echo_propose_overview_change/)
})

test('restricted Echo members keep Echo tools and bundled references only', async () => {
  const hooks = new Map()
  let command
  const denial = registerEchoMemberPolicy({ on: (event, fn) => hooks.set(event, fn), commands: { register: value => { command = value } } })
  const agent = { id: 'member' }
  const other = { id: 'editor' }
  assert.equal(command.recordInput, false)
  assert.equal(denial({ name: 'bash', agent, arguments: { command: 'ls' } }), null)
  assert.equal((await command.handler({ agent, rawInput: ' restricted ' })).kind, 'success')
  for (const name of ['bash', 'write', 'edit', 'web_fetch', 'mcp__voidr__list_applications', 'mcp__github__get_me']) {
    assert.match(denial({ name, agent, arguments: {} }), /Not available on Echo/)
  }
  for (const name of ['mcp__voidr__echo_get_overview_view', 'echo_propose_overview_change', 'echo_render_deviations', 'ask_user_question', 'render_widget']) {
    assert.equal(denial({ name, agent, arguments: {} }), null)
  }
  assert.match(denial({ name: 'read', agent, arguments: { file_path: '/etc/passwd' } }), /Not available/)
  assert.match(denial({ name: 'read', agent, arguments: { file_path: join(process.cwd(), 'adapters/dsh/skills/../index.mjs') } }), /Not available/)
  assert.equal(echoMemberToolDenial('read', { file_path: join(process.cwd(), 'adapters/dsh/skills/voidr-echo-analysis/SKILL.md') }), null)
  assert.equal(denial({ name: 'bash', agent: other, arguments: {} }), null)
  assert.equal((await command.handler({ agent, rawInput: 'anything' })).kind, 'error')
  hooks.get('agent/disposed')({ agent })
  assert.equal(denial({ name: 'bash', agent, arguments: {} }), null)
})

test('native overview tool is part of the Echo family and documented in the skill', () => {
  const skill = loadDshPluginSkills().find(item => item.name === 'voidr-echo-analysis')
  assert.match(skill.content, /## Overview customization/)
  assert.match(skill.content, /`echo_propose_overview_change`/)
  assert.doesNotMatch(skill.content, /mcp__voidr__echo_propose_overview_change/)
  assert.match(skill.content, /mcp__voidr__echo_get_overview_view/)
})
