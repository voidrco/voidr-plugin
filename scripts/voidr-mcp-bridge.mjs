#!/usr/bin/env node

import { createInterface } from 'node:readline'
import {
  authStatus,
  selectOrganization,
  validatedAuthStatus
} from './lib/credentials.mjs'
import { canonicalToolName, isWriteTool, loadPolicy } from './lib/policy.mjs'
import { RemoteMcpClient } from './lib/remote-mcp.mjs'
import { bootstrapTestRepository } from './lib/bootstrap.mjs'
import {
  canonicalizePotentialPath,
  inspectWorkspace,
  resolveWorkspaceRoot,
  validateProvisionedRepositorySelection,
  validateRepositorySelection
} from './lib/workspace.mjs'
import { deployMergedPullRequest } from './lib/release-deploy.mjs'
import { connectWithBrowser } from './lib/browser-auth.mjs'
import { buildTestRepository, scaffoldTestCases } from './lib/scaffold.mjs'
import { prepareTestRepository } from './lib/prepare.mjs'

const policy = loadPolicy()
const safeRemote = new Set(policy.safeRemoteTools)
const localNames = new Set(policy.localTools)
const remote = new RemoteMcpClient()
const provisionedTestPlans = new Set()
let negotiatedProtocol = '2024-11-05'
let selectedTestPlanId = null
let planCreationFailed = false
// Structure slugs actually returned by the platform this session. They are
// the only identifiers the model may reference when adding cases to modules
// it just created — invented slugs are blocked before any network call.
const sessionModules = new Map() // planId -> Set<moduleSlug>
const sessionSuites = new Map() // planId -> Map<moduleSlug, Set<suiteSlug>>
const failedStructureRefs = new Set() // `${planId}|${slug}` that returned not-found
let preparedRepositoryPath = null
// Data provenance: platform facts only exist when a tool response returned
// them this session. Writes referencing values the platform never returned
// are blocked before any side effect.
let applicationsListed = false
const seenApplicationIds = new Set()
const seenEnvironments = new Map() // applicationId -> Set<slug>
const seenPlanSlugs = new Map() // planId -> Set<slug> (modules/suites/cases)

