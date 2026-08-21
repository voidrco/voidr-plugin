#!/usr/bin/env node

// A PreToolUse hook with two rules: a worker job is not started from here, and
// an MCP tool is called by calling it. None of the workflow choreography that
// used to travel with the first — no typed phrases, no question ordering, no
// stop-after-build — because that is what made the gates unusable and got them
// switched off wholesale.
//
// The first rule reads no session state: a rule that only applies once a
// workflow is "active" is not a rule, since that flag is armed from prompt
// wording alone. The second one is the opposite by nature — it exists only
// because the user answered a question, so it reads the answer and nothing
// else.

import { CLAUDE, detectHost } from './lib/host.mjs'
import { canonicalToolName, loadPolicy } from './lib/policy.mjs'
import { findProtectionDenial } from './lib/protections.mjs'
import { findRunModeDenial } from './lib/run-mode.mjs'
import { readSessionState } from './lib/session-state.mjs'

const payload = await readPayload()
const rawToolName = String(payload.toolName || payload.tool_name || '')

const toolArgs = normalizeToolArgs(payload.toolArgs ?? payload.tool_input ?? {})
const reason =
  findProtectionDenial({
    rawToolName,
    toolName: canonicalToolName(rawToolName),
    toolArgs,
    policy: loadPolicy()
  }) ||
  findRunModeDenial({
    rawToolName,
    toolArgs,
    state: readSessionState(payload)
  })

if (reason) deny(reason)
allow()

async function readPayload() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  } catch {
    // An unparsable request is not evidence of wrongdoing, and refusing it
    // would break every tool call on a payload-shape change.
    return {}
  }
}

function normalizeToolArgs(value) {
  if (typeof value !== 'string') return value || {}
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function deny(permissionDecisionReason) {
  write({
    permissionDecision: 'deny',
    permissionDecisionReason,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason
    }
  })
}

function allow() {
  // Claude treats an absent decision as "no opinion", which is what a hook
  // with nothing to say should express. Copilot wants it stated.
  write(
    detectHost(payload) === CLAUDE
      ? { hookSpecificOutput: { hookEventName: 'PreToolUse' } }
      : {
          permissionDecision: 'allow',
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'allow'
          }
        }
  )
}

function write(output) {
  process.stdout.write(`${JSON.stringify(output)}\n`)
  process.exit(0)
}
