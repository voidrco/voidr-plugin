#!/usr/bin/env node

import {
  existsSync,
  realpathSync,
  statSync
} from 'node:fs'
import { basename, dirname, relative, resolve, sep } from 'node:path'
import { canonicalToolName, loadPolicy } from './lib/policy.mjs'
import {
  readSessionState,
  updateSessionState
} from './lib/session-state.mjs'

const input = await readStdin()
let payload
try {
  payload = JSON.parse(input || '{}')
} catch {
  deny('Voidr policy could not parse the tool request.')
}

const policy = loadPolicy()
const rawToolName = String(payload.toolName || payload.tool_name || '')
const toolName = canonicalToolName(rawToolName)
const toolArgs = normalizeToolArgs(payload.toolArgs ?? payload.tool_input ?? {})
const serializedArgs = safelyStringify(toolArgs)
const searchable = `${rawToolName}\n${toolName}\n${serializedArgs}`.toLowerCase()

enforceConnectFirstTool(payload, rawToolName, toolName, serializedArgs)
enforcePlanModeGate(payload, rawToolName, toolName)
enforceTestPlanWriteApproval(payload, toolName)

const protectedCredential = (policy.protectedCredentialFragments || []).find(
  fragment => searchable.includes(fragment.toLowerCase())
)
if (protectedCredential) {
  deny(
    'Blocked by Voidr policy: Service Account credential files can only be handled by the protected local authentication tools.'
  )
}

const forbiddenTool = policy.forbiddenTools.find(name =>
  searchable.includes(name.toLowerCase())
)
if (forbiddenTool) {
  deny(
    `Blocked by Voidr policy: ${forbiddenTool} can start or indirectly dispatch a Hive process.`
  )
}

const forbiddenRequest = policy.forbiddenRequestFragments.find(fragment =>
  searchable.includes(fragment.toLowerCase())
)
if (forbiddenRequest) {
  deny(
    `Blocked by Voidr policy: ${forbiddenRequest} is a process-dispatch endpoint.`
  )
}

const isShell = /(^|[-_/])(bash|shell|powershell)$/i.test(rawToolName)
if (isShell) {
  const shellText = collectStringValues(toolArgs).join('\n').toLowerCase()
  const normalizedShell = shellText.replace(/\s+/g, ' ')
  if (normalizedShell.includes('voidr-mcp-bridge.mjs')) {
    deny(
      'Blocked by Voidr policy: do not invoke the MCP bridge through the terminal. Call the official Voidr MCP authentication tools directly.'
    )
  }
  const forbiddenDeploy = (policy.forbiddenDeployShellFragments || []).find(value =>
    normalizedShell.includes(value.toLowerCase())
  )
  const legacyMutableDeploy =
    /\bvoidr\s+deploy-latest\b/.test(normalizedShell) ||
    /\bnpm\b[^;&|\n]*\brun\b[^;&|\n]*\bvoidr:deploy(?:-latest)?\b/.test(
      normalizedShell
    )
  if (forbiddenDeploy || legacyMutableDeploy) {
    deny(
      `Blocked by Voidr policy: legacy mutable deployment bypasses the merged-PR and immutable latest release gate.`
    )
  }
  const fragment = policy.forbiddenShellFragments.find(value =>
    searchable.includes(value.toLowerCase())
  )
  const suspiciousHiveDispatch =
    searchable.includes('hive') &&
    /(trigger|dispatch|start|create.?session|generate-plan|self-healing|orchestrat)/i.test(
      searchable
    )
  if (fragment || suspiciousHiveDispatch) {
    deny(
      `Blocked by Voidr policy: shell command appears to start or dispatch a Hive process${fragment ? ` (${fragment})` : ''}.`
    )
  }
}

if (toolName === 'voidr_workspace_select_test_repository') {
  recordSelection(payload, toolArgs)
}

enforceSelectedRepositoryBoundary(payload, rawToolName, toolArgs)
process.stdout.write('{}\n')

function recordSelection(hookPayload, args) {
  const requested = args?.path || args?.repositoryPath
  if (!requested || typeof requested !== 'string') {
    deny('A test repository path is required.')
  }
  const cwd = realpathOrResolve(hookPayload.cwd || process.cwd())
  const selected = realpathOrResolve(resolve(cwd, requested))
  if (!existsSync(selected) || !statSync(selected).isDirectory()) {
    deny('The selected test repository must be an existing directory.')
  }
  if (!isInside(selected, cwd)) {
    deny('The test repository must be inside the current Copilot workspace.')
  }

  updateSessionState(hookPayload, {
    selectedRepository: selected,
    workspaceRoot: cwd
  })
}

function enforceSelectedRepositoryBoundary(hookPayload, name, args) {
  if (!/(^|[-_/])(create|edit|write|apply_patch|str_replace_editor)$/i.test(name)) {
    return
  }
  const state = readSessionState(hookPayload)
  if (!state.selectedRepository) return

  const paths = [
    ...collectPathArguments(args),
    ...collectPatchPathsFromValue(args)
  ]
  for (const value of paths) {
    const candidate = realpathOrResolve(
      resolve(hookPayload.cwd || process.cwd(), value)
    )
    if (!isInside(candidate, state.selectedRepository)) {
      deny(
        `Blocked by Voidr policy: writes are limited to ${state.selectedRepository}.`
      )
    }
  }
}