const localTools = [
  {
    name: 'voidr_auth_status',
    description:
      'Validate the selected local Voidr Service Account against the platform and report organization and scopes without exposing credentials.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'voidr_auth_select_organization',
    description:
      'Select one organization from the existing local Voidr Service Account store. Requires the user to choose first.',
    inputSchema: {
      type: 'object',
      properties: {
        organizationId: { type: 'string' }
      },
      required: ['organizationId']
    }
  },
  {
    name: 'voidr_auth_login',
    description:
      'Open the official Voidr browser login, let the user choose an organization, then create, validate, and store a dedicated Copilot Service Account without exposing credentials.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'voidr_workspace_inspect',
    description:
      'List likely repositories in the current workspace without selecting or modifying any of them. When the MCP process cannot see the real workspace, pass workspaceRoot with the absolute path of the open VS Code workspace folder.',
    inputSchema: {
      type: 'object',
      properties: {
        maxDepth: {
          type: 'number',
          minimum: 1,
          maximum: 4,
          default: 2
        },
        workspaceRoot: { type: 'string' }
      }
    }
  },
  {
    name: 'voidr_workspace_bootstrap_test_repository',
    description:
      'Create a minimal Voidr Playwright test repository at an explicitly confirmed empty destination, or initialize an explicitly confirmed Git checkout whose origin matches the repository provisioned by Voidr.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        name: { type: 'string' },
        organizationId: { type: 'string' },
        applicationId: { type: 'string' },
        testPlanId: { type: 'string' },
        allowExistingGitRepository: {
          type: 'boolean',
          default: false
        },
        repositoryUrl: {
          type: 'string'
        },
        workspaceRoot: { type: 'string' }
      },
      required: [
        'path',
        'organizationId',
        'applicationId',
        'testPlanId'
      ]
    }
  },
  {
    name: 'voidr_workspace_select_test_repository',
    description:
      'Validate and record the test repository explicitly selected by the user. This never infers a plan from project.json. When the MCP process cannot see the real workspace, pass workspaceRoot with the absolute path of the open VS Code workspace folder.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        repositoryUrl: {
          type: 'string',
          pattern: '^https://github\\.com/[^/]+/[^/]+(?:\\.git)?$'
        },
        workspaceRoot: { type: 'string' }
      },
      required: ['path']
    }
  },
  {
    name: 'voidr_workspace_prepare_test_repository',
    description:
      'Materialize and prepare the platform-linked Voidr test repository in one mandatory sequence: locate an existing checkout by Git origin anywhere in the workspace or clone the linked repository inside it, install dependencies, authenticate Voidr CLI child processes through the selected plugin Service Account without interactive login, link only when project.json is absent, scaffold exact platform cases, and pull the selected environment secrets without exposing values. Pass workspaceRoot with the absolute path of the open VS Code workspace folder.',
    inputSchema: {
      type: 'object',
      properties: {
        repositoryPath: { type: 'string' },
        workspaceRoot: { type: 'string' },
        organizationId: { type: 'string' },
        applicationId: { type: 'string' },
        testPlanId: {
          type: 'string',
          pattern: '^[a-fA-F0-9]{24}$'
        },
        environmentSlug: { type: 'string' },
        repositoryUrl: {
          type: 'string',
          pattern: '^https://github\\.com/[^/]+/[^/]+(?:\\.git)?$'
        },
        cases: {
          type: 'array',
          minItems: 1,
          items: { type: 'string' }
        }
      },
      required: [
        'repositoryPath',
        'organizationId',
        'applicationId',
        'testPlanId',
        'environmentSlug',
        'repositoryUrl',
        'cases'
      ]
    }
  },
  {
    name: 'voidr_workspace_scaffold_test_cases',
    description:
      'Run the Voidr CLI scaffold for explicitly selected Test Plan case slugs inside the selected repository while injecting the selected Service Account and the plugin environment without exposing credentials.',
    inputSchema: {
      type: 'object',
      properties: {
        repositoryPath: { type: 'string' },
        repositoryUrl: {
          type: 'string',
          pattern: '^https://github\\.com/[^/]+/[^/]+(?:\\.git)?$'
        },
        testPlanId: {
          type: 'string',
          pattern: '^[a-fA-F0-9]{24}$'
        },
        cases: {
          type: 'array',
          minItems: 1,
          items: { type: 'string' }
        }
      },
      required: ['repositoryPath', 'repositoryUrl', 'testPlanId', 'cases']
    }
  },
  {
    name: 'voidr_smoke_build',
    description:
      'Run only the explicitly selected Playwright specs outside the Copilot shell sandbox, require zero failures and skips, then validate and build the linked Voidr repository. This atomic authenticated gate keeps .env and Service Account credentials opaque and never builds when selected tests did not pass.',
    inputSchema: {
      type: 'object',
      properties: {
        repositoryPath: { type: 'string' },
        repositoryUrl: {
          type: 'string',
          pattern: '^https://github\\.com/[^/]+/[^/]+(?:\\.git)?$'
        },
        testPlanId: {
          type: 'string',
          pattern: '^[a-fA-F0-9]{24}$'
        },
        specs: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'string',
            pattern: '^(?!/)(?!.*(?:^|/|\\\\)\\.\\.(?:/|\\\\|$)).+\\.spec\\.[cm]?[jt]sx?$'
          }
        },
        baseUrl: {
          type: 'string',
          pattern: '^https?://'
        }
      },
      required: [
        'repositoryPath',
        'repositoryUrl',
        'testPlanId',
        'specs',
        'baseUrl'
      ]
    }
  },
  {
    name: 'voidr_release_deploy_merged_pr',
    description:
      'Build, upload, promote, and verify an immutable Voidr release only when the selected test repository is clean and exactly at a PR commit already merged into the GitHub default branch. The tool reports completion only after latest points to that immutable codebaseVersion.',
    inputSchema: {
      type: 'object',
      properties: {
        repositoryPath: { type: 'string' },
        repositoryUrl: {
          type: 'string',
          pattern: '^https://github\\.com/[^/]+/[^/]+(?:\\.git)?$'
        },
        pullRequestNumber: { type: 'integer', minimum: 1 },
        testPlanId: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' }
      },
      required: [
        'repositoryPath',
        'repositoryUrl',
        'pullRequestNumber',
        'testPlanId'
      ]
    }
  }
]

const lines = createInterface({
  input: process.stdin,
  crlfDelay: Infinity
})

