#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { canonicalToolName } from './lib/policy.mjs'
import {
  executionIdsFromToolInput,
  executionLinkLines,
  uniqueExecutionIds
} from './lib/execution-links.mjs'
import {
  readSessionState,
  updateSessionState
} from './lib/session-state.mjs'

const payload = await readPayload()
const state = readSessionState(payload)
const transcript = readTranscript(
  payload.transcriptPath || payload.transcript_path
)
const turn = currentUserTurn(transcript)
const knownExecutionIds = collectKnownExecutionIds(transcript)
const turnExecutionIds = collectTurnExecutionIds(turn, knownExecutionIds)
const requiredExecutionIds = uniqueExecutionIds([
  ...(state.requiredExecutionIds || []),
  ...turnExecutionIds
])

if (requiredExecutionIds.length === 0) {
  process.stdout.write('{}\n')
  process.exit(0)
}

const lines = executionLinkLines(
  requiredExecutionIds,
  process.env.VOIDR_PLATFORM_URL
)
const assistantText = turn
  .filter(entry => entry.type === 'assistant.message')
  .map(entry => String(entry.data?.content || ''))
  .join('\n')
const missing = lines
  .split('\n')
  .filter(line => !assistantText.includes(line))

if (missing.length === 0) {
  updateSessionState(payload, { requiredExecutionIds: [] })
  process.stdout.write('{}\n')
  process.exit(0)
}

process.stdout.write(
  `${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'Stop',
      decision: 'block',
      reason:
        `Your response omitted execution evidence. End the response with:\n${missing.join('\n')}`
    }
  })}\n`
)

function readTranscript(path) {
  if (!path || !existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap(line => {
      try {
        return [JSON.parse(line)]
      } catch {
        return []
      }
    })
}

function currentUserTurn(entries) {
  const lastUser = entries.findLastIndex(entry => entry.type === 'user.message')
  return lastUser >= 0 ? entries.slice(lastUser + 1) : entries
}

function collectKnownExecutionIds(entries) {
  const ids = []
  for (const entry of entries) {
    if (entry.type !== 'tool.execution_start') continue
    const toolName = canonicalToolName(entry.data?.toolName)
    if (toolName === 'defects_create_defect') continue
    ids.push(
      ...executionIdsFromToolInput(
        toolName,
        entry.data?.arguments || {},
        ids
      )
    )
  }
  return uniqueExecutionIds(ids)
}

function collectTurnExecutionIds(entries, knownExecutionIds) {
  const ids = []
  for (const entry of entries) {
    if (entry.type !== 'tool.execution_start') continue
    const toolName = canonicalToolName(entry.data?.toolName)
    ids.push(
      ...executionIdsFromToolInput(
        toolName,
        entry.data?.arguments || {},
        knownExecutionIds
      )
    )
  }
  return uniqueExecutionIds(ids)
}

async function readPayload() {
  let input = ''
  for await (const chunk of process.stdin) input += chunk
  try {
    return input.trim() ? JSON.parse(input) : {}
  } catch {
    return {}
  }
}
