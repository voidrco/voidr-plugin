import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { registerEchoProposeOverviewChange, buildPreviewArguments, echoProposeOverviewChangeSchema, echoOverviewQuestionDenial } from '../adapters/dsh/echo-propose-overview-change.mjs'
import { registerEchoMemberPolicy, echoMemberToolDenial } from '../adapters/dsh/echo-member-policy.mjs'
import { registerEchoActor } from '../adapters/dsh/echo-actor.mjs'
import { loadDshPluginSkills } from '../adapters/dsh/plugin-skills.mjs'
import { echoOverviewStudioDenial } from '../adapters/dsh/echo-overview-studio.mjs'

const APP = '6a6cfa72d43cf76203eaf843'
const proposal = { applicationId: APP, intent: 'edit', name: 'Operação', summary: 'Adiciona KPI de transferência', operations: [{ action: 'add_kpi', metric: 'transfer_rate' }], assumptions: [] }
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

function typeArrays(schema, path = 'schema') {
  if (!schema || typeof schema !== 'object') return []
  const own = Array.isArray(schema.type) ? [path] : []
  return [...own, ...Object.entries(schema).flatMap(([key, value]) => typeArrays(value, path + '.' + key))]
}

test('closed schema rejects unknown fields and requires a product', () => {
  assert.equal(echoProposeOverviewChangeSchema.additionalProperties, false)
  const { tool } = setup()
  assert.deepEqual([...typeArrays(tool.parameters), ...typeArrays(tool.output.schema)], [])
  assert.deepEqual(buildPreviewArguments({ intent: 'edit', summary: 'x', operations: [{ action: 'update', blockId: 'c_000001', journey: '' }] }, { applicationId: APP }).operations, [{ action: 'update', blockId: 'c_000001', journey: null }])
  assert.equal(echoProposeOverviewChangeSchema.properties.operations.items.additionalProperties, false)
  assert.deepEqual(
    buildPreviewArguments({ intent: 'edit', summary: 'x', operations: [{ action: 'style', blockId: 'ops_transfer_by_journey', color: 'amber', seriesColors: [{ key: 'cancelamento', color: 'red' }, { key: 'consulta-fatura', color: 'default' }], thresholds: [{ operator: 'gt', value: 0.25, color: 'green' }] }] }, { applicationId: APP }).operations,
    [{ action: 'style', blockId: 'ops_transfer_by_journey', color: 'amber', seriesColors: { cancelamento: 'red', 'consulta-fatura': 'default' }, thresholds: [{ operator: 'gt', value: 0.25, color: 'green' }] }]
  )
  assert.equal(echoProposeOverviewChangeSchema.properties.operations.items.properties.color.enum.includes('#ff0000'), false)
  assert.throws(() => buildPreviewArguments({ ...proposal, color: '#f00' }), /Unsupported fields: color/)
  assert.throws(() => buildPreviewArguments({ intent: 'edit', summary: 'x' }, {}), /No product is selected/)
  assert.deepEqual(buildPreviewArguments({ intent: 'delete', summary: 'x' }, { echoContext: { applicationId: APP } }), { intent: 'delete', summary: 'x', applicationId: APP, operations: [] })
})

test('a ready preview calls the service tool once and publishes a card that only references the proposal', async () => {
  const { tool, events, calls, exec } = setup()
  const { applicationId, ...withoutApp } = proposal
  const output = await tool.execute(withoutApp, exec)
  const { assumptions, ...serviceArgs } = withoutApp
  assert.equal(applicationId, APP)
  assert.deepEqual(assumptions, [])
  assert.equal(calls.length, 1)
  assert.equal(calls[0][1], 'echo_preview_overview_change')
  assert.deepEqual(calls[0][2], { ...serviceArgs, applicationId: APP })
  assert.deepEqual(calls[0][4], { allowError: true })
  assert.deepEqual(output, { status: 'ready', proposalId: 'p1', kind: 'create', name: 'Operação', changes: 1, warnings: [] })
  assert.equal(events.length, 1)
  assert.equal(events[0].type, 'voidr/widget')
  assert.equal(events[0].data.widget.interactive, false)
  assert.deepEqual(events[0].data.widget.spec.elements.proposal, { type: 'EchoOverviewProposal', props: { proposalId: 'p1', applicationId: APP } })
  assert.match(tool.output.render(proposal, output)[0].text, /Nothing changed yet/)
  assert.match(tool.output.render(proposal, output)[0].text, /end the turn: no questions/)
})