lines.on('line', line => {
  if (!line.trim()) return
  void handleLine(line)
})

async function handleLine(line) {
  let request
  try {
    request = JSON.parse(line)
  } catch {
    writeError(null, -32700, 'Parse error')
    return
  }

  if (!Object.hasOwn(request, 'id')) return

  try {
    const result = await dispatch(request.method, request.params || {})
    writeResult(request.id, result)
  } catch (error) {
    writeError(
      request.id,
      -32000,
      error instanceof Error ? error.message : 'Voidr bridge failed'
    )
  }
}

async function dispatch(method, params) {
  switch (method) {
    case 'initialize':
      negotiatedProtocol =
        params.protocolVersion || params.protocol_version || negotiatedProtocol
      return {
        protocolVersion: negotiatedProtocol,
        capabilities: { tools: { listChanged: true } },
        serverInfo: {
          name: 'voidr-safe-bridge',
          version: '0.2.19-local.30'
        }
      }
    case 'ping':
      return {}
    case 'tools/list':
      return listTools()
    case 'tools/call':
      return callTool(params)
    default:
      throw new Error(`Unsupported MCP method: ${method}`)
  }
}

async function listTools() {
  let remoteTools = []
  try {
    await remote.initialize(negotiatedProtocol)
    const listed = await remote.listTools()
    remoteTools = (listed?.tools || []).filter(tool => safeRemote.has(tool.name))
  } catch (error) {
    process.stderr.write(
      `[voidr-safe-bridge] Remote tools unavailable: ${
        error instanceof Error ? error.message : String(error)
      }\n`
    )
  }

  return {
    tools: [...localTools, ...remoteTools]
  }
}

async function callTool(params) {
  const rawName = params.name
  const name = canonicalToolName(rawName)
  const args = params.arguments || {}

  if (name === 'voidr_auth_status') {
    selectedTestPlanId = null
    planCreationFailed = false
    resetStructureTracking()
  }
  enforceBridgeTestPlanIdentity(name, args)

  if (isWriteTool(name) && !authStatus().canWrite) {
    throw new Error(
      'The selected Voidr Service Account does not declare the write scope. Platform mutation was blocked.'
    )
  }

  enforcePlatformProvenance(name, args)

  if (localNames.has(name)) return callLocal(name, args)
  if (!safeRemote.has(name)) {
    throw new Error(`Tool ${rawName} is not allowed by the Voidr plugin policy.`)
  }

  if (
    [
      'applications_list_applications',
      'applications_get_application',
      'applications_list_environments',
      'test_plans_get_test_plan'
    ].includes(name)
  ) {
    const result = await remote.callTool(name, args)
    if (!result?.isError) recordProvenance(name, args, result)
    return result
  }

  if (name === 'test_plans_populate_test_plan') {
    const planId = String(args.planId || '').trim()
    if (!planId || !provisionedTestPlans.has(planId)) {
      throw new Error(
        'Blocked by Voidr workflow: populate_test_plan requires a successful create_test_plan response in this session containing the linked repository URL, owner, name, and default branch.'
      )
    }
  }

  if (name === 'test_plans_create_test_plan') {
    let result
    try {
      result = await remote.callTool(name, args)
      const provisioned = validateProvisionedTestPlan(result)
      provisionedTestPlans.add(provisioned.planId)
      selectedTestPlanId = provisioned.planId.toLowerCase()
      planCreationFailed = false
    } catch (error) {
      planCreationFailed = true
      throw error
    }
    return result
  }

  if (STRUCTURE_TOOLS.has(name)) return callStructureTool(name, args)

  const result = await remote.callTool(name, args)
  if (name === 'test_plans_populate_test_plan' && !result?.isError) {
    recordPlanSlugs(bridgeTestPlanId(args), remoteResultData(result))
  }
  return result
}

function recordPlanSlugs(planId, data) {
  const key = String(planId || '').toLowerCase()
  if (!key) return
  if (!seenPlanSlugs.has(key)) seenPlanSlugs.set(key, new Set())
  const slugs = seenPlanSlugs.get(key)
  for (const value of collectStringsByKey(data, ['slug', 'identifier'])) {
    slugs.add(value.toLowerCase())
  }
}

const STRUCTURE_TOOLS = new Set([
  'test_plans_create_module',
  'test_plans_create_suite',
  'test_plans_create_case'
])

