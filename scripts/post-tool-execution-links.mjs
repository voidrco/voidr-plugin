#!/usr/bin/env node

import { detectHost, postToolContextOutput } from './lib/host.mjs'
import { canonicalToolName } from './lib/policy.mjs'
import {
  executionIdsFromToolInput,
  executionIdsFromToolResult,
  executionLinkLines,
  testCaseSlugsFromToolInput,
  uniqueExecutionIds
} from './lib/execution-links.mjs'
import {
  readSessionState,
  recordAskUserSelections,
  updateSessionState
} from './lib/session-state.mjs'

const payload = await readPayload()
const toolName = canonicalToolName(
  payload.toolName || payload.tool_name || ''
)
const toolArgs = payload.toolArgs ?? payload.tool_input ?? {}
const toolResult = payload.toolResult ?? payload.tool_response
recordAskUserSelections(payload, {
  toolName: payload.toolName || payload.tool_name || '',
  toolResult
})
const state = readSessionState(payload)
const inputIds = executionIdsFromToolInput(
  toolName,
  toolArgs,
  state.latestEvidenceExecutionIds || []
)
const resultIds = executionIdsFromToolResult(toolName, toolResult)
const executionIds = uniqueExecutionIds([...inputIds, ...resultIds])
const testCaseSlugs = testCaseSlugsFromToolInput(toolArgs)

if (executionIds.length === 0) {
  process.stdout.write('{}\n')
  process.exit(0)
}

const nextState = updateSessionState(payload, current => ({
  ...current,
  latestEvidenceExecutionIds: uniqueExecutionIds([
    ...executionIds,
    ...(current.latestEvidenceExecutionIds || [])
  ]).slice(0, 20),
  latestEvidenceTestCaseSlugs: [
    ...new Set([
      ...testCaseSlugs,
      ...(current.latestEvidenceTestCaseSlugs || [])
    ])
  ].slice(0, 20),
  requiredExecutionIds: uniqueExecutionIds([
    ...(current.requiredExecutionIds || []),
    ...executionIds
  ])
}))
const lines = executionLinkLines(
  nextState.requiredExecutionIds,
  process.env.VOIDR_PLATFORM_URL
)

process.stdout.write(
  `${JSON.stringify(
    postToolContextOutput(
      detectHost(payload),
      `The final user-facing response must include these evidence links exactly:\n${lines}`
    )
  )}\n`
)

async function readPayload() {
  let input = ''
  for await (const chunk of process.stdin) input += chunk
  try {
    return input.trim() ? JSON.parse(input) : {}
  } catch {
    return {}
  }
}
