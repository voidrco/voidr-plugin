import test from 'node:test'
import assert from 'node:assert/strict'
import { contextBootstrap } from '../scripts/lib/context.mjs'

test('a rejected plan id reports what it received, so a truncation is visible', async () => {
  // A model that drops a character while copying the id gets told only that the
  // id is invalid, concludes the user typed it wrong, and asks them to retype a
  // value they got right. The error has to show the evidence of who lost it.
  const truncated = '6a84dc17b3fb9bc40143d6a'

  await assert.rejects(
    contextBootstrap({ planId: truncated }),
    error => {
      assert.match(error.message, /24-hex Test Plan id/)
      assert.match(error.message, /23 characters/)
      assert.ok(
        error.message.includes(truncated),
        'the received value must appear so it can be compared with the original'
      )
      assert.match(error.message, /never ask them to retype it/i)
      return true
    }
  )
})

test('an absent plan id is refused without inventing a length', async () => {
  await assert.rejects(contextBootstrap({}), error => {
    assert.match(error.message, /24-hex Test Plan id/)
    assert.match(error.message, /0 characters/)
    return true
  })
})
