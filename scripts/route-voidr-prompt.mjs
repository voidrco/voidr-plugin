#!/usr/bin/env node

import { routeVoidrPrompt } from './lib/prompt-router.mjs'

let input = ''
for await (const chunk of process.stdin) input += chunk

try {
  const payload = input.trim() ? JSON.parse(input) : {}
  process.stdout.write(`${JSON.stringify(routeVoidrPrompt(payload))}\n`)
} catch {
  process.stdout.write('{}\n')
}
