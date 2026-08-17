#!/usr/bin/env node

import { randomUUID } from 'node:crypto'
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
import { applySystemCaTrust } from './lib/network-trust.mjs'
import { buildTestRepository, scaffoldTestCases } from './lib/scaffold.mjs'
import { prepareTestRepository } from './lib/prepare.mjs'
import { contextBootstrap } from './lib/context.mjs'
import { publishTests } from './lib/publish.mjs'
import { inspectReleaseReadiness } from './lib/release-inspect.mjs'
import { collectGitContext } from './lib/git-context.mjs'
import {
  enrichToolResultWithExecutionLinks
} from './lib/execution-links.mjs'

const systemTrust = applySystemCaTrust()
process.stderr.write(
  `voidr-mcp-bridge: system CA trust ${systemTrust.status}` +
    (systemTrust.systemCertificates
      ? ` (${systemTrust.systemCertificates} certificates)`
      : '') +
    '\n'
)

const policy = loadPolicy()
const safeRemote = new Set(policy.safeRemoteTools)
const localNames = new Set(policy.localTools)
const remote = new RemoteMcpClient()
const provisionedTestPlans = new Set()
let negotiatedProtocol = '2024-11-05'
let selectedTestPlanId = null
let planCreationFailed = false
// { fingerprint, key } for the creation being attempted. The platform stores
// the key on the plan, so resending it is what turns a retry into a resume.
let creationIdempotency = null
// Plans the platform created without a repository, confirmed by reading them
// back. They accept planning writes and refuse everything that needs a
// checkout until test_plans_provision_repository links one.
//
// The platform has since chosen the opposite recovery for a failed creation: it
// rolls the new plan back, so "error" means nothing was created and this mode
// normally stays idle — the read-back finds no plan and the error surfaces as
// usual. It still earns its place for the two cases the rollback does not
// cover: a plan from an earlier idempotent attempt (the platform only rolls
// back what the current call created) and plans left behind before that change.
const automationPendingPlans = new Map() // planId -> { planId, name, fingerprint, reason }
let lastFailedCreateArgs = null
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
// Execution discipline: an execution requires the sync verification reads
// first, and a "not automated" rejection means the cases need a deploy —
// never a re-creation of the plan structure.
let planReadAt = null
let countsReadAt = null
let executionNeedsDeploy = false

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
    name: 'voidr_context_bootstrap',
    description:
      'Build the whole working context of a Test Plan in one atomic call: read the plan from the platform (IDs and linked repository), resolve the platform environment, list the recorded session IDs of the application, locate the checkout by Git origin (the clone itself is always done by the user — a missing checkout returns the clone handover message), write the gitignored manifest-context.json at the repository root, and run the framework preparation (npm install, Service Account auth in child processes only, link when project.json is absent, scaffold, env pull without exposing values). Idempotent: call it again after the user clones or after a failure and it continues from the manifest. Pass environmentSlug when the application has more than one environment; without it the tool returns the environment listing to render with ask_user.',
    inputSchema: {
      type: 'object',
      properties: {
        planId: {
          type: 'string',
          pattern: '^[a-fA-F0-9]{24}$'
        },
        environmentSlug: { type: 'string' },
        workspaceRoot: { type: 'string' }
      },
      required: ['planId']
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
        },
        mode: {
          type: 'string',
          enum: ['validation', 'exploration'],
          description:
            'validation (default) gates on zero failures/skips and builds. exploration runs throwaway inspection specs against the deployed app, tolerates failures, returns per-test stdout/traces, never builds and never counts as validation.'
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
    name: 'voidr_workspace_git_context',
    description:
      'Read-only Git discovery for the workspace repositories: current branch, default branch, dirty state, commits ahead, changed files versus the default branch, the changed hunks themselves (changedHunksVsDefault.diff), and recent commits. Use this to infer the developer feature and to scope test scenarios to what actually changed — never cd or run git in the terminal, where paths with spaces break quoting and the sandbox may deny access. Pass workspaceRoot with the absolute path of the open VS Code workspace folder; optionally pass repositoryPath to inspect a single repository. When the response reports repositoriesNotInspected, the workspace has more repositories than one call covers: call again with repositoryPath for the feature repository.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceRoot: { type: 'string' },
        repositoryPath: { type: 'string' }
      }
    }
  },
  {
    name: 'voidr_release_inspect',
    description:
      'Read-only release readiness inspection of the selected test repository: reads project.json (Test Plan/organization/application IDs), the Git origin URL, the default branch, HEAD and worktree state, and locates the merged pull request for the current HEAD via gh. Call this instead of asking the user for a Test Plan ID, repository URL, or PR number. Pass workspaceRoot with the absolute path of the open VS Code workspace folder.',
    inputSchema: {
      type: 'object',
      properties: {
        repositoryPath: { type: 'string' },
        workspaceRoot: { type: 'string' }
      },
      required: ['repositoryPath']
    }
  },
  {
    name: 'voidr_workspace_publish_tests',
    description:
      'Publish the implemented tests from the linked checkout after the user explicitly authorized it in chat: create or reuse a feature branch, commit, push with an explicit refspec, and open (or reuse) a pull request to the default branch. Runs outside the Copilot shell sandbox with the user Git credentials. Pushing to the default branch is refused; the immutable deploy requires a merged pull request.',
    inputSchema: {
      type: 'object',
      properties: {
        repositoryPath: { type: 'string' },
        repositoryUrl: {
          type: 'string',
          pattern: '^https://github\\.com/[^/]+/[^/]+(?:\\.git)?$'
        },
        branch: { type: 'string' },
        commitMessage: { type: 'string' },
        pullRequestTitle: { type: 'string' },
        pullRequestBody: { type: 'string' },
        createPullRequest: { type: 'boolean', default: true }
      },
      required: ['repositoryPath', 'repositoryUrl', 'branch', 'commitMessage']
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

let requestQueue = Promise.resolve()
lines.on('line', line => {
  if (!line.trim()) return
  requestQueue = requestQueue.then(() => handleLine(line))
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
          version: '0.2.22'
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
  enforceRepositoryAvailability(name, args)

  if (localNames.has(name)) return callLocal(name, args)
  if (!safeRemote.has(name)) {
    throw new Error(`Tool ${rawName} is not allowed by the Voidr plugin policy.`)
  }

  if (
    [
      'applications_list_applications',
      'applications_get_application',
      'applications_list_environments',
      'test_plans_get_test_plan',
      'test_plans_get_test_counts'
    ].includes(name)
  ) {
    const result = await remote.callTool(name, args)
    if (!result?.isError) {
      recordProvenance(name, args, result)
      if (name === 'test_plans_get_test_plan') planReadAt = Date.now()
      if (name === 'test_plans_get_test_counts') countsReadAt = Date.now()
    }
    return result
  }

  if (name === 'test_plans_list_test_plans') {
    if (!String(args?.applicationId || '').trim()) {
      throw new Error(
        'Blocked by Voidr workflow: test_plans_list_test_plans requires the selected applicationId. Select the application with applications_list_applications first, then list only that application’s Test Plans.'
      )
    }
    const result = await remote.callTool(name, args)
    return slimTestPlanListing(result)
  }

  if (name === 'test_plans_provision_repository') {
    const result = await remote.callTool(name, args)
    // Only a response that actually links a repository lifts planning-only
    // mode, and only for the plan it names. Without that evidence the blocks
    // stay: a plan wrongly unblocked sends the flow to a checkout that does
    // not exist, while a plan wrongly kept blocked is released by calling this
    // idempotent tool again with the plan ID.
    const data = result?.isError ? null : remoteResultData(result)
    if (hasLinkedRepository(data?.repository)) {
      const planId = String(
        data?.testPlanId || data?._id || bridgeTestPlanId(args)
      )
        .trim()
        .toLowerCase()
      if (planId) automationPendingPlans.delete(planId)
    }
    return result
  }

  if (name === 'file_embeddings_search_documents') {
    const normalized = normalizeDocumentSearchArgs(args)
    const result = await remote.callTool(name, normalized.args)
    return slimDocumentSearchResult(result, normalized.notes)
  }

  if (name === 'executions_create_execution') {
    if (!planReadAt || !countsReadAt) {
      throw new Error(
        'Blocked by Voidr workflow: an execution requires the sync verification first. Read the plan with test_plans_get_test_plan and the counts with test_plans_get_test_counts, confirm every selected case is automated, and only then create the execution. If cases are not automated, the fix is deploying the merged PR with voidr_release_deploy_merged_pr — never re-creating modules, suites, or cases.'
      )
    }
    const result = await remote.callTool(name, args)
    if (result?.isError && /only automated/i.test(structureResultText(result))) {
      executionNeedsDeploy = true
      return {
        ...result,
        content: [
          ...(result.content || []),
          {
            type: 'text',
            text: 'The selected cases exist in the Test Plan but are not deployed (not automated). Do NOT re-create modules, suites, or cases — that never fixes this. Merge the tests pull request, run voidr_release_deploy_merged_pr, verify sync with test_plans_get_test_plan and test_plans_get_test_counts, then retry the execution.'
          }
        ]
      }
    }
    return enrichToolResultWithExecutionLinks(
      name,
      args,
      result,
      process.env.VOIDR_PLATFORM_URL
    )
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
    const creationFingerprint = stableStringify(args)
    // A plan already accepted in planning-only mode must not be created twice:
    // the flow continues from it, and its repository comes from
    // test_plans_provision_repository, never from another creation.
    if (automationPendingPlans.size) {
      throw new Error(automationPendingMessage('create another Test Plan'))
    }
    // A provisioning failure is never fixed by mutating parameters. After a
    // failure, only an identical retry (same args) may reach the platform.
    if (planCreationFailed && lastFailedCreateArgs) {
      const same = creationFingerprint === lastFailedCreateArgs
      if (!same) {
        throw new Error(
          'Blocked by Voidr workflow: test_plans_create_test_plan already failed in this session. Changing the name, status, or other parameters never fixes a provisioning failure and can create duplicate plans. Show the user the exact previous error and offer only two options: retry the same creation unchanged, or cancel.'
        )
      }
    }
    // The key identifies one creation intent, not one call: the platform
    // matches it to decide whether to insert or to resume the plan it already
    // holds, so a retry finishes the previous attempt instead of duplicating
    // it. Reused while the arguments are identical, dropped once it succeeds.
    // Only a call that reaches the platform may replace it — a blocked one
    // would otherwise discard the key of the attempt still to be finished.
    if (creationIdempotency?.fingerprint !== creationFingerprint) {
      creationIdempotency = {
        fingerprint: creationFingerprint,
        key: randomUUID()
      }
    }
    let result
    try {
      result = await remote.callTool(name, {
        ...args,
        idempotencyKey: creationIdempotency.key
      })
      const provisioned = validateProvisionedTestPlan(result)
      provisionedTestPlans.add(provisioned.planId)
      selectedTestPlanId = provisioned.planId.toLowerCase()
      planCreationFailed = false
      lastFailedCreateArgs = null
      creationIdempotency = null
    } catch (error) {
      // The plan can be persisted while only its repository fails, and the
      // planning work is still worth keeping. When the plan is really there,
      // the creation counts as done in planning-only mode: the flow continues,
      // provisioning is never retried here, and the tools that need a
      // repository are blocked until it exists.
      const created = await findCreatedTestPlan(error, result, args)
      if (created && !created.hasRepository) {
        automationPendingPlans.set(created.planId, {
          ...created,
          fingerprint: creationFingerprint,
          reason: String(error?.message || error)
        })
        provisionedTestPlans.add(created.planId)
        selectedTestPlanId = created.planId
        planCreationFailed = false
        lastFailedCreateArgs = null
        creationIdempotency = null
        return automationPendingCreationResult(created)
      }
      planCreationFailed = true
      lastFailedCreateArgs = creationFingerprint
      throw error
    }
    return result
  }

  if (STRUCTURE_TOOLS.has(name)) return callStructureTool(name, args)

  const result = await remote.callTool(name, args)
  if (name === 'test_plans_populate_test_plan' && !result?.isError) {
    recordPlanSlugs(bridgeTestPlanId(args), remoteResultData(result))
  }
  return enrichToolResultWithExecutionLinks(
    name,
    args,
    result,
    process.env.VOIDR_PLATFORM_URL
  )
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
  if (!/^[a-f0-9]{24}$/.test(planId)) {
    throw new Error(
      `Blocked by Voidr workflow: ${name} requires planId with the exact _id returned by test_plans_get_test_plan or test_plans_list_test_plans this session. Never pass a plan name instead of the ID.`
    )
  }
  if (executionNeedsDeploy) {
    throw new Error(
      'Blocked by Voidr workflow: the platform already reported that the cases exist but are not automated (not deployed). Creating modules, suites, or cases again will never fix that and duplicates the plan. Merge the tests pull request, run voidr_release_deploy_merged_pr, verify sync, and retry the execution.'
    )
  }
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
  return slimStructureResult(name, planId, args, result)
}

function slimStructureResult(name, planId, args, result) {
  const data = remoteResultData(result)
  const plan = planDocument(data)
  // Creation often answers with the whole updated plan instead of the created
  // entity. Reading the top level then reports the plan's own name and no
  // slug, which sends the model hunting for identifiers the response already
  // carried. Locate the created entity inside the plan instead.
  const created = findCreatedStructureEntity(name, args, plan)
  const entity =
    created ||
    (plan
      ? null
      : data?.data && typeof data.data === 'object' && !Array.isArray(data.data)
        ? data.data
        : data)
  const slug = created
    ? structureSlug(created, args)
    : plan
      ? ''
      : structureSlug(data, args)
  if (!slug && !entity && !plan) return result
  const slim = {
    created: name.replace('test_plans_create_', ''),
    name: entity?.name ?? args?.name ?? null,
    slug: slug || null,
    id: entity?._id || entity?.id || null,
    planId,
    note: `Use exactly this slug for the next structure call: ${slug || 'read the plan with test_plans_get_test_plan'}.`
  }
  return {
    content: [{ type: 'text', text: JSON.stringify(slim) }],
    structuredContent: slim
  }
}

function planDocument(data) {
  const doc =
    data?.data && typeof data.data === 'object' && !Array.isArray(data.data)
      ? data.data
      : data
  return doc && Array.isArray(doc.modules) ? doc : null
}

function findCreatedStructureEntity(toolName, args, plan) {
  if (!plan) return null
  const wanted = String(args?.name || '')
    .trim()
    .toLowerCase()
  if (!wanted) return null
  const byName = list =>
    (Array.isArray(list) ? list : []).find(
      item =>
        String(item?.name || '')
          .trim()
          .toLowerCase() === wanted
    ) || null
  const bySlug = (list, slug) => {
    const wantedSlug = String(slug || '')
      .trim()
      .toLowerCase()
    if (!wantedSlug) return null
    return (
      (Array.isArray(list) ? list : []).find(
        item =>
          String(item?.slug || '')
            .trim()
            .toLowerCase() === wantedSlug
      ) || null
    )
  }

  if (toolName === 'test_plans_create_module') return byName(plan.modules)
  const parentModule = bySlug(plan.modules, args?.moduleSlug)
  if (!parentModule) return null
  if (toolName === 'test_plans_create_suite') return byName(parentModule.suites)
  const parentSuite = bySlug(parentModule.suites, args?.suiteSlug)
  if (!parentSuite) return null
  if (toolName === 'test_plans_create_case') return byName(parentSuite.cases)
  return null
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

  const knownModules = new Set([
    ...(sessionModules.get(planId) || []),
    ...(seenPlanSlugs.get(planId) || [])
  ])
  if (
    (name === 'test_plans_create_suite' || name === 'test_plans_create_case') &&
    moduleSlug &&
    !knownModules.has(moduleSlug.toLowerCase())
  ) {
    throw new Error(
      `Blocked by Voidr workflow: module '${moduleSlug}' was never returned by the platform this session. Create the module first and wait for its response — one structure call at a time, never module and suite in the same batch — or read the plan with test_plans_get_test_plan (by planId) and use the exact slug it returns.${knownStructureHint(planId)}`
    )
  }
  if (name === 'test_plans_create_case' && suiteSlug) {
    const knownSuites = new Set([
      ...(sessionSuites.get(planId)?.get(moduleSlug.toLowerCase()) || []),
      ...(seenPlanSlugs.get(planId) || [])
    ])
    if (!knownSuites.has(suiteSlug.toLowerCase())) {
      throw new Error(
        `Blocked by Voidr workflow: suite '${suiteSlug}' was never returned by the platform this session. Create the suite first (after its module, one call at a time) or read the plan with test_plans_get_test_plan (by planId) and use the exact slug it returns.${knownStructureHint(planId)}`
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

function stableStringify(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return JSON.stringify(value)
  }
  return `{${Object.keys(value)
    .sort()
    .map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(',')}}`
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
  planReadAt = null
  countsReadAt = null
  executionNeedsDeploy = false
  lastFailedCreateArgs = null
  // An orphan belongs to the organization that was selected when it was
  // created, so switching organizations or re-authenticating clears it. The
  // pending creation key is scoped the same way: the platform matches it per
  // organization.
  automationPendingPlans.clear()
  creationIdempotency = null
}

// Every platform identifier used in a mutating or preparing call must have
// been returned by a platform read in this session. Guessing is blocked with
// the exact read tool to call.
// Every tool below needs a checkout that only exists once the plan has a
// linked repository. Blocking them is what keeps planning-only mode honest
// instead of letting the flow strand cases and fail deeper in.
const REPOSITORY_DEPENDENT_TOOLS = new Set([
  'voidr_workspace_prepare_test_repository',
  'voidr_workspace_scaffold_test_cases',
  'voidr_smoke_build',
  'voidr_workspace_publish_tests',
  'voidr_release_deploy_merged_pr',
  'executions_create_execution'
])

function enforceRepositoryAvailability(name, args) {
  if (!automationPendingPlans.size) return
  if (!REPOSITORY_DEPENDENT_TOOLS.has(name)) return
  const requested = bridgeTestPlanId(args).toLowerCase()
  // No plan in the arguments still means this session's plan, which is the
  // pending one.
  if (requested && !automationPendingPlans.has(requested)) return
  throw new Error(automationPendingMessage(name.replace(/_/g, ' ')))
}

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

// A creation that failed may still have persisted the plan. The id can come
// from the platform error or from a response this bridge rejected for lacking
// a repository, and only reading the plan settles whether it exists.
async function findCreatedTestPlan(error, result, args) {
  const planId = (
    planIdFromCreationResult(result) ||
    String(error?.message || error || '').match(/\b[a-f0-9]{24}\b/i)?.[0] ||
    ''
  ).toLowerCase()
  if (!planId) return null
  let existing
  try {
    // Read directly, without the dispatch gates: this is the bridge verifying
    // its own failure, not a model-driven call.
    existing = remoteResultData(
      await remote.callTool('test_plans_get_test_plan', { planId })
    )
  } catch {
    return null
  }
  const plan = existing?.data && !Array.isArray(existing.data) ? existing.data : existing
  const foundId = String(plan?._id || plan?.id || '').toLowerCase()
  if (foundId !== planId) return null
  const applicationId = String(args?.applicationId || '').trim().toLowerCase()
  const planApplicationId = String(plan?.applicationId || '').toLowerCase()
  if (applicationId && planApplicationId && applicationId !== planApplicationId) {
    return null
  }
  return {
    planId,
    name: plan?.name || null,
    hasRepository: Boolean(
      plan?.gitProviderConfig?.repositoryUrl || plan?.repository?.url
    )
  }
}

function planIdFromCreationResult(result) {
  const data = remoteResultData(result)
  const plan = data?.data && !Array.isArray(data.data) ? data.data : data
  const planId = String(plan?._id || plan?.id || '').toLowerCase()
  return /^[a-f0-9]{24}$/.test(planId) ? planId : ''
}

// Planning-only mode: the plan exists and can receive structure, while every
// tool that needs a checkout stays blocked until the repository is linked.
function automationPendingCreationResult(created) {
  const slim = {
    created: 'test_plan',
    planId: created.planId,
    name: created.name,
    repository: null,
    automationPending: true,
    provisioningError: created.reason || null,
    note: `The Test Plan exists and its structure can be written now (populate_test_plan, create_module, create_suite, create_case), but the platform could not provision its repository, so there is no checkout: preparation, scaffold, smoke, publish, deploy, and executions are blocked for this plan. Do not create another plan and do not retry the creation. Tell the user the plan was created without automation, name this plan ID, and say the repository has to be provisioned later with test_plans_provision_repository before the tests can run.`
  }
  return {
    content: [{ type: 'text', text: JSON.stringify(slim) }],
    structuredContent: slim
  }
}

function automationPendingMessage(attempt) {
  const [pending] = [...automationPendingPlans.values()]
  const named = pending?.name ? ` named “${pending.name}”` : ''
  return `Blocked by Voidr workflow: Test Plan ${pending?.planId}${named} was created in this session without a linked repository, so it cannot ${attempt}. Provision it with test_plans_provision_repository first — that finishes this exact plan without creating another one — or tell the user the automation stays pending. Never create a second plan and never retry the creation.`
}

// A repository is only usable when the platform returns every field the
// preparation gate needs, so a partial link never counts as provisioned.
function hasLinkedRepository(repository) {
  if (!repository || typeof repository !== 'object') return false
  return ['url', 'owner', 'name', 'defaultBranch'].every(key =>
    String(repository[key] || '').trim()
  )
}

function validateProvisionedTestPlan(result) {
  if (result?.isError) {
    const platformError = structureResultText(result).slice(-400).trim()
    throw new Error(
      `Voidr did not create the Test Plan and linked repository. Platform error: ${platformError || 'no detail returned'}. Population remains blocked. Show the user this exact error and offer only retry (unchanged) or cancel; never change the plan name or parameters.`
    )
  }
  const data = remoteResultData(result)
  const repository = data?.repository
  const planId = String(data?._id || data?.testPlanId || data?.id || '').trim()
  if (!planId || !hasLinkedRepository(repository)) {
    throw new Error(
      'Incomplete Voidr creation response: the Test Plan is not usable until the server returns its ID and a linked repository with URL, owner, name, and default branch. populate_test_plan was blocked.'
    )
  }
  return { planId, repository }
}

const TEST_PLAN_SUMMARY_KEYS = [
  '_id',
  'id',
  'applicationId',
  'name',
  'slug',
  'status',
  'version',
  'createdAt',
  'updatedAt',
  'totalCases',
  'automatedCases',
  'testCount',
  'testCounts'
]

function slimTestPlanListing(result) {
  if (!result || result.isError) return result
  const data = remoteResultData(result)
  let container = null
  if (Array.isArray(data)) container = { data }
  else if (Array.isArray(data?.data)) container = data
  else if (Array.isArray(data?.data?.data)) container = data.data
  if (!container) return result

  const pagination = Object.fromEntries(
    Object.entries(container).filter(([key]) => key !== 'data')
  )
  const slim = {
    data: {
      ...pagination,
      data: container.data.map(plan => {
        if (!plan || typeof plan !== 'object') return plan
        return Object.fromEntries(
          TEST_PLAN_SUMMARY_KEYS.filter(key => key in plan).map(key => [
            key,
            plan[key]
          ])
        )
      })
    },
    note:
      'Summary listing: every returned plan is included. Read one plan with test_plans_get_test_plan for its full content.'
  }
  return {
    content: [{ type: 'text', text: JSON.stringify(slim) }],
    structuredContent: slim
  }
}

const DOCUMENT_PREVIEW_MAX_LENGTH = 2000
const DOCUMENT_SEARCH_PREVIEW_BUDGET = 24000

function slimDocumentSearchResult(result, argumentNotes = []) {
  // Errors carry the platform's own message and must reach the caller intact.
  if (!result || result.isError) return result
  const payload = documentSearchPayload(result)
  // Never fall back to the raw response on an unexpected shape: that is the
  // one path where full document bodies and signed download URLs would reach
  // the model. Withhold the payload and say so instead.
  if (!payload) {
    return documentSearchEnvelope(
      {
        results: [],
        total: null
      },
      [
        ...argumentNotes,
        'The platform returned a document search response in an unrecognized shape, so it was withheld instead of forwarded unprojected. Continue as if no documentation was indexed and report this mismatch.'
      ]
    )
  }

  const files = []
  const chunkRefs = []
  const seenChunks = new Set()
  let skippedFiles = 0
  for (const file of payload.results) {
    if (!file || typeof file !== 'object') {
      skippedFiles += 1
      continue
    }
    const slimFile = {
      fileId: file.fileId,
      fileName: file.fileName,
      bestScore: file.bestScore,
      chunks: []
    }
    for (const chunk of Array.isArray(file.chunks) ? file.chunks : []) {
      if (!chunk || typeof chunk !== 'object') continue
      const key = `${file.fileId}|${chunk.chunkIndex}`
      if (seenChunks.has(key)) continue
      seenChunks.add(key)
      let contentPreview =
        typeof chunk.contentPreview === 'string' ? chunk.contentPreview : ''
      if (contentPreview.length > DOCUMENT_PREVIEW_MAX_LENGTH) {
        // The ellipsis counts against the declared maximum.
        contentPreview = `${contentPreview.slice(0, DOCUMENT_PREVIEW_MAX_LENGTH - 1)}…`
      }
      const slimChunk = {
        chunkIndex: chunk.chunkIndex,
        pageNumber: chunk.pageNumber,
        score: chunk.score,
        contentPreview
      }
      slimFile.chunks.push(slimChunk)
      chunkRefs.push({ file: slimFile, chunk: slimChunk })
    }
    files.push(slimFile)
  }

  let previewLength = chunkRefs.reduce(
    (sum, ref) => sum + ref.chunk.contentPreview.length,
    0
  )
  let omitted = 0
  const byScoreAscending = [...chunkRefs].sort(
    (a, b) => (a.chunk.score ?? 0) - (b.chunk.score ?? 0)
  )
  for (const ref of byScoreAscending) {
    if (previewLength <= DOCUMENT_SEARCH_PREVIEW_BUDGET) break
    previewLength -= ref.chunk.contentPreview.length
    ref.file.chunks = ref.file.chunks.filter(chunk => chunk !== ref.chunk)
    omitted += 1
  }

  return documentSearchEnvelope(
    {
      results: files,
      total: typeof payload.total === 'number' ? payload.total : null
    },
    [
      ...argumentNotes,
      'Slim document search result: fileId, fileName, pageNumber, chunkIndex, and score are the provenance fields.',
      ...(omitted
        ? [`${omitted} lowest-score chunk(s) omitted to keep the response small.`]
        : []),
      ...(skippedFiles
        ? [
            `${skippedFiles} malformed result entry(ies) were dropped instead of forwarded unprojected.`
          ]
        : [])
    ]
  )
}

function documentSearchEnvelope(body, notes) {
  const slim = { ...body, note: notes.filter(Boolean).join(' ') }
  return {
    content: [{ type: 'text', text: JSON.stringify(slim) }],
    structuredContent: slim
  }
}

function documentSearchPayload(result) {
  if (Array.isArray(result?.structuredContent?.results)) {
    return result.structuredContent
  }
  const data = remoteResultData(result)
  if (Array.isArray(data?.results)) return data
  return null
}

const DOCUMENT_SEARCH_MAX_LIMIT = 5
const DOCUMENT_SEARCH_MIN_SCORE = 0.5

// The skills document one exact call shape. Forward only that shape, so a
// missing scope or an out-of-contract argument cannot widen the search past
// the size and content mode the flows were reviewed against.
function normalizeDocumentSearchArgs(args) {
  const applicationId = String(args?.applicationId || '').trim()
  if (!/^[a-f0-9]{24}$/i.test(applicationId)) {
    throw new Error(
      'Blocked by Voidr workflow: file_embeddings_search_documents requires the selected applicationId exactly as the platform returned it. Select the application with applications_list_applications first, then search only that application’s documents.'
    )
  }
  const query = String(args?.query || '').trim()
  if (!query) {
    throw new Error(
      'Blocked by Voidr workflow: file_embeddings_search_documents requires a query built from the feature and scenarios. Never search with an empty query.'
    )
  }

  const notes = []
  const requestedLimit = Number(args?.limit)
  let limit = DOCUMENT_SEARCH_MAX_LIMIT
  if (Number.isFinite(requestedLimit) && requestedLimit >= 1) {
    limit = Math.min(Math.floor(requestedLimit), DOCUMENT_SEARCH_MAX_LIMIT)
  }
  if (Number.isFinite(requestedLimit) && limit !== Math.floor(requestedLimit)) {
    notes.push(
      `limit ${Math.floor(requestedLimit)} was reduced to ${limit}, the documented maximum.`
    )
  }

  const requestedMinScore = Number(args?.minScore)
  let minScore = DOCUMENT_SEARCH_MIN_SCORE
  if (Number.isFinite(requestedMinScore)) {
    minScore = Math.min(Math.max(requestedMinScore, DOCUMENT_SEARCH_MIN_SCORE), 1)
    if (minScore !== requestedMinScore) {
      notes.push(
        `minScore ${requestedMinScore} was raised to ${minScore}, the documented floor.`
      )
    }
  }

  if (args?.includeContent === false) {
    notes.push('includeContent was forced to true; the flows read chunk previews.')
  }

  const forwarded = new Set([
    'applicationId',
    'query',
    'limit',
    'minScore',
    'includeContent'
  ])
  const dropped = Object.keys(args || {}).filter(key => !forwarded.has(key))
  if (dropped.length) {
    notes.push(`Unsupported argument(s) dropped: ${dropped.join(', ')}.`)
  }

  return {
    args: { applicationId, query, limit, minScore, includeContent: true },
    notes
  }
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
    case 'voidr_context_bootstrap': {
      // The internal platform reads feed the same provenance state as if the
      // model had called them, so downstream tools see a consistent session.
      const callRemote = async (remoteName, remoteArgs) => {
        const result = await remote.callTool(remoteName, remoteArgs)
        recordProvenance(remoteName, remoteArgs, result)
        recordPlanSlugs(
          bridgeTestPlanId(remoteArgs),
          remoteResultData(result)
        )
        return result
      }
      const bootstrapped = await contextBootstrap({
        planId: String(args.planId || ''),
        environmentSlug: args.environmentSlug
          ? String(args.environmentSlug)
          : undefined,
        workspaceRoot: args.workspaceRoot
          ? String(args.workspaceRoot)
          : undefined,
        callRemote
      })
      if (bootstrapped?.prepared?.repositoryPath) {
        preparedRepositoryPath = bootstrapped.prepared.repositoryPath
      }
      return textResult(bootstrapped)
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
          baseUrl: String(args.baseUrl || ''),
          mode: args.mode === 'exploration' ? 'exploration' : 'validation'
        })
      )
    case 'voidr_workspace_git_context':
      return textResult(
        await collectGitContext({
          workspaceRoot: args.workspaceRoot
            ? String(args.workspaceRoot)
            : undefined,
          repositoryPath: args.repositoryPath
            ? String(args.repositoryPath)
            : undefined
        })
      )
    case 'voidr_release_inspect':
      return textResult(
        await inspectReleaseReadiness({
          repositoryPath: String(args.repositoryPath || ''),
          workspaceRoot: args.workspaceRoot
            ? String(args.workspaceRoot)
            : undefined
        })
      )
    case 'voidr_workspace_publish_tests':
      return textResult(
        await publishTests({
          repositoryPath: String(args.repositoryPath || ''),
          repositoryUrl: String(args.repositoryUrl || ''),
          branch: String(args.branch || ''),
          commitMessage: String(args.commitMessage || ''),
          pullRequestTitle: args.pullRequestTitle
            ? String(args.pullRequestTitle)
            : undefined,
          pullRequestBody: args.pullRequestBody
            ? String(args.pullRequestBody)
            : undefined,
          createPullRequest: args.createPullRequest !== false
        })
      )
    case 'voidr_release_deploy_merged_pr': {
      const deployed = await deployMergedPullRequest({
        repositoryPath: String(args.repositoryPath || ''),
        repositoryUrl: String(args.repositoryUrl || ''),
        pullRequestNumber: Number(args.pullRequestNumber),
        testPlanId: String(args.testPlanId || '')
      })
      if (deployed?.completed) executionNeedsDeploy = false
      return textResult(deployed)
    }
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
