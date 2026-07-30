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
  inspectWorkspace,
  validateRepositorySelection
} from './lib/workspace.mjs'
import { deployMergedPullRequest } from './lib/release-deploy.mjs'
import { connectWithBrowser } from './lib/browser-auth.mjs'
import {
  buildTestRepository,
  scaffoldTestCases
} from './lib/scaffold.mjs'

const policy = loadPolicy()
const safeRemote = new Set(policy.safeRemoteTools)
const localNames = new Set(policy.localTools)
const remote = new RemoteMcpClient()
const provisionedTestPlans = new Set()
let negotiatedProtocol = '2024-11-05'

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
      'List likely repositories in the current workspace without selecting or modifying any of them.',
    inputSchema: {
      type: 'object',
      properties: {
        maxDepth: {
          type: 'number',
          minimum: 1,
          maximum: 4,
          default: 2
        }
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
        }
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
      'Validate and record the test repository explicitly selected by the user. This never infers a plan from project.json.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' }
      },
      required: ['path']
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
      required: ['repositoryPath', 'testPlanId', 'cases']
    }
  },
  {
    name: 'voidr_workspace_build_test_repository',
    description:
      'Build the explicitly selected Voidr test repository while injecting the selected Service Account and the plugin environment without exposing credentials.',
    inputSchema: {
      type: 'object',
      properties: {
        repositoryPath: { type: 'string' },
        testPlanId: {
          type: 'string',
          pattern: '^[a-fA-F0-9]{24}$'
        }
      },
      required: ['repositoryPath', 'testPlanId']
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
        pullRequestNumber: { type: 'integer', minimum: 1 },
        testPlanId: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' }
      },
      required: ['repositoryPath', 'pullRequestNumber', 'testPlanId']
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
          version: '0.2.19'
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

  if (isWriteTool(name) && !authStatus().canWrite) {
    throw new Error(
      'The selected Voidr Service Account does not declare the write scope. Platform mutation was blocked.'
    )
  }

  if (localNames.has(name)) return callLocal(name, args)
  if (!safeRemote.has(name)) {
    throw new Error(`Tool ${rawName} is not allowed by the Voidr plugin policy.`)
  }

  if (name === 'test_plans_populate_test_plan') {
    const planId = String(args.planId || '').trim()
    if (!planId || !provisionedTestPlans.has(planId)) {
      throw new Error(
        'Blocked by Voidr workflow: populate_test_plan requires a successful create_test_plan response in this session containing the linked repository URL, owner, name, and default branch.'
      )
    }
  }

  const result = await remote.callTool(name, args)
  if (name === 'test_plans_create_test_plan') {
    const provisioned = validateProvisionedTestPlan(result)
    provisionedTestPlans.add(provisioned.planId)
  }
  return result
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
      remote.reset()
      announceToolsChanged()
      return textResult(imported)
    }
    case 'voidr_workspace_inspect':
      return textResult(
        inspectWorkspace(
          process.env.VOIDR_WORKSPACE_ROOT || process.cwd(),
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
          workspaceRoot: process.env.VOIDR_WORKSPACE_ROOT || process.cwd()
        })
      )
    case 'voidr_workspace_select_test_repository':
      return textResult(
        validateRepositorySelection(
          String(args.path || ''),
          process.env.VOIDR_WORKSPACE_ROOT || process.cwd()
        )
      )
    case 'voidr_workspace_scaffold_test_cases':
      return textResult(
        await scaffoldTestCases({
          repositoryPath: String(args.repositoryPath || ''),
          testPlanId: String(args.testPlanId || ''),
          cases: Array.isArray(args.cases) ? args.cases : [],
          workspaceRoot: process.env.VOIDR_WORKSPACE_ROOT || process.cwd()
        })
      )
    case 'voidr_workspace_build_test_repository':
      return textResult(
        await buildTestRepository({
          repositoryPath: String(args.repositoryPath || ''),
          testPlanId: String(args.testPlanId || ''),
          workspaceRoot: process.env.VOIDR_WORKSPACE_ROOT || process.cwd()
        })
      )
    case 'voidr_release_deploy_merged_pr':
      return textResult(
        await deployMergedPullRequest({
          repositoryPath: String(args.repositoryPath || ''),
          pullRequestNumber: Number(args.pullRequestNumber),
          testPlanId: String(args.testPlanId || ''),
          workspaceRoot: process.env.VOIDR_WORKSPACE_ROOT || process.cwd()
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