async function callStructureTool(name, args) {
  const planId = bridgeTestPlanId(args).toLowerCase()
  enforceKnownStructureRefs(name, planId, args)

  let result
  try {
    result = await remote.callTool(name, args)
  } catch (error) {
    recordFailedStructureRef(planId, error?.message)
    throw new Error(appendStructureHint(planId, error?.message))
  }
  if (result?.isError) {
    const text = structureResultText(result)
    recordFailedStructureRef(planId, text)
    return withStructureHint(result, planId, text)
  }

  recordCreatedStructure(name, planId, args, result)
  recordPlanSlugs(planId, remoteResultData(result))
  return result
}

function enforceKnownStructureRefs(name, planId, args) {
  const moduleSlug = String(args.moduleSlug || '').trim()
  const suiteSlug = String(args.suiteSlug || '').trim()

  for (const slug of [moduleSlug, suiteSlug]) {
    if (slug && failedStructureRefs.has(`${planId}|${slug.toLowerCase()}`)) {
      throw new Error(
        `Blocked by Voidr workflow: identifier '${slug}' already failed with not-found in this session. Do not retry invented identifiers. Read the plan with test_plans_get_test_plan and use the exact slug the platform returns.${knownStructureHint(planId)}`
      )
    }
  }

  // A module created this session can only contain suites created this
  // session, so an unknown suite slug is an invented one — block it before
  // the network call and hand the model the valid slugs.
  if (name === 'test_plans_create_case' && moduleSlug && suiteSlug) {
    const sessionModule = sessionModules.get(planId)?.has(moduleSlug.toLowerCase())
    const suites = sessionSuites.get(planId)?.get(moduleSlug.toLowerCase())
    if (sessionModule && suites?.size && !suites.has(suiteSlug.toLowerCase())) {
      throw new Error(
        `Blocked by Voidr workflow: suite '${suiteSlug}' was never created in module '${moduleSlug}'. Use exactly one of the suite slugs returned by test_plans_create_suite: ${[...suites].join(', ')}. Never invent or re-case identifiers.`
      )
    }
  }
}

function recordCreatedStructure(name, planId, args, result) {
  const data = remoteResultData(result)
  if (name === 'test_plans_create_module') {
    const slug = structureSlug(data, args)
    if (!slug) return
    if (!sessionModules.has(planId)) sessionModules.set(planId, new Set())
    sessionModules.get(planId).add(slug)
    return
  }
  if (name === 'test_plans_create_suite') {
    const moduleSlug = String(args.moduleSlug || '').trim().toLowerCase()
    const slug = structureSlug(data, args)
    if (!moduleSlug || !slug) return
    if (!sessionSuites.has(planId)) sessionSuites.set(planId, new Map())
    const modules = sessionSuites.get(planId)
    if (!modules.has(moduleSlug)) modules.set(moduleSlug, new Set())
    modules.get(moduleSlug).add(slug)
  }
}

function structureSlug(data, args) {
  for (const source of [data, args]) {
    if (!source || typeof source !== 'object') continue
    for (const key of ['slug', 'identifier']) {
      const value = source[key]
      if (typeof value === 'string' && value.trim()) {
        return value.trim().toLowerCase()
      }
    }
  }
  return ''
}

function recordFailedStructureRef(planId, text) {
  const match = String(text || '').match(
    /(?:suite|module)\s+with\s+identifier\s+'([^']+)'\s+not\s+found/i
  )
  if (match) {
    failedStructureRefs.add(`${planId}|${match[1].trim().toLowerCase()}`)
  }
}

function knownStructureHint(planId) {
  const parts = []
  const modules = sessionModules.get(planId)
  if (modules?.size) {
    parts.push(`Module slugs created this session: ${[...modules].join(', ')}.`)
  }
  const suites = sessionSuites.get(planId)
  if (suites?.size) {
    for (const [moduleSlug, slugs] of suites) {
      if (slugs.size) {
        parts.push(
          `Suite slugs created in module '${moduleSlug}': ${[...slugs].join(', ')}.`
        )
      }
    }
  }
  return parts.length ? ` ${parts.join(' ')}` : ''
}

function appendStructureHint(planId, message) {
  const base = String(message || 'Voidr structure call failed.')
  if (!/not\s+found/i.test(base)) return base
  return `${base}${knownStructureHint(planId)} Do not retry the same identifier; read the plan with test_plans_get_test_plan if the right slug is unknown.`
}

