#!/usr/bin/env node

import { routeVoidrPrompt } from './lib/prompt-router.mjs'
import { recordUserPromptState } from './lib/session-state.mjs'

let input = ''
for await (const chunk of process.stdin) input += chunk

try {
  const payload = input.trim() ? JSON.parse(input) : {}
  recordUserPromptState(payload)
  process.stdout.write(`${JSON.stringify(routeVoidrPrompt(payload))}\n`)
} catch {
  process.stdout.write('{}\n')
}
