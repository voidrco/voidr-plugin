#!/usr/bin/env node

import {
  existsSync,
  readFileSync,
  realpathSync,
  statSync
} from 'node:fs'
import { basename, dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalToolName, loadPolicy } from './lib/policy.mjs'
import {
  readSessionState,
  updateSessionState
} from './lib/session-state.mjs'
import {
  buildExecutionUrl,
  executionIdsFromToolInput,
  isDefectCreationTool,
  uniqueExecutionIds
} from './lib/execution-links.mjs'

const pluginInstallationRoot = realpathOrResolve(
  resolve(dirname(fileURLToPath(import.meta.url)), '..')
)

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
enforceNewPlanModeListing(payload, toolName)
enforcePostSmokeStop(payload, rawToolName, toolName)
enforceSensitiveProductRead(payload, rawToolName, toolArgs)
enforcePreSelectionWriteGate(payload, rawToolName)
recordInitialTestPlanSelection(payload, toolName, toolArgs)
enforceSelectedTestPlanIdentity(payload, toolName, toolArgs)
enforceTestPlanWriteApproval(payload, toolName)
enforcePlatformSensitiveContent(toolName, toolArgs)
recordEnvironmentSelectionRequest(payload, toolName, toolArgs)
enforceExplicitEnvironmentSelection(payload, toolName, toolArgs)
enforceExplicitWorkspaceRoot(payload, toolName, toolArgs)
enforceTestSpecContentPolicy(rawToolName, toolArgs)
recordSmokeAttempt(payload, toolName)

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
  enforceShellEnvFileRead(payload, normalizedShell)
  enforceDependencyStrategyProtection(payload, normalizedShell)
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
  enforceVoidrCliShellUsage(normalizedShell)
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

if (
  [
    'voidr_workspace_select_test_repository',
    'voidr_workspace_prepare_test_repository'
  ].includes(toolName)
) {
  recordSelection(payload, toolArgs)
}

enforcePluginInstallationBoundary(payload, rawToolName, toolArgs)
enforceSelectedRepositoryBoundary(payload, rawToolName, toolArgs)
const updatedToolArgs = addDefectExecutionEvidence(payload, toolName, toolArgs)
if (updatedToolArgs) allowUpdatedInput(updatedToolArgs)
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
  if (isInside(selected, pluginInstallationRoot)) {
    deny(
      'Blocked by Voidr policy: the test repository cannot live inside the plugin installation directory. Select or clone it inside the real VS Code workspace and pass workspaceRoot when the bridge asks for it.'
    )
  }
  if (!isInside(selected, cwd)) {
    deny('The test repository must be inside the current Copilot workspace.')
  }

  updateSessionState(hookPayload, {
    selectedRepository: selected,
    workspaceRoot: cwd
  })
}

function enforcePluginInstallationBoundary(hookPayload, name, args) {
  if (!isGenericWriteTool(name)) return
  const cwd = hookPayload.cwd || process.cwd()
  const paths = [
    ...collectPathArguments(args),
    ...collectPatchPathsFromValue(args)
  ]
  for (const value of paths) {
    const candidate = realpathOrResolve(resolve(cwd, value))
    if (isInside(candidate, pluginInstallationRoot)) {
      deny(
        'Blocked by Voidr policy: never create, edit, or delete files inside the plugin installation directory. Test repositories and generated files live in the real VS Code workspace.'
      )
    }
  }
}

// The MCP bridge process cannot see the VS Code workspace (its cwd is the
// plugin installation), but this hook receives the real cwd. Denying the call
// with the exact value to pass makes the correct workspaceRoot appear in the
// model's context deterministically, instead of relying on skill adherence.
function enforceExplicitWorkspaceRoot(hookPayload, canonicalName, args) {
  const needsRoot =
    canonicalName === 'voidr_workspace_inspect' ||
    canonicalName === 'voidr_workspace_git_context' ||
    canonicalName === 'voidr_workspace_bootstrap_test_repository' ||
    canonicalName === 'voidr_workspace_prepare_test_repository' ||
    canonicalName === 'voidr_release_inspect' ||
    (canonicalName === 'voidr_workspace_select_test_repository' &&
      !String(args?.repositoryUrl || '').trim())
  if (!needsRoot) return
  if (String(args?.workspaceRoot || '').trim()) return
  const cwd = String(hookPayload.cwd || '').trim()
  if (!cwd) return
  deny(
    `Blocked by Voidr workflow: the MCP process cannot see the open workspace by itself. Call ${canonicalName} again adding workspaceRoot: "${cwd}" (the absolute path of the open workspace folder). Never use terminal find/ls to locate the test repository.`
  )
}