function withStructureHint(result, planId, text) {
  if (!/not\s+found/i.test(String(text || ''))) return result
  const hint = `${knownStructureHint(planId)} Do not retry the same identifier; read the plan with test_plans_get_test_plan if the right slug is unknown.`
  return {
    ...result,
    content: [
      ...(result.content || []),
      { type: 'text', text: hint.trim() }
    ]
  }
}

function structureResultText(result) {
  return (result?.content || [])
    .filter(item => item?.type === 'text')
    .map(item => String(item.text || ''))
    .join('\n')
}

function resetStructureTracking() {
  sessionModules.clear()
  sessionSuites.clear()
  failedStructureRefs.clear()
  preparedRepositoryPath = null
  applicationsListed = false
  seenApplicationIds.clear()
  seenEnvironments.clear()
  seenPlanSlugs.clear()
}

// Every platform identifier used in a mutating or preparing call must have
// been returned by a platform read in this session. Guessing is blocked with
// the exact read tool to call.
function enforcePlatformProvenance(name, args) {
  if (name === 'test_plans_create_test_plan') {
    assertKnownApplication(String(args.applicationId || '').trim())
  }

  if (name === 'voidr_workspace_prepare_test_repository') {
    const applicationId = String(args.applicationId || '').trim()
    assertKnownApplication(applicationId)
    assertKnownEnvironment(applicationId, String(args.environmentSlug || ''))
    assertKnownCases(String(args.testPlanId || ''), args.cases)
  }

  if (name === 'voidr_workspace_scaffold_test_cases') {
    assertKnownCases(String(args.testPlanId || ''), args.cases)
  }
}

function assertKnownApplication(applicationId) {
  if (!applicationsListed) {
    throw new Error(
      'Blocked by Voidr workflow: consult the platform first. Call applications_list_applications and use an application the platform actually returned; never infer an applicationId.'
    )
  }
  if (
    applicationId &&
    seenApplicationIds.size &&
    !seenApplicationIds.has(applicationId.toLowerCase())
  ) {
    throw new Error(
      `Blocked by Voidr workflow: applicationId ${applicationId} was not returned by the platform in this session. Use exactly one of the applications from applications_list_applications; never infer or reuse an ID from memory.`
    )
  }
}

function assertKnownEnvironment(applicationId, environmentSlug) {
  const slugs = seenEnvironments.get(applicationId.toLowerCase())
  if (!slugs) {
    throw new Error(
      'Blocked by Voidr workflow: consult the platform first. Call applications_list_environments for the selected application and use a returned environment slug; never infer an environment.'
    )
  }
  const slug = String(environmentSlug || '').trim().toLowerCase()
  if (slug && slugs.size && !slugs.has(slug)) {
    throw new Error(
      `Blocked by Voidr workflow: environment '${environmentSlug}' was not returned for this application. Use exactly one of: ${[...slugs].join(', ')}.`
    )
  }
}

function assertKnownCases(planId, cases) {
  const known = seenPlanSlugs.get(planId.toLowerCase())
  if (!known?.size || !Array.isArray(cases)) return
  const unknown = cases
    .map(value => String(value).trim())
    .filter(value => value && !known.has(value.toLowerCase()))
  if (unknown.length) {
    throw new Error(
      `Blocked by Voidr workflow: case slug(s) ${unknown.join(', ')} were not returned by the platform for this Test Plan. Read the plan with test_plans_get_test_plan and use the exact case slugs it returns; never invent slugs.`
    )
  }
}

function recordProvenance(name, args, result) {
  const data = remoteResultData(result)
  if (
    name === 'applications_list_applications' ||
    name === 'applications_get_application'
  ) {
    applicationsListed = true
    for (const value of collectStringsByKey(data, [
      '_id',
      'id',
      'applicationId'
    ])) {
      if (/^[a-f0-9]{24}$/i.test(value)) {
        seenApplicationIds.add(value.toLowerCase())
      }
    }
    return
  }
  if (name === 'applications_list_environments') {
    const applicationId = String(args.applicationId || '')
      .trim()
      .toLowerCase()
    if (!applicationId) return
    if (!seenEnvironments.has(applicationId)) {
      seenEnvironments.set(applicationId, new Set())
    }
    const slugs = seenEnvironments.get(applicationId)
    for (const value of collectStringsByKey(data, ['slug'])) {
      slugs.add(value.toLowerCase())
    }
    return
  }
  if (name === 'test_plans_get_test_plan') {
    const planId = bridgeTestPlanId(args).toLowerCase()
    if (!planId) return
    if (!seenPlanSlugs.has(planId)) seenPlanSlugs.set(planId, new Set())
    const slugs = seenPlanSlugs.get(planId)
    for (const value of collectStringsByKey(data, ['slug', 'identifier'])) {
      slugs.add(value.toLowerCase())
    }
  }
}

