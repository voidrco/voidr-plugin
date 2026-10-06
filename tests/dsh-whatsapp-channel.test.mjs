import { test } from 'node:test'
import assert from 'node:assert/strict'
import { whatsappChannelDenial, contextChannel } from '../adapters/dsh/whatsapp-channel.mjs'
import { registerEchoProposeOverviewChange, echoOverviewQuestionDenial } from '../adapters/dsh/echo-propose-overview-change.mjs'

const APP = '6a6cfa72d43cf76203eaf843'
const hint = data => ({ type: 'voidr/project-context-hint', data })
const ready = { status: 'ready', proposalId: 'p1', applicationId: APP, kind: 'create', name: 'Operação', presetName: null, changes: [{ kind: 'added' }], warnings: [] }

function setup(contextHint) {
  let tool
  const events = [{ type: 'turn/start' }]
  registerEchoProposeOverviewChange({ tools: { register: value => { tool = value } } }, async () => ({ structuredContent: { data: ready } }))
  const agent = { session: { events: [hint(contextHint), ...events], append: (type, data) => events.push({ type, data }) } }
  return { tool, events, exec: { agent } }
}

test('widget tools are denied only on the WhatsApp channel', () => {
  const whatsapp = [hint({ surface: 'echo', channel: 'whatsapp' })]
  const web = [hint({ surface: 'echo' })]
  assert.equal(contextChannel(whatsapp), 'whatsapp')
  assert.match(whatsappChannelDenial('render_widget', whatsapp), /echo_share_overview/)
  assert.match(whatsappChannelDenial('echo_render_deviations', whatsapp), /only shows text/)
  assert.equal(whatsappChannelDenial('render_widget', web), null)
  assert.equal(whatsappChannelDenial('mcp__voidr__echo_get_overview_view', whatsapp), null)
})

test('on WhatsApp a proposal is stored without a card and points to the share tool', async () => {
  const { tool, events, exec } = setup({ surface: 'echo', channel: 'whatsapp', applicationId: APP })
  const output = await tool.execute({ intent: 'edit', name: 'Operação', summary: 'KPI', operations: [{ action: 'add_kpi', metric: 'transfer_rate' }], assumptions: [] }, exec)
  assert.equal(output.channel, 'whatsapp')
  assert.equal(events.some(event => event.type === 'voidr/widget'), false)
  const [rendered] = tool.output.render({}, output)
  assert.match(rendered.text, /echo_share_overview with source "proposal" and proposalId "p1"/)
  assert.equal(echoOverviewQuestionDenial('ask_user_question', exec.agent.session.events), null)
})

test('on the platform the proposal card is still published', async () => {
  const { tool, events, exec } = setup({ surface: 'echo', applicationId: APP })
  const output = await tool.execute({ intent: 'edit', name: 'Operação', summary: 'KPI', operations: [{ action: 'add_kpi', metric: 'transfer_rate' }], assumptions: [] }, exec)
  assert.equal(output.channel, undefined)
  assert.equal(events.filter(event => event.type === 'voidr/widget').length, 1)
})