function enforceNewPlanModeListing(hookPayload, canonicalName) {
  if (canonicalName !== 'test_plans_list_test_plans') return
  const state = readSessionState(hookPayload)
  if (state.planMode !== 'new') return
  deny(
    'Blocked by Voidr workflow: the user chose to create a new Test Plan. If creation failed, stop, show the exact tool error, and offer to retry or cancel. Never list existing Test Plans to silently replace the new plan. Switching to an existing plan requires the user to explicitly say “Usar Test Plan existente” in a new message.'
  )
}

// The Voidr CLI and Playwright runs are bridge-only: the terminal has no
// Service Account, and interactive `voidr login` would create a user
// credential session outside the plugin's model. Blocked in every form —
// npx, direct node invocation, or a PATH binary.
function enforceVoidrCliShellUsage(normalizedShell) {
  const invokesVoidrCli =
    /(?:^|[\s;|&(])npx\b[^;&|\n]*\bvoidr\b/.test(normalizedShell) ||
    /(?:^|[\s;|&(])voidr\s+(?:login|link|scaffold|env|build|deploy|deploy-candidate)\b/.test(
      normalizedShell
    ) ||
    /voidr\.js\b/.test(normalizedShell) ||
    normalizedShell.includes('@voidrco/playwright/cli')
  const invokesPlaywrightRun =
    /(?:^|[\s;|&(])npx\b[^;&|\n]*\bplaywright\s+test\b/.test(normalizedShell)
  if (!invokesVoidrCli && !invokesPlaywrightRun) return
  deny(
    'Blocked by Voidr policy: never run the Voidr CLI or Playwright from the terminal — it has no Service Account credentials there, and interactive voidr login is forbidden. Use the bridge tools, which inject the credentials automatically: voidr_workspace_prepare_test_repository (setup/link/scaffold/env pull), voidr_smoke_build (run selected tests + build), voidr_workspace_publish_tests (commit/push/PR), and voidr_release_deploy_merged_pr (immutable deploy).'
  )
}

function enforceShellEnvFileRead(hookPayload, normalizedShell) {
  const state = readSessionState(hookPayload)
  if (state.workflowActive !== true) return
  const referencesEnvFile =
    /(?:^|[\s"'`=(:])(?:\.\/|[~$\w./{}-]*\/)?\.env(?:\.[\w.-]+)?(?=$|[\s"'`);|&<])/.test(
      normalizedShell
    )
  if (!referencesEnvFile) return
  const readsOrPrints =
    /(?:^|[;|&(]\s*|\b)(?:cat|bat|less|more|head|tail|tac|nl|strings|xxd|od|hexdump|grep|egrep|fgrep|rg|ag|sed|awk|cut|paste|column|sort|uniq|vi|vim|nano|emacs|code|open|type)\b/.test(
      normalizedShell
    ) || /(?:^|[;|&]\s*)(?:source|\.)\s+\S*\.env\b/.test(normalizedShell)
  if (!readsOrPrints) return
  deny(
    'Blocked by Voidr policy: never read or print .env contents in the terminal or chat history. Validate only file existence, permissions, and key names through the Voidr tools. If a value was already exposed, recommend rotating it.'
  )
}

function enforceDependencyStrategyProtection(hookPayload, normalizedShell) {
  const state = readSessionState(hookPayload)
  if (state.workflowActive !== true) return
  const fragment = (policy.forbiddenDependencyShellFragments || []).find(
    value => normalizedShell.includes(value.toLowerCase())
  )
  const mutatesDependencyStrategy =
    /\brm\b[^;&|\n]*\b(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml)\b/.test(
      normalizedShell
    ) ||
    /\bnpm\b[^;&|\n]*\binstall\b[^;&|\n]*(?:--force\b|\s-f\b)/.test(
      normalizedShell
    ) ||
    /\b(?:npm|yarn|pnpm|npx)\b[^;&|\n]*--registry\b/.test(normalizedShell)
  if (!fragment && !mutatesDependencyStrategy) return
  deny(
    'Blocked by Voidr policy: do not change npm registry, cache, lockfiles, dependency flags, or package manager while diagnosing an install failure. If the install failed without network access (Copilot sandbox), report that restriction and ask the user once to rerun the step with network access.'
  )
}

function enforceSelectedRepositoryBoundary(hookPayload, name, args) {
  if (!isGenericWriteTool(name)) {
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

function enforcePreSelectionWriteGate(hookPayload, name) {
  const canonicalName = canonicalToolName(name)
  if (
    policy.safeRemoteTools.includes(canonicalName) ||
    policy.localTools.includes(canonicalName)
  ) {
    return
  }
  if (!isGenericWriteTool(name)) return
  const state = readSessionState(hookPayload)
  if (state.workflowActive !== true || state.selectedRepository) return
  deny(
    'Blocked by Voidr workflow: local files cannot be created, edited, or deleted before the linked test repository is explicitly selected and prepared. Product repositories and agent memory remain read-only during Test Plan research.'
  )
}

function enforceSensitiveProductRead(hookPayload, name, args) {
  if (!isGenericReadTool(name)) return
  const state = readSessionState(hookPayload)
  if (state.workflowActive !== true) return

  const cwd = hookPayload.cwd || process.cwd()
  for (const value of collectPathArguments(args)) {
    const candidate = realpathOrResolve(resolve(cwd, value))
    if (/(^|[/\\])\.env(?:\..*)?$/i.test(candidate)) {
      deny(
        'Blocked by Voidr policy: never read .env files or environment templates during product analysis. Derive placeholder names from public interfaces and use {{env.VARIABLE_NAME}} without reading values.'
      )
    }
    try {
      if (!existsSync(candidate) || !statSync(candidate).isFile()) continue
      const content = readFileSync(candidate, 'utf8').slice(0, 1_000_000)
      if (containsCredentialLiterals(content)) {
        deny(
          'Blocked by Voidr policy: this source file contains literal credentials or personal identifiers. Do not expose it to the model. Continue from routes, schemas, public interfaces, and placeholder variable names.'
        )
      }
    } catch {
      // Let the underlying read tool report ordinary filesystem errors.
    }
  }
}

function enforcePlatformSensitiveContent(name, args) {
  if (
    !name.startsWith('test_plans_') ||
    !policy.writeRemoteTools.includes(name)
  ) {
    return
  }
  const content = safelyStringify(args).replace(
    /\{\{env\.[A-Z0-9_]+\}\}/gi,
    ''
  )
  if (
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(content) ||
    /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/.test(content) ||
    /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/.test(content) ||
    containsCredentialLiterals(content)
  ) {
    deny(
      'Blocked by Voidr policy: Test Plan content contains a literal credential or personal identifier. Replace every value with an {{env.VARIABLE_NAME}} placeholder and remove sample/example values before writing to the platform.'
    )
  }
}

function containsCredentialLiterals(content) {
  const text = String(content || '')
  const hasEmail =
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text)
  const hasCredentialContext =
    /\b(password|senha|secret|credential|clientSecret|apiKey|authToken|users?)\b/i.test(
      text
    )
  const assignedSecret =
    /\b(password|senha|secret|clientSecret|apiKey|authToken)\b\s*[:=]\s*['"`](?!\{\{env\.)[^'"`\r\n]{3,}['"`]/i.test(
      text
    )
  const tokenLike =
    /\b(?:sk|sa)_[A-Za-z0-9_-]{12,}\b/.test(text)
  return (hasEmail && hasCredentialContext) || assignedSecret || tokenLike
}

function isGenericWriteTool(name) {
  return /(^|[-_/])(create|edit|write|delete|replace|replace_string_in_file|apply_patch|str_replace_editor)(?:$|[-_/])/i.test(
    name
  )
}

function isGenericReadTool(name) {
  return /(^|[-_/])(read|read_file|view|open_file)(?:$|[-_/])/i.test(name)
}

function recordEnvironmentSelectionRequest(hookPayload, name, args) {
  if (name !== 'applications_list_environments') return
  updateSessionState(hookPayload, {
    environmentSelectionRequestedAt: Date.now(),
    environmentApplicationId: String(args?.applicationId || '').trim() || null,
    selectedEnvironmentSlug: null,
    selectedEnvironmentAt: null
  })
}

function enforceExplicitEnvironmentSelection(hookPayload, name, args) {
  if (
    ![
      'voidr_workspace_select_test_repository',
      'voidr_workspace_prepare_test_repository',
      'voidr_workspace_scaffold_test_cases',
      'voidr_smoke_build'
    ].includes(name)
  ) {
    return
  }

  const state = readSessionState(hookPayload)
  if (state.workflowActive !== true) return

  // In the dev-first auto flow the environment is displayed on the single
  // confirmation card, so the typed "Criar testes" approval covers it as long
  // as environments were actually listed first.
  if (state.planMode === 'auto') {
    const cardApproved =
      state.planWriteApproved === true &&
      Number.isFinite(state.planWriteApprovedAt) &&
      Date.now() - state.planWriteApprovedAt <= 4 * 60 * 60 * 1000
    if (
      Number.isFinite(state.environmentSelectionRequestedAt) &&
      cardApproved
    ) {
      return
    }
    deny(
      'Blocked by Voidr workflow: list environments with applications_list_environments, show the selected environment on the confirmation card, and wait for the user to type “Criar testes” before repository setup, scaffold, or smoke/build.'
    )
  }

  const selectionFresh =
    typeof state.selectedEnvironmentSlug === 'string' &&
    state.selectedEnvironmentSlug.length > 0 &&
    Number.isFinite(state.selectedEnvironmentAt) &&
    Date.now() - state.selectedEnvironmentAt <= 4 * 60 * 60 * 1000
  if (!selectionFresh) {
    deny(
      'Blocked by Voidr workflow: list environments with applications_list_environments and ask the user to explicitly select one before repository setup, selection, scaffold, or smoke/build.'
    )
  }

  if (
    name === 'voidr_workspace_prepare_test_repository' &&
    String(args?.environmentSlug || '').trim() !==
      state.selectedEnvironmentSlug
  ) {
    deny(
      `Blocked by Voidr workflow: environmentSlug must match the explicitly selected Voidr environment (${state.selectedEnvironmentSlug}).`
    )
  }

  if (
    name === 'voidr_workspace_prepare_test_repository' &&
    state.environmentApplicationId &&
    String(args?.applicationId || '').trim() !== state.environmentApplicationId
  ) {
    deny(
      'Blocked by Voidr workflow: applicationId does not match the application whose environment was explicitly selected.'
    )
  }
}

function enforcePostSmokeStop(hookPayload, rawName, canonicalName) {
  const state = readSessionState(hookPayload)
  if (!Number.isFinite(state.smokeAttemptedAt)) return
  if (
    [
      'voidr_release_deploy_merged_pr',
      'voidr_workspace_publish_tests'
    ].includes(canonicalName)
  ) {
    return
  }
  if (/(?:ask_user|askuserquestion|todo)/i.test(rawName)) return
  deny(
    'Blocked by Voidr workflow: after voidr_smoke_build, stop and report its exact result. Do not inspect files, edit specs, retry smoke, or diagnose by guessing in the same turn. Wait for a new user message explicitly asking to investigate/correct the smoke failure before continuing.'
  )
}

function recordSmokeAttempt(hookPayload, name) {
  if (name !== 'voidr_smoke_build') return
  updateSessionState(hookPayload, {
    smokeAttemptedAt: Date.now()
  })
}

function enforceTestSpecContentPolicy(rawName, args) {
  if (!isGenericWriteTool(rawName)) {
    return
  }

  const paths = [
    ...collectPathArguments(args),
    ...collectPatchPathsFromValue(args)
  ]
  if (!paths.some(path => /\.spec\.[cm]?[jt]sx?$/i.test(path))) return

  const content = collectWrittenContent(args).join('\n')
  if (!content) return

  if (
    /process\.env\.[A-Z0-9_]+\s*(?:\|\||\?\?)\s*['"`][^'"`\r\n]+/i.test(
      content
    )
  ) {
    deny(
      'Blocked by Voidr policy: Playwright specs must not provide literal fallbacks for environment variables. Use the environment variable directly and fail clearly when required test data is absent.'
    )
  }

  if (/['"`][^'"`\s@]+@[^'"`\s@]+\.[^'"`\s@]+['"`]/i.test(content)) {
    deny(
      'Blocked by Voidr policy: do not persist email addresses in Playwright specs. Use a documented environment variable supplied by voidr env pull.'
    )
  }

  if (/page\.addInitScript[\s\S]{0,500}(?:API_URL|API_BASE|apiUrl)/i.test(content)) {
    deny(
      'Blocked by Voidr policy: tests must not overwrite deployed API runtime configuration with page.addInitScript.'
    )
  }

  if (
    /window\.location\.origin/i.test(content) &&
    /(?:API_URL|API_BASE|apiUrl|\/auth\/|\/consultas\/)/i.test(content)
  ) {
    deny(
      'Blocked by Voidr policy: do not derive an API origin from window.location.origin. Read the endpoint exposed by the deployed product runtime.'
    )
  }

  if (
    /(?:const|let|var)\s+\w*api\w*\s*=\s*(?:baseURL|data\.URL)/i.test(
      content
    ) &&
    /\/(?:auth|consultas)\//i.test(content)
  ) {
    deny(
      'Blocked by Voidr policy: do not construct API routes from the frontend base URL. Load the page and read its deployed runtime API endpoint.'
    )
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

function collectWrittenContent(value, key = '') {
  if (typeof value === 'string') {
    return /^(?:new_str|newString|content|patch|value|text)$/i.test(key)
      ? [value]
      : []
  }
  if (!value || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([childKey, childValue]) =>
    collectWrittenContent(childValue, childKey)
  )
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

function enforceSelectedTestPlanIdentity(hookPayload, canonicalName, args) {
  const state = readSessionState(hookPayload)
  const selectedId = String(state.selectedTestPlanId || '').trim().toLowerCase()
  if (!selectedId) return

  if (canonicalName === 'test_plans_list_test_plans') {
    deny(
      `Blocked by Voidr workflow: Test Plan ${selectedId} was explicitly selected. If it cannot be read in the current Voidr environment, stop and ask the user to choose another Test Plan in a new message. Never list and silently substitute a different plan.`
    )
  }

  if (
    ![
      'test_plans_get_test_plan',
      'test_plans_get_case',
      'voidr_workspace_prepare_test_repository',
      'voidr_workspace_scaffold_test_cases',
      'voidr_smoke_build',
      'voidr_release_deploy_merged_pr'
    ].includes(canonicalName)
  ) {
    return
  }

  const requestedId = extractToolTestPlanId(args)
  if (!requestedId || requestedId.toLowerCase() !== selectedId) {
    deny(
      `Blocked by Voidr workflow: the requested Test Plan must remain ${selectedId}. Do not substitute a different Test Plan. If this plan is unavailable, stop and request a new explicit selection from the user.`
    )
  }
}

function recordInitialTestPlanSelection(hookPayload, canonicalName, args) {
  if (canonicalName !== 'test_plans_get_test_plan') return
  const state = readSessionState(hookPayload)
  if (state.selectedTestPlanId) return

  const requestedId = extractToolTestPlanId(args).toLowerCase()
  if (!/^[a-f0-9]{24}$/.test(requestedId)) return
  updateSessionState(hookPayload, {
    selectedTestPlanId: requestedId,
    selectedTestPlanAt: Date.now(),
    selectedTestPlanSource: 'first-test-plan-read'
  })
}

function extractToolTestPlanId(args) {
  if (!args || typeof args !== 'object') return ''
  for (const key of ['testPlanId', 'test_plan_id', 'planId', 'plan_id']) {
    const value = args[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
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
      state.planMode === 'auto'
        ? 'Blocked by Voidr workflow: show the user the list of test scenarios for the feature and wait for a new user message saying exactly “Criar testes” before writing anything to the platform.'
        : 'Blocked by Voidr workflow: Test Plan writes require a visible draft followed by a new user message explicitly saying “Aprovo este Test Plan”. A generic “sim” is not approval. To add cases to an existing plan, follow the “Add cases to an existing plan” section of /voidr-test-plan: show the additions draft and wait for that exact approval message.'
    )
  }
}

function addDefectExecutionEvidence(hookPayload, canonicalName, args) {
  if (!isDefectCreationTool(canonicalName)) return null

  const state = readSessionState(hookPayload)
  const knownIds = state.latestEvidenceExecutionIds || []
  const inputIds = executionIdsFromToolInput(canonicalName, args, knownIds)
  const executionIds = uniqueExecutionIds([
    ...inputIds,
    ...(inputIds.length === 0 && knownIds.length === 1 ? knownIds : [])
  ])
  if (executionIds.length === 0) return null

  const executionId = executionIds[0]
  const executionUrl = buildExecutionUrl(executionId)
  const description = String(args.description || '')
  const evidenceLine = `Evidence execution: ${executionUrl}`
  const testCases = args.relations?.testCases?.length
    ? args.relations.testCases
    : state.latestEvidenceTestCaseSlugs?.length === 1
      ? state.latestEvidenceTestCaseSlugs
      : undefined

  return {
    ...args,
    description: description.includes(executionUrl)
      ? description
      : `${description}${description ? '\n\n' : ''}${evidenceLine}`,
    relations: {
      ...(args.relations || {}),
      ...(testCases ? { testCases } : {}),
      executions: uniqueExecutionIds([
        ...(args.relations?.executions || []),
        executionId
      ])
    }
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
  const output = {
    permissionDecision: 'deny',
    permissionDecisionReason: reason,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason
    }
  }
  process.stdout.write(`${JSON.stringify(output)}\n`)
  process.exit(0)
}

function allowUpdatedInput(updatedInput) {
  const output = {
    permissionDecision: 'allow',
    updatedInput,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      updatedInput
    }
  }
  process.stdout.write(`${JSON.stringify(output)}\n`)
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
