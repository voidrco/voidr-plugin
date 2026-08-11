#!/usr/bin/env node

import { detectHost, userPromptOutput } from './lib/host.mjs'
import { voidrPromptGuidance } from './lib/prompt-router.mjs'
import { recordUserPromptState } from './lib/session-state.mjs'

let input = ''
for await (const chunk of process.stdin) input += chunk

try {
  const payload = input.trim() ? JSON.parse(input) : {}
  recordUserPromptState(payload)
  const output = userPromptOutput(detectHost(payload), {
    // An empty transformedPrompt falls back to the raw prompt, or Copilot's
    // rewrite would replace the user's message with the routing note alone.
    transformedPrompt: payload?.transformedPrompt || payload?.prompt,
    guidance: voidrPromptGuidance(payload)
  })
  process.stdout.write(`${JSON.stringify(output)}\n`)
} catch {
  process.stdout.write('{}\n')
}
