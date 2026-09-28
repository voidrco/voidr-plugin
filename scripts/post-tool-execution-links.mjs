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
import {
  tlsTrustFailureFrom,
  tlsTrustRecoveryGuidance
} from './lib/network-trust.mjs'

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
if (toolName === 'voidr_select_test_plan') {
  const selection = selectedTestPlanSelection(toolResult)
  if (selection) {
    updateSessionState(payload, current => {
      const changed =
        String(current.selectedTestPlanId || '').toLowerCase() !==
        selection.id
      return {
        ...current,
        selectedTestPlanId: selection.id,
        selectedTestPlanAt: Date.now(),
        selectedTestPlanSource: 'explicit-mcp-selection',
        planMode: 'existing',
        workflowActive: true,
        ...(changed
          ? {
              selectedEnvironmentSlug: null,
              selectedEnvironmentAt: null,
              environmentSelectionRequestedAt: null,
              environmentApplicationId: null,
              selectedRepository: null,
              linkedRepositoryUrl: null,
              planContextConfirmed: false,
              planContextConfirmedAt: null,
              planWriteApproved: false,
              planWriteApprovedAt: null,
              smokeAttemptedAt: null,
              smokeRemediationAt: null,
              lastValidationExecutionAt: null,
              latestEvidenceExecutionIds: [],
              latestEvidenceTestCaseSlugs: [],
              requiredExecutionIds: [],
              executionLinkBlocks: 0
            }
          : {})
      }
    })
  }
}
// The post-build stop exists to keep a FAILED build from being silently
// diagnosed and retried. A build that completed has nothing to remediate, and
// leaving the stop armed blocked the very next step of the flow — the
// validation run — behind a remediation phrase nobody would type after a
// green build.
if (toolName === 'voidr_build' && buildSucceeded(toolResult)) {
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
const contexts = []
const tlsTrustFailure = tlsTrustFailureFrom(toolResult)

if (tlsTrustFailure) {
  contexts.push(tlsTrustRecoveryGuidance(tlsTrustFailure))
}

if (executionIds.length === 0) {
  process.stdout.write(
    `${JSON.stringify(
      contexts.length > 0 ? postToolContextOutput(contexts.join('\n\n')) : {}
    )}\n`
  )
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
contexts.push(
  `The final user-facing response must include these evidence links exactly:\n${lines}`
)

process.stdout.write(
  `${JSON.stringify(
    postToolContextOutput(contexts.join('\n\n'))
  )}\n`
)

function buildSucceeded(result) {
  if (!result) return false
  // Copilot hands post-hooks an elided result — the report text is replaced by
  // a placeholder — so reading the payload for buildCompleted found nothing
  // and the stop stayed armed. resultType survives the elision and is the
  // host's own verdict on the call.
  if (typeof result === 'object' && !Array.isArray(result) && result.resultType) {
    return result.resultType === 'success'
  }
  const text = typeof result === 'string' ? result : JSON.stringify(result)
  return /"buildCompleted"\s*:\s*true/.test(text)
}

function selectedTestPlanSelection(value, depth = 0) {
  if (depth > 8 || value == null) return null
  if (typeof value === 'string') {
    try {
      return selectedTestPlanSelection(JSON.parse(value), depth + 1)
    } catch {
      return null
    }
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const selection = selectedTestPlanSelection(item, depth + 1)
      if (selection) return selection
    }
    return null
  }
  if (typeof value !== 'object') return null
  const id = String(value.selectedTestPlanId || '').trim().toLowerCase()
  if (value.selected === true && /^[a-f0-9]{24}$/.test(id)) return { id }
  for (const key of [
    'structuredContent',
    'content',
    'data',
    'result',
    'output',
    'text'
  ]) {
    const selection = selectedTestPlanSelection(value[key], depth + 1)
    if (selection) return selection
  }
  return null
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
