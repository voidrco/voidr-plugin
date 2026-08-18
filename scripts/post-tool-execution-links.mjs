#!/usr/bin/env node

import { postToolContextOutput } from './lib/host.mjs'
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
  toolInput: toolArgs,
  toolResult
})
// The post-build stop exists to keep a FAILED build from being silently
// diagnosed and retried. A build that completed has nothing to remediate, and
// leaving the stop armed blocked the very next step of the flow — the
// validation run — behind a remediation phrase nobody would type after a
// green build.
if (toolName === 'voidr_build' && buildCompleted(toolResult)) {
  updateSessionState(payload, current => ({
    ...current,
    smokeAttemptedAt: null,
    smokeRemediationAt: Date.now()
  }))
}

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
      `The final user-facing response must include these evidence links exactly:\n${lines}`
    )
  )}\n`
)

function buildCompleted(result) {
  const text =
    typeof result === 'string' ? result : JSON.stringify(result ?? '')
  // The bridge answers with the build report; a failure arrives as an MCP
  // error instead, so the flag is only present on the successful path.
  return /"buildCompleted"\s*:\s*true/.test(text)
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
