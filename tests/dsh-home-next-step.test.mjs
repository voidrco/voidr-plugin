import { test } from 'node:test'
import assert from 'node:assert/strict'
import { interactiveTestDevelopmentPrompt } from '../core/workflow/interactive-test-development.mjs'

test('Home reserves the full menu for orientation and uses one optional next step after completion', () => {
  const prompt = interactiveTestDevelopmentPrompt({ hint: { surface: 'home' } })

  assert.match(prompt, /explicitly need broad orientation, offer all five paths/)
  assert.match(prompt, /Do not show that menu for a greeting, a concrete request, or the end of a completed task/)
  assert.match(prompt, /ask one short natural-language question about that action/)
  assert.match(prompt, /Do not list optional alternatives or use ask_user_question for this follow-up/)
  assert.match(prompt, /If no action is clearly recommended, stop after the result/)
})