test('a proposal built on unconfirmed choices publishes nothing and tells the model to ask first', async () => {
  const { tool, events, calls, exec } = setup()
  const guessed = { ...proposal, operations: [{ action: 'add_ranking', metric: 'deviation_rate', breakdown: 'journey' }], assumptions: ['deviation_rate stands in for incorrect closings', ' '] }
  const output = await tool.execute(guessed, exec)
  assert.deepEqual(output, { status: 'needs_confirmation', assumptions: ['deviation_rate stands in for incorrect closings'] })
  assert.equal(calls.length, 0)
  assert.equal(events.length, 0)
  const text = tool.output.render(guessed, output)[0].text
  assert.match(text, /Nothing was published/)
  assert.match(text, /ask_user_question/)
  assert.ok(echoProposeOverviewChangeSchema.required.includes('assumptions'))
})

test('judge criteria reach the service unchanged and only from the closed list', () => {
  const criterion = echoProposeOverviewChangeSchema.properties.operations.items.properties.criterion
  assert.ok(criterion.enum.includes('appropriate_closure'))
  assert.equal(criterion.enum.length, 11)
  assert.deepEqual(
    buildPreviewArguments({ intent: 'edit', summary: 'x', assumptions: [], operations: [{ action: 'add_ranking', metric: 'criterion_fail_rate', criterion: 'appropriate_closure', breakdown: 'journey' }] }, { applicationId: APP }),
    { intent: 'edit', summary: 'x', applicationId: APP, operations: [{ action: 'add_ranking', metric: 'criterion_fail_rate', criterion: 'appropriate_closure', breakdown: 'journey' }] }
  )
})

