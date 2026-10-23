import { test } from 'node:test'
import assert from 'node:assert/strict'
import { projectContextHint } from '../adapters/dsh/project-context.mjs'
import { contextChannel, whatsappChannelDenial } from '../adapters/dsh/whatsapp-channel.mjs'

const hint = data => Object.freeze({ type: 'voidr/project-context-hint', data })

test('the latest hint wins, including absent data and empty channels', () => {
  assert.equal(projectContextHint(), undefined)
  assert.equal(contextChannel(null), null)
  assert.equal(projectContextHint(Object.freeze([])), undefined)
  for (const data of [undefined, null, {}, { channel: '' }]) {
    const events = Object.freeze([hint({ channel: 'whatsapp' }), hint(data)])
    assert.equal(projectContextHint(events), data)
    assert.equal(contextChannel(events), data?.channel ?? null)
    assert.equal(whatsappChannelDenial('render_widget', events), null)
  }
})

test('an immutable long history is searched once across context and channel lookups', () => {
  let reads = 0
  const event = new Proxy(Object.freeze({ type: 'assistant/chunk' }), {
    get(target, key, receiver) {
      if (key === 'type') reads++
      return Reflect.get(target, key, receiver)
    }
  })
  const data = Object.freeze({ surface: 'echo', channel: 'whatsapp' })
  const events = Object.freeze([hint(data), ...Array(37000).fill(event)])
  assert.equal(projectContextHint(events), data)
  const firstReads = reads
  assert.equal(firstReads, 37000)
  for (let index = 0; index < 411; index++) {
    assert.equal(projectContextHint(events), data)
    assert.equal(contextChannel(events), 'whatsapp')
    assert.match(whatsappChannelDenial('render_widget', events), /only shows text/)
  }
  assert.equal(reads, firstReads)
})

test('new snapshot identities invalidate both present and missing hints across sessions', () => {
  const empty = Object.freeze([Object.freeze({ type: 'turn/start' })])
  assert.equal(projectContextHint(empty), undefined)
  const first = Object.freeze([...empty, hint({ channel: 'whatsapp' })])
  const second = Object.freeze([...first, hint({ surface: 'echo' })])
  const otherSession = Object.freeze([hint({ surface: 'slack' })])
  assert.equal(contextChannel(first), 'whatsapp')
  assert.equal(contextChannel(second), null)
  assert.equal(projectContextHint(otherSession).surface, 'slack')
  assert.equal(contextChannel(first), 'whatsapp')
  assert.equal(projectContextHint(empty), undefined)
})

test('mutable arrays and mutable event types remain live', () => {
  const events = [hint({ channel: 'whatsapp' })]
  assert.equal(contextChannel(events), 'whatsapp')
  events.push(hint({ channel: 'web' }))
  assert.equal(contextChannel(events), 'web')
  events[1] = hint({ channel: 'teams' })
  assert.equal(contextChannel(events), 'teams')
  const mutable = { type: 'turn/start', data: { channel: 'web' } }
  const shallow = Object.freeze([hint({ channel: 'whatsapp' }), mutable])
  assert.equal(contextChannel(shallow), 'whatsapp')
  mutable.type = 'voidr/project-context-hint'
  assert.equal(contextChannel(shallow), 'web')
  mutable.type = 'turn/start'
  assert.equal(contextChannel(shallow), 'whatsapp')
  const missing = Object.freeze([mutable])
  assert.equal(projectContextHint(missing), undefined)
  mutable.type = 'voidr/project-context-hint'
  assert.equal(contextChannel(missing), 'web')
})

test('frozen entries do not freeze data or accessor results through the cache', () => {
  const data = { channel: 'whatsapp' }
  const events = Object.freeze([hint(data)])
  assert.equal(contextChannel(events), 'whatsapp')
  data.channel = 'web'
  assert.equal(contextChannel(events), 'web')
  let current = { channel: 'whatsapp' }
  const dynamicData = Object.freeze([Object.freeze({ type: 'voidr/project-context-hint', get data() { return current } })])
  assert.equal(contextChannel(dynamicData), 'whatsapp')
  current = { channel: 'web' }
  assert.equal(contextChannel(dynamicData), 'web')
})

test('frozen accessor-backed arrays and event types are never assumed immutable', () => {
  let current = hint({ channel: 'whatsapp' })
  const events = []
  Object.defineProperty(events, '0', { get: () => current, enumerable: true })
  Object.freeze(events)
  assert.equal(contextChannel(events), 'whatsapp')
  current = hint({ channel: 'web' })
  assert.equal(contextChannel(events), 'web')
  let type = 'voidr/project-context-hint'
  const dynamicType = Object.freeze([hint({ channel: 'web' }),
    Object.freeze({ get type() { return type }, data: { channel: 'whatsapp' } })])
  assert.equal(contextChannel(dynamicType), 'whatsapp')
  type = 'turn/start'
  assert.equal(contextChannel(dynamicType), 'web')
})