function collectStringsByKey(value, keys, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 8) return []
  const results = []
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === 'string' && keys.includes(key) && child.trim()) {
      results.push(child.trim())
    } else if (child && typeof child === 'object') {
      results.push(...collectStringsByKey(child, keys, depth + 1))
    }
  }
  return results
}

// The smoke must run against the checkout the session actually prepared. A
// stray clone in /tmp (or anywhere else) is rejected with the correct path.
function enforcePreparedRepository(repositoryPath) {
  if (!preparedRepositoryPath) return
  const requested = canonicalizePotentialPath(repositoryPath)
  if (requested !== preparedRepositoryPath) {
    throw new Error(
      `Blocked by Voidr workflow: run the smoke against the repository prepared in this session: ${preparedRepositoryPath}. Do not use ${requested}.`
    )
  }
}

function enforceBridgeTestPlanIdentity(name, args) {
  if (name === 'test_plans_list_test_plans' && planCreationFailed) {
    throw new Error(
      'Blocked by Voidr workflow: test_plans_create_test_plan failed in this session. Stop, show the user the exact creation error, and offer to retry or cancel. Never list existing Test Plans to silently replace the new plan the user asked for.'
    )
  }

  if (name === 'test_plans_list_test_plans' && selectedTestPlanId) {
    throw new Error(
      `Blocked by Voidr workflow: Test Plan ${selectedTestPlanId} is already selected. If it was not found, stop and ask the user to explicitly choose another Test Plan. Never list and silently substitute a different plan.`
    )
  }

  const requestedId = bridgeTestPlanId(args)
  if (
    name === 'test_plans_get_test_plan' &&
    !selectedTestPlanId &&
    /^[a-f0-9]{24}$/i.test(requestedId)
  ) {
    selectedTestPlanId = requestedId.toLowerCase()
    return
  }

  if (
    selectedTestPlanId &&
    requestedId &&
    requestedId.toLowerCase() !== selectedTestPlanId
  ) {
    throw new Error(
      `Blocked by Voidr workflow: the selected Test Plan is ${selectedTestPlanId}. Do not substitute ${requestedId}. Ask the user for a new explicit selection first.`
    )
  }
}