test('after a proposal card in the same turn the model cannot ask a question', () => {
  const card = { type: 'voidr/widget', data: { widget: { id: 'echo-overview-proposal-p1' } } }
  const otherWidget = { type: 'voidr/widget', data: { widget: { id: 'echo-deviations-x' } } }
  assert.match(echoOverviewQuestionDenial('ask_user_question', [{ type: 'turn/start' }, card]), /end the turn/)
  assert.equal(echoOverviewQuestionDenial('ask_user_question', [{ type: 'turn/start' }, card, { type: 'turn/start' }]), null)
  assert.equal(echoOverviewQuestionDenial('ask_user_question', [{ type: 'turn/start' }, otherWidget]), null)
  assert.equal(echoOverviewQuestionDenial('echo_propose_overview_change', [{ type: 'turn/start' }, card]), null)
  assert.equal(echoOverviewQuestionDenial('ask_user_question', undefined), null)
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

test('the proposal schema follows the service grid and metric model without templates', () => {
  const properties = echoProposeOverviewChangeSchema.properties
  const operation = properties.operations.items.properties
  const base = new RegExp(properties.base.pattern)
  assert.equal(base.test('template:operations'), false)
  assert.equal(base.test('voidr'), true)
  assert.equal(base.test('preset:6a6cfa72d43cf76203eaf843'), true)
  assert.deepEqual(operation.width.enum, [3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  assert.deepEqual([operation.height.minimum, operation.height.maximum], [3, 24])
  assert.equal(operation.custom.additionalProperties, false)
  assert.equal(operation.custom.properties.where.items.additionalProperties, false)
  assert.equal(operation.breakdown.enum, undefined)
  assert.doesNotMatch(JSON.stringify(echoProposeOverviewChangeSchema), /anyOf|template:/)
  const custom = { name: 'Encerramento pelo cliente', subject: 'session', kind: 'rate', where: [{ field: 'session.termination_initiator', op: 'in', values: ['persona', 'agent'] }], match: [{ field: 'session.termination_initiator', op: 'in', values: ['persona'] }] }
  assert.deepEqual(
    buildPreviewArguments({ intent: 'edit', summary: 'x', operations: [{ action: 'add_ranking', metric: 'custom', custom, breakdown: 'session.journey', width: 10, height: 12 }] }, { applicationId: APP }).operations,
    [{ action: 'add_ranking', metric: 'custom', custom, breakdown: 'session.journey', width: 10, height: 12 }]
  )
})

test('the overview studio routes changes to the open draft', () => {
  const draftId = '6ac3f9a1b2c3d4e5f6a7b8c9'
  const studio = [{ type: 'voidr/project-context-hint', data: { surface: 'echo', echoContext: { applicationId: APP, overviewDraftId: draftId, overviewSelectedBlocks: 'c_kpi,success_rate' } } }]
  const page = [{ type: 'voidr/project-context-hint', data: { surface: 'echo', echoContext: { applicationId: APP } } }]
  assert.match(echoOverviewStudioDenial('echo_propose_overview_change', proposal, studio), new RegExp('mcp__voidr__echo_edit_overview_draft and draftId ' + draftId))
  assert.equal(echoOverviewStudioDenial('echo_propose_overview_change', proposal, page), null)
  assert.match(echoOverviewStudioDenial('mcp__voidr__echo_get_overview_view', { applicationId: APP }, studio), new RegExp('with draftId ' + draftId))
  assert.equal(echoOverviewStudioDenial('mcp__voidr__echo_get_overview_view', { applicationId: APP, draftId }, studio), null)
  assert.equal(echoOverviewStudioDenial('mcp__voidr__echo_get_overview_view', { applicationId: APP }, page), null)
  assert.equal(echoOverviewStudioDenial('mcp__voidr__echo_edit_overview_draft', { draftId, operations: [], summary: 'x' }, studio), null)
  assert.match(echoOverviewStudioDenial('mcp__voidr__echo_edit_overview_draft', { draftId: '6ac3f9a1b2c3d4e5f6a7b8c0', operations: [] }, studio), new RegExp('draftId ' + draftId))
  assert.match(echoOverviewStudioDenial('mcp__voidr__echo_edit_overview_draft', { draftId, operations: [] }, page), /No overview studio is open/)
  assert.equal(echoOverviewStudioDenial('mcp__voidr__echo_get_overview', {}, studio), null)
  const stale = [...studio, ...page]
  assert.equal(echoOverviewStudioDenial('echo_propose_overview_change', proposal, stale), null)
})

test('native overview tool is part of the Echo family and documented in the skill', () => {
  const skill = loadDshPluginSkills().find(item => item.name === 'voidr-echo-analysis')
  assert.match(skill.content, /## Overview customization/)
  assert.match(skill.content, /`echo_propose_overview_change`/)
  assert.doesNotMatch(skill.content, /mcp__voidr__echo_propose_overview_change/)
  assert.match(skill.content, /mcp__voidr__echo_get_overview_view/)
  assert.match(skill.content, /Align before proposing/)
  assert.match(skill.content, /`criterion_fail_rate`/)
  assert.match(skill.content, /### In the overview studio/)
  assert.match(skill.content, /`mcp__voidr__echo_edit_overview_draft`/)
  assert.match(skill.content, /`echoContext.overviewSelectedBlocks`/)
  assert.match(skill.content, /`grid.freeSpaces`/)
  assert.match(skill.content, /`heightAdjustable`/)
  assert.match(skill.content, /resize the blocks in that row so they add up to 12 columns/)
  assert.match(skill.content, /who reads this screen and which decision it supports/)
  assert.match(skill.content, /`mcp__voidr__echo_query_overview_metric`/)
  assert.doesNotMatch(skill.content, /template/i)
})
