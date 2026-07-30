const executionIdPattern = /^[a-fA-F0-9]{24}$/

const directExecutionTools = new Set([
  'executions_get_execution',
  'playwright_get_execution_analytics',
  'playwright_list_test_results',
  'playwright_list_execution_failures',
  'playwright_get_test_timeline',
  'playwright_get_test_dom',
  'playwright_get_trace_events'
])

const resultExecutionTools = new Set([
  'playwright_get_test_history'
])

const defectCreationTools = new Set([
  'defects_create_defect',
  'defects_create_defect_with_issue'
])

export function isDefectCreationTool(toolName) {
  return defectCreationTools.has(toolName)
}

export function buildExecutionUrl(
  executionId,
  platformUrl = process.env.VOIDR_PLATFORM_URL || 'https://platform.voidr.co'
) {
  if (!isExecutionId(executionId)) return null
  const baseUrl = String(platformUrl).replace(/\/+$/, '')
  return `${baseUrl}/execution/${encodeURIComponent(executionId)}`
}

export function executionIdsFromToolInput(
  toolName,
  toolArgs,
  knownExecutionIds = []
) {
  const args = normalizeObject(toolArgs)
  const ids = []

  if (directExecutionTools.has(toolName)) {
    addExecutionId(ids, args.executionId)
  }

  if (isDefectCreationTool(toolName)) {
    for (const id of args.relations?.executions || []) {
      addExecutionId(ids, id)
    }
    const known = new Set(knownExecutionIds.filter(isExecutionId))
    for (const id of args.sessions || []) {
      if (known.has(id)) addExecutionId(ids, id)
    }
  }

  return ids
}

export function executionIdsFromToolResult(toolName, toolResult) {
  if (!resultExecutionTools.has(toolName)) return []
  const parsed = parseToolResult(toolResult)
  const ids = []
  collectExecutionIds(parsed, ids)
  return ids.slice(0, 1)
}

export function testCaseSlugsFromToolInput(toolArgs) {
  const args = normalizeObject(toolArgs)
  const values = [
    args.testCaseSlug,
    ...(args.relations?.testCases || [])
  ]
  return [...new Set(values.filter(value => typeof value === 'string' && value))]
}

export function executionLinks(ids, platformUrl) {
  return uniqueExecutionIds(ids).map(executionId => ({
    executionId,
    executionUrl: buildExecutionUrl(executionId, platformUrl)
  }))
}

export function executionLinkLines(ids, platformUrl) {
  return executionLinks(ids, platformUrl)
    .map(({ executionUrl }) => `Execution: [Open execution](${executionUrl})`)
    .join('\n')
}

export function enrichToolResultWithExecutionLinks(
  toolName,
  toolArgs,
  toolResult,
  platformUrl
) {
  const ids = uniqueExecutionIds([
    ...executionIdsFromToolInput(toolName, toolArgs),
    ...executionIdsFromToolResult(toolName, toolResult)
  ])
  if (ids.length === 0 || !toolResult || typeof toolResult !== 'object') {
    return toolResult
  }

  const links = executionLinks(ids, platformUrl)
  const requiredUserFacingOutput = executionLinkLines(ids, platformUrl)
  return {
    ...toolResult,
    content: [
      ...(Array.isArray(toolResult.content) ? toolResult.content : []),
      {
        type: 'text',
        text: JSON.stringify({
          executionEvidence: links,
          requiredUserFacingOutput
        })
      }
    ]
  }
}

export function uniqueExecutionIds(ids) {
  return [...new Set(ids.filter(isExecutionId))]
}

export function isExecutionId(value) {
  return executionIdPattern.test(String(value || ''))
}

function parseToolResult(value) {
  if (typeof value === 'string') return parseJson(value)
  if (!value || typeof value !== 'object') return value

  if (Array.isArray(value.content)) {
    return value.content.flatMap(item => {
      if (item?.type !== 'text') return []
      return [parseJson(item.text)]
    })
  }

  return value
}

function parseJson(value) {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function collectExecutionIds(value, ids) {
  if (typeof value === 'string') {
    const parsed = parseJson(value)
    if (parsed !== value) collectExecutionIds(parsed, ids)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectExecutionIds(item, ids)
    return
  }
  if (!value || typeof value !== 'object') return

  for (const [key, child] of Object.entries(value)) {
    if (/^execution_?id$/i.test(key)) addExecutionId(ids, child)
    if (ids.length > 0) return
    collectExecutionIds(child, ids)
    if (ids.length > 0) return
  }
}

function addExecutionId(ids, value) {
  if (isExecutionId(value) && !ids.includes(value)) ids.push(value)
}

function normalizeObject(value) {
  if (typeof value !== 'string') return value || {}
  return parseJson(value) || {}
}
