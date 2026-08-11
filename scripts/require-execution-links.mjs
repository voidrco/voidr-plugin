#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { CLAUDE, detectHost, stopBlockOutput } from './lib/host.mjs'
import { canonicalToolName } from './lib/policy.mjs'
import {
  executionIdsFromToolInput,
  executionLinkLines,
  isDefectCreationTool,
  uniqueExecutionIds
} from './lib/execution-links.mjs'
import {
  readSessionState,
  updateSessionState
} from './lib/session-state.mjs'

// Neither host guarantees the model will ever comply, and Claude ships no
// stop_hook_active flag to break the cycle, so the gate releases the turn
// after this many consecutive blocks rather than hanging it.
const MAX_CONSECUTIVE_BLOCKS = 3

const payload = await readPayload()
const host = detectHost(payload)
const state = readSessionState(payload)

// Copilot only exposes the turn through its transcript. Claude hands the Stop
// hook the final assistant text directly and records every tool call through
// the PostToolUse hook, so the transcript is not read there at all.
const transcript =
  host === CLAUDE
    ? []
    : readTranscript(payload.transcriptPath || payload.transcript_path)
const turn = currentUserTurn(transcript)
const knownExecutionIds = collectKnownExecutionIds(transcript)
const turnExecutionIds = collectTurnExecutionIds(turn, knownExecutionIds)
const requiredExecutionIds = uniqueExecutionIds([
  ...(state.requiredExecutionIds || []),
  ...turnExecutionIds
])

if (requiredExecutionIds.length === 0) {
  release()
}

const lines = executionLinkLines(
  requiredExecutionIds,
  process.env.VOIDR_PLATFORM_URL
)
const assistantText =
  host === CLAUDE
    ? String(
        payload.last_assistant_message ?? payload.lastAssistantMessage ?? ''
      )
    : turn
        .filter(entry => entry.type === 'assistant.message')
        .map(entry => String(entry.data?.content || ''))
        .join('\n')
const missing = lines
  .split('\n')
  .filter(line => !assistantText.includes(line))

if (missing.length === 0) {
  release()
}

const blocks = Number(state.executionLinkBlocks || 0) + 1
if (blocks > MAX_CONSECUTIVE_BLOCKS) {
  release()
}

updateSessionState(payload, current => ({
  ...current,
  executionLinkBlocks: blocks
}))

process.stdout.write(
  `${JSON.stringify(
    stopBlockOutput(
      host,
      `Your response omitted execution evidence. End the response with:\n${missing.join('\n')}`
    )
  )}\n`
)

function release() {
  updateSessionState(payload, current => ({
    ...current,
    requiredExecutionIds: [],
    executionLinkBlocks: 0
  }))
  process.stdout.write('{}\n')
  process.exit(0)
}

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
    if (isDefectCreationTool(toolName)) continue
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
