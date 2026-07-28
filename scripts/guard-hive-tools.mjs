#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { basename, dirname, relative, resolve, sep } from 'node:path'
import { canonicalToolName, loadPolicy } from './lib/policy.mjs'

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
const toolArgs = payload.toolArgs ?? payload.tool_input ?? {}
const serializedArgs = safelyStringify(toolArgs)
const searchable = `${rawToolName}\n${toolName}\n${serializedArgs}`.toLowerCase()

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

  const statePath = sessionStatePath(hookPayload)
  mkdirSync(dirname(statePath), { recursive: true })
  writeFileSync(
    statePath,
    JSON.stringify({ selectedRepository: selected, workspaceRoot: cwd }, null, 2),
    'utf8'
  )
}

function enforceSelectedRepositoryBoundary(hookPayload, name, args) {
  if (!/(^|[-_/])(create|edit|write|apply_patch|str_replace_editor)$/i.test(name)) {
    return
  }
  const statePath = sessionStatePath(hookPayload)
  if (!existsSync(statePath)) return

  let state
  try {
    state = JSON.parse(readFileSync(statePath, 'utf8'))
  } catch {
    deny('Voidr repository boundary state is invalid.')
  }

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

function sessionStatePath(hookPayload) {
  const dataRoot =
    process.env.COPILOT_PLUGIN_DATA ||
    process.env.VOIDR_PLUGIN_DATA ||
    resolve(tmpdir(), 'voidr-copilot-plugin-data')
  const sessionId = String(
    hookPayload.sessionId || hookPayload.session_id || 'unknown-session'
  )
  const safeId = createHash('sha256').update(sessionId).digest('hex')
  return resolve(dataRoot, 'sessions', `${safeId}.json`)
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
