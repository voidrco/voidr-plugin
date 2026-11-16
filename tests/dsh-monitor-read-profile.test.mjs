import test from 'node:test'
import assert from 'node:assert/strict'
import { registerMonitorReadProfile, simpleMonitorRead } from '../adapters/dsh/monitor-read-profile.mjs'

const hint = { type: 'voidr/project-context-hint', data: { surface: 'monitor', testPlanId: 'plan', testCaseSlug: 'CASE-1' } }
const user = text => ({ source: { kind: 'user' }, content: [{ type: 'text', text }] })
const question = text => ({ type: 'user/message', data: user(text) })
const model = `assistant--${Buffer.from(JSON.stringify(['deepseek-official', 'deepseek-flash-latest'])).toString('base64url')}`
const initial = { provider: 'voidr-assistant', model, reasoningEffort: 'high', maxTokens: 8000 }
function setup(events = [hint, question('o que aconteceu?')]) {
  const hooks = new Map()
  const session = { events, append(type, data) { this.events.push({ type, data }) } }
  const agent = { session }
  const ctx = { on: (name, fn) => hooks.set(name, fn) }
  registerMonitorReadProfile(ctx)
  return { ctx, hooks, agent, request: (config = initial, turn = 1) => hooks.get('agent/request')({ agent, turn }, async () => config) }
}

test('only narrow factual questions about an explicit selected case use the profile', () => {
  for (const text of ['o que aconteceu?', 'O caso selecionado passou nessa execução? Resuma.', 'did this test pass?'])
    assert.equal(simpleMonitorRead([hint, question(text)]), true)
  for (const text of ['Por que aconteceu? Investigue a causa raiz.', 'o que aconteceu? Corrija e publique.',
    'O que aconteceu no Echo?', 'Explique os dados de todos os casos', '/voidr-automate', 'Analise este arquivo'])
    assert.equal(simpleMonitorRead([hint, question(text)]), false)
  for (const surface of ['home', 'echo', 'automate', 'spec', 'journeys', 'performance', 'slack'])
    assert.equal(simpleMonitorRead([{ ...hint, data: { ...hint.data, surface } }, question('o que aconteceu?')]), false)
  assert.equal(simpleMonitorRead([{ ...hint, data: { surface: 'monitor', testPlanId: 'plan' } }, question('o que aconteceu?')]), false)
})

test('reminders cannot select the profile; explicit skills and images retain full processing', () => {
  assert.equal(simpleMonitorRead([hint], [{ source: { kind: 'plugin' }, content: [{ type: 'text', text: 'o que aconteceu?' }] }]), false)
  assert.equal(simpleMonitorRead([hint, question('o que aconteceu?')], [{ source: { kind: 'skill-invocation' }, content: [] }]), false)
  assert.equal(simpleMonitorRead([hint], [{ ...user('o que aconteceu?'), content: [...user('o que aconteceu?').content, { type: 'image' }] }]), false)
})

test('defers only new skill catalogs and leaves user input and security instructions intact', async () => {
  const { hooks, agent } = setup([hint])
  const messages = [user('o que aconteceu?'), { source: { kind: 'skill-catalog' }, content: [] },
    { source: { kind: 'plugin', plugin: 'security' }, content: [{ type: 'text', text: 'Keep authorization' }] }]
  const decision = await hooks.get('agent/pre-step')({ agent }, async () => ({ kind: 'enter', messages }))
  assert.deepEqual(decision.messages, [messages[0], messages[2]])
  messages[0] = user('Agora implemente a correção')
  assert.equal((await hooks.get('agent/pre-step')({ agent }, async () => ({ kind: 'enter', messages }))).messages, messages)
  const rejected = { kind: 'reject', reason: 'unauthorized' }
  assert.equal(await hooks.get('agent/pre-step')({ agent }, async () => rejected), rejected)
})

test('uses supported low effort without changing model, tools or token limits', async () => {
  const { request } = setup()
  assert.deepEqual(await request(), { ...initial, reasoningEffort: 'low' })
  for (const reasoningEffort of ['off', 'low', 'max']) {
    const { request: fresh } = setup()
    const config = { ...initial, reasoningEffort }
    assert.equal(await fresh(config), config)
  }
  const foreign = { ...initial, provider: 'openai', model: 'another-model' }
  assert.equal(await setup().request(foreign), foreign)
})

test('restores the original effort for deeper work even after a process resume', async () => {
  const first = setup()
  const fast = await first.request()
  const resumed = setup(structuredClone(first.agent.session.events))
  resumed.agent.session.events.push(question('Investigue a causa raiz com o trace'))
  assert.deepEqual(await resumed.request(fast, 2), initial)
})

test('restores effort on surface navigation and preserves explicit configuration changes', async () => {
  const first = setup()
  const fast = await first.request()
  first.agent.session.events.push({ ...hint, data: { surface: 'echo' } })
  assert.deepEqual(await first.request(fast, 2), initial)
  const changed = setup()
  await changed.request()
  const explicit = { ...initial, reasoningEffort: 'max' }
  assert.equal(await changed.request(explicit, 2), explicit)
})

test('escalates when evidence fails or a broader capability is needed', async () => {
  for (const event of [
    { type: 'tool/call', data: { turn: 1, name: 'skill' } },
    { type: 'tool/call', data: { turn: 1, name: 'mcp__voidr__playwright_get_test_timeline' } },
    { type: 'tool/result', data: { turn: 1, message: { content: [{ type: 'tool-result', isError: true }] } } },
  ]) {
    const { request, agent, hooks } = setup()
    const fast = await request()
    agent.session.events.push(event)
    assert.deepEqual(await request(fast), initial)
    const messages = [{ source: { kind: 'skill-catalog' }, content: [] }]
    assert.equal((await hooks.get('agent/pre-step')({ agent, turn: 1 }, async () => ({ kind: 'enter', messages }))).messages, messages)
  }
})