function collectPathArguments(value, key = '') {
  if (!value || typeof value !== 'object') return []
  const results = []
  for (const [childKey, childValue] of Object.entries(value)) {
    if (
      typeof childValue === 'string' &&
      /(^|_)(path|file|filename|filePath)$/i.test(childKey)
    ) {
      results.push(childValue)
    } else if (childValue && typeof childValue === 'object') {
      results.push(...collectPathArguments(childValue, childKey))
    }
  }
  return results
}

function collectPatchPaths(value) {
  const results = []
  const patterns = [
    /^\*{3} (?:Add|Update|Delete) File:\s*(.+)$/gm,
    /^\+\+\+\s+(?:b\/)?(.+)$/gm
  ]
  for (const pattern of patterns) {
    for (const match of value.matchAll(pattern)) {
      const path = match[1].trim()
      if (path && path !== '/dev/null') results.push(path)
    }
  }
  return results
}

function collectPatchPathsFromValue(value) {
  if (typeof value === 'string') return collectPatchPaths(value)
  if (!value || typeof value !== 'object') return []
  return Object.values(value).flatMap(collectPatchPathsFromValue)
}

function collectStringValues(value) {
  if (typeof value === 'string') return [value]
  if (!value || typeof value !== 'object') return []
  return Object.values(value).flatMap(collectStringValues)
}

function realpathOrResolve(path) {
  try {
    return realpathSync(path)
  } catch {
    const absolute = resolve(path)
    const missingParts = []
    let cursor = absolute
    while (!existsSync(cursor)) {
      const parent = dirname(cursor)
      if (parent === cursor) return absolute
      missingParts.unshift(basename(cursor))
      cursor = parent
    }
    return resolve(realpathSync(cursor), ...missingParts)
  }
}

function isInside(candidate, root) {
  const rel = relative(root, candidate)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..')
}

function safelyStringify(value) {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function enforcePlanModeGate(hookPayload, rawName, canonicalName) {
  const state = readSessionState(hookPayload)
  if (
    state.connectWorkflowActive === true ||
    state.workflowActive !== true ||
    state.planMode
  ) {
    return
  }
  if (/(?:ask_user|askuserquestion|skill|todo)/i.test(rawName)) {
    return
  }
  deny(
    'Blocked by Voidr workflow: ask the user to choose “Criar novo Test Plan” or “Usar Test Plan existente” before reading the platform or codebase.'
  )
}

function enforceConnectFirstTool(hookPayload, rawName, canonicalName, args) {
  const state = readSessionState(hookPayload)
  if (state.connectFirstToolRequired !== true) return

  const loadingConnectSkill =
    /skill/i.test(rawName) &&
    /voidr-connect/i.test(`${rawName}\n${args}`)
  if (loadingConnectSkill) return

  if (canonicalName !== 'voidr_auth_status') {
    deny(
      'Blocked by Voidr connect workflow: the first operational action must be the MCP tool voidr_auth_status. Do not inspect files, search for tools, or use the terminal.'
    )
  }

  updateSessionState(hookPayload, {
    connectFirstToolRequired: false
  })
}

function enforceTestPlanWriteApproval(hookPayload, canonicalName) {
  if (
    !canonicalName.startsWith('test_plans_') ||
    !policy.writeRemoteTools.includes(canonicalName)
  ) {
    return
  }
  const state = readSessionState(hookPayload)
  const approvalFresh =
    state.planWriteApproved === true &&
    Number.isFinite(state.planWriteApprovedAt) &&
    Date.now() - state.planWriteApprovedAt <= 30 * 60 * 1000
  const planningContextFresh =
    state.planMode !== 'new' ||
    (state.planContextConfirmed === true &&
      Number.isFinite(state.planContextConfirmedAt) &&
      Date.now() - state.planContextConfirmedAt <= 60 * 60 * 1000)
  if (!planningContextFresh) {
    deny(
      'Blocked by Voidr workflow: a new Test Plan requires collected planning inputs and a new user message saying “Confirmar insumos do planejamento” before the draft can be persisted.'
    )
  }
  if (
    state.workflowActive !== true ||
    !state.planMode ||
    !approvalFresh
  ) {
    deny(
      'Blocked by Voidr workflow: Test Plan writes require a visible draft followed by a new user message explicitly saying “Aprovo este Test Plan”. A generic “sim” is not approval.'
    )
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

function deny(reason) {
  process.stdout.write(
    `${JSON.stringify({
      permissionDecision: 'deny',
      permissionDecisionReason: reason
    })}\n`
  )
  process.exit(0)
}

function readStdin() {
  return new Promise(resolveInput => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', chunk => {
      data += chunk
    })
    process.stdin.on('end', () => resolveInput(data))
    process.stdin.resume()
  })
}