function bridgeTestPlanId(args) {
  if (!args || typeof args !== 'object') return ''
  for (const key of ['testPlanId', 'test_plan_id', 'planId', 'plan_id']) {
    const value = args[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function validateProvisionedTestPlan(result) {
  if (result?.isError) {
    throw new Error(
      'Voidr did not create the Test Plan and linked repository. Population remains blocked.'
    )
  }
  const data = remoteResultData(result)
  const repository = data?.repository
  const planId = String(data?._id || data?.testPlanId || data?.id || '').trim()
  if (
    !planId ||
    !repository ||
    !String(repository.url || '').trim() ||
    !String(repository.owner || '').trim() ||
    !String(repository.name || '').trim() ||
    !String(repository.defaultBranch || '').trim()
  ) {
    throw new Error(
      'Incomplete Voidr creation response: the Test Plan is not usable until the server returns its ID and a linked repository with URL, owner, name, and default branch. populate_test_plan was blocked.'
    )
  }
  return { planId, repository }
}

function remoteResultData(result) {
  if (result?.structuredContent?.data) return result.structuredContent.data
  for (const item of result?.content || []) {
    if (item?.type !== 'text') continue
    const lines = String(item.text || '')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .reverse()
    for (const line of lines) {
      try {
        return JSON.parse(line)
      } catch {
        // Continue until the last serialized MCP data line is found.
      }
    }
  }
  return null
}

async function callLocal(name, args) {
  switch (name) {
    case 'voidr_auth_status':
      return textResult(await validatedAuthStatus())
    case 'voidr_auth_select_organization': {
      const selected = selectOrganization(String(args.organizationId || ''))
      selectedTestPlanId = null
      planCreationFailed = false
      resetStructureTracking()
      remote.reset()
      announceToolsChanged()
      return textResult({
        selected: true,
        organizationId: selected.orgId,
        organizationName: selected.account?.orgName || null,
        scopes: selected.account?.scopes || []
      })
    }
    case 'voidr_auth_login': {
      const imported = await connectWithBrowser()
      selectedTestPlanId = null
      planCreationFailed = false
      resetStructureTracking()
      remote.reset()
      announceToolsChanged()
      return textResult(imported)
    }
    case 'voidr_workspace_inspect':
      return textResult(
        inspectWorkspace(
          resolveWorkspaceRoot({ explicit: args.workspaceRoot }),
          Math.max(1, Math.min(4, Number(args.maxDepth) || 2))
        )
      )
    case 'voidr_workspace_bootstrap_test_repository':
      return textResult(
        bootstrapTestRepository({
          target: String(args.path || ''),
          name: args.name ? String(args.name) : undefined,
          organizationId: String(args.organizationId || ''),
          applicationId: String(args.applicationId || ''),
          testPlanId: String(args.testPlanId || ''),
          allowExistingGitRepository:
            args.allowExistingGitRepository === true,
          repositoryUrl: args.repositoryUrl
            ? String(args.repositoryUrl)
            : undefined,
          workspaceRoot: resolveWorkspaceRoot({ explicit: args.workspaceRoot })
        })
      )
    case 'voidr_workspace_select_test_repository':
      return textResult(
        args.repositoryUrl
          ? validateProvisionedRepositorySelection(
              String(args.path || ''),
              String(args.repositoryUrl)
            )
          : validateRepositorySelection(
              String(args.path || ''),
              resolveWorkspaceRoot({ explicit: args.workspaceRoot })
            )
      )
    case 'voidr_workspace_prepare_test_repository': {
      const prepared = await prepareTestRepository({
        repositoryPath: String(args.repositoryPath || ''),
        organizationId: String(args.organizationId || ''),
        applicationId: String(args.applicationId || ''),
        testPlanId: String(args.testPlanId || ''),
        environmentSlug: String(args.environmentSlug || ''),
        repositoryUrl: String(args.repositoryUrl || ''),
        cases: Array.isArray(args.cases) ? args.cases : [],
        workspaceRoot: args.workspaceRoot
          ? String(args.workspaceRoot)
          : undefined
      })
      preparedRepositoryPath = prepared.repositoryPath
      return textResult(prepared)
    }
    case 'voidr_workspace_scaffold_test_cases':
      return textResult(
        await scaffoldTestCases({
          repositoryPath: String(args.repositoryPath || ''),
          repositoryUrl: String(args.repositoryUrl || ''),
          testPlanId: String(args.testPlanId || ''),
          cases: Array.isArray(args.cases) ? args.cases : []
        })
      )
    case 'voidr_smoke_build':
      enforcePreparedRepository(String(args.repositoryPath || ''))
      return textResult(
        await buildTestRepository({
          repositoryPath: String(args.repositoryPath || ''),
          repositoryUrl: String(args.repositoryUrl || ''),
          testPlanId: String(args.testPlanId || ''),
          specs: Array.isArray(args.specs) ? args.specs : [],
          baseUrl: String(args.baseUrl || '')
        })
      )
    case 'voidr_release_deploy_merged_pr':
      return textResult(
        await deployMergedPullRequest({
          repositoryPath: String(args.repositoryPath || ''),
          repositoryUrl: String(args.repositoryUrl || ''),
          pullRequestNumber: Number(args.pullRequestNumber),
          testPlanId: String(args.testPlanId || '')
        })
      )
    default:
      throw new Error(`Unknown local Voidr tool: ${name}`)
  }
}

function textResult(value) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(value)
      }
    ]
  }
}

function writeResult(id, result) {
  process.stdout.write(
    `${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`
  )
}

function writeError(id, code, message) {
  process.stdout.write(
    `${JSON.stringify({
      jsonrpc: '2.0',
      id,
      error: { code, message }
    })}\n`
  )
}

function announceToolsChanged() {
  setImmediate(() => {
    process.stdout.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/tools/list_changed'
      })}\n`
    )
  })
}
