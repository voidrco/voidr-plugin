import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { once } from 'node:events'

const root = resolve(import.meta.dirname, '../..')
const bridgePath = join(root, 'scripts/voidr-mcp-bridge.mjs')

test('bridge filters discovery, keeps secrets local, and blocks forbidden calls', async t => {
  const received = []
  const syntheticClientId = 'sa_e2e_synthetic_client'
  const syntheticSecret = 'synthetic-bridge-secret'
  const secondClientId = 'sa_e2e_second_client'
  const secondSecret = 'synthetic-second-bridge-secret'

  const server = createServer(async (request, response) => {
    const body = await readBody(request)
    const message = JSON.parse(body)
    if (request.url === '/token') {
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({
          access_token: jwt({
            organizationId:
              message.clientId === secondClientId ? 'org-second' : 'org-e2e',
            scopes: ['read', 'write']
          })
        })
      )
      return
    }
    received.push({
      method: message.method,
      tool: message.params?.name || null,
      authorization: request.headers.authorization
    })

    if (message.method === 'notifications/initialized') {
      response.writeHead(202)
      response.end()
      return
    }

    response.setHeader('content-type', 'application/json')
    response.setHeader('mcp-session-id', 'synthetic-session')
    if (message.method === 'initialize') {
      sendResult(response, message.id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'mock-voidr', version: '1.0.0' }
      })
      return
    }
    if (message.method === 'tools/list') {
      sendResult(response, message.id, {
        tools: [
          toolDefinition('applications_list_applications'),
          toolDefinition('test_plans_list_test_plans'),
          toolDefinition('test_plans_get_test_plan'),
          toolDefinition('test_plans_create_test_plan'),
          toolDefinition('test_plans_populate_test_plan'),
          toolDefinition('executions_create_execution'),
          toolDefinition('playwright_get_test_timeline'),
          toolDefinition('agent_jobs_trigger_hive_automation'),
          toolDefinition('system_batch_execute')
        ]
      })
      return
    }
    if (message.method === 'tools/call') {
      const data =
        message.params.name === 'test_plans_create_test_plan'
          ? {
              _id: '0123456789abcdef01234567',
              repository: {
                url: 'https://github.com/voidrco/voidr-tp-e2e',
                owner: 'voidrco',
                name: 'voidr-tp-e2e',
                defaultBranch: 'main'
              }
            }
          : { called: message.params.name }
      sendResult(response, message.id, {
        structuredContent: { data },
        content: [
          {
            type: 'text',
            text: JSON.stringify(data)
          }
        ]
      })
      return
    }
    response.writeHead(400)
    response.end()
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => server.close())
  const address = server.address()

  const temp = mkdtempSync(join(tmpdir(), 'voidr-bridge-e2e-'))
  const storePath = join(temp, 'service-accounts.json')
  writeFileSync(
    storePath,
    JSON.stringify({
      activeOrgId: 'org-e2e',
      accounts: {
        'org-e2e': {
          clientId: syntheticClientId,
          clientSecret: syntheticSecret,
          orgName: 'E2E Organization',
          scopes: ['read', 'write']
        },
        'org-second': {
          clientId: secondClientId,
          clientSecret: secondSecret,
          orgName: 'Second Organization',
          scopes: ['read', 'write']
        }
      }
    })
  )

  const child = spawn(process.execPath, [bridgePath], {
    cwd: temp,
    env: {
      ...process.env,
      VOIDR_SERVICE_ACCOUNTS_PATH: storePath,
      VOIDR_MCP_URL: `http://127.0.0.1:${address.port}/mcp`,
      VOIDR_MCP_ORIGIN: 'https://example.test',
      VOIDR_TOKEN_URL: `http://127.0.0.1:${address.port}/token`
    },
    stdio: ['pipe', 'pipe', 'pipe']
  })
  t.after(() => child.kill())
  const client = jsonRpcClient(child)

  const initialized = await client.request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'e2e', version: '1.0.0' }
  })
  assert.equal(initialized.serverInfo.name, 'voidr-safe-bridge')
  assert.equal(initialized.capabilities.tools.listChanged, true)

  const listed = await client.request('tools/list', {})
  const names = listed.tools.map(tool => tool.name)
  assert.equal(names.includes('applications_list_applications'), true)
  assert.equal(names.includes('test_plans_create_test_plan'), true)
  assert.equal(names.includes('voidr_auth_status'), true)
  assert.equal(names.includes('voidr_auth_login'), true)
  assert.equal(
    names.includes('voidr_workspace_prepare_test_repository'),
    true
  )
  assert.equal(names.includes('voidr_auth_prepare_service_account'), false)
  assert.equal(names.includes('voidr_auth_import_service_account'), false)
  assert.equal(names.includes('agent_jobs_trigger_hive_automation'), false)
  assert.equal(names.includes('system_batch_execute'), false)

  const status = await client.request('tools/call', {
    name: 'voidr_auth_status',
    arguments: {}
  })
  const statusText = status.content[0].text
  assert.equal(statusText.includes(syntheticSecret), false)
  assert.equal(JSON.parse(statusText).canWrite, true)

  const selectedPlanId = '0123456789abcdef01234567'
  const selectedPlan = await client.request('tools/call', {
    name: 'test_plans_get_test_plan',
    arguments: { testPlanId: selectedPlanId }
  })
  assert.match(selectedPlan.content[0].text, /test_plans_get_test_plan/)

  const blockedPlanList = await client.requestRaw('tools/call', {
    name: 'test_plans_list_test_plans',
    arguments: { applicationId: 'app-e2e' }
  })
  assert.match(blockedPlanList.error.message, /silently substitute/i)
  assert.equal(
    received.some(item => item.tool === 'test_plans_list_test_plans'),
    false
  )

  const blockedPlanSwap = await client.requestRaw('tools/call', {
    name: 'test_plans_get_test_plan',
    arguments: { testPlanId: 'fedcba987654321001234567' }
  })
  assert.match(blockedPlanSwap.error.message, /Do not substitute/i)

  const newRepository = join(temp, 'new-test-repository')
  const bootstrapped = await client.request('tools/call', {
    name: 'voidr_workspace_bootstrap_test_repository',
    arguments: {
      path: newRepository,
      name: 'New Test Repository',
      organizationId: 'org-e2e',
      applicationId: 'app-e2e',
      testPlanId: '0123456789abcdef01234567'
    }
  })
  assert.equal(JSON.parse(bootstrapped.content[0].text).created, true)
  assert.equal(existsSync(join(newRepository, 'package.json')), true)
  assert.deepEqual(
    JSON.parse(readFileSync(join(newRepository, 'project.json'), 'utf8')),
    {
      orgId: 'org-e2e',
      appId: 'app-e2e',
      testPlanId: '0123456789abcdef01234567'
    }
  )

  const blockedPopulation = await client.requestRaw('tools/call', {
    name: 'test_plans_populate_test_plan',
    arguments: {
      planId: '0123456789abcdef01234567',
      modules: [{ name: 'Login', severity: 'HIGH' }]
    }
  })
  assert.match(blockedPopulation.error.message, /successful create_test_plan response/i)
  assert.equal(
    received.some(item => item.tool === 'test_plans_populate_test_plan'),
    false
  )

  const blockedUnlistedCreate = await client.requestRaw('tools/call', {
    name: 'test_plans_create_test_plan',
    arguments: { applicationId: 'app-e2e', name: 'E2E Plan' }
  })
  assert.match(
    blockedUnlistedCreate.error.message,
    /applications_list_applications/i
  )

  await client.request('tools/call', {
    name: 'applications_list_applications',
    arguments: {}
  })

  const safeCall = await client.request('tools/call', {
    name: 'test_plans_create_test_plan',
    arguments: { applicationId: 'app-e2e', name: 'E2E Plan' }
  })
  assert.match(safeCall.content[0].text, /voidr-tp-e2e/)

  const populated = await client.request('tools/call', {
    name: 'test_plans_populate_test_plan',
    arguments: {
      planId: '0123456789abcdef01234567',
      modules: [{ name: 'Login', severity: 'HIGH' }]
    }
  })
  assert.match(populated.content[0].text, /test_plans_populate_test_plan/)

  const executionId = '6a6a839850a27b89d2d7df2b'
  const evidenceCall = await client.request('tools/call', {
    name: 'playwright_get_test_timeline',
    arguments: { executionId, testCaseSlug: 'POLAR-182' }
  })
  const evidenceMetadata = JSON.parse(evidenceCall.content.at(-1).text)
  assert.equal(
    evidenceMetadata.executionEvidence[0].executionUrl,
    `https://platform.voidr.co/execution/${executionId}`
  )

  const forbidden = await client.requestRaw('tools/call', {
    name: 'agent_jobs_trigger_hive_automation',
    arguments: { applicationId: 'app-e2e' }
  })
  assert.match(forbidden.error.message, /not allowed/i)
  assert.equal(
    received.some(item => item.tool === 'agent_jobs_trigger_hive_automation'),
    false
  )

  await client.request('tools/call', {
    name: 'voidr_auth_select_organization',
    arguments: { organizationId: 'org-second' }
  })
  const toolsChanged = await client.waitForNotification(
    'notifications/tools/list_changed'
  )
  assert.equal(toolsChanged.method, 'notifications/tools/list_changed')
  await client.request('tools/call', {
    name: 'applications_list_applications',
    arguments: {}
  })

  const expectedHeader = `Basic ${Buffer.from(
    `${syntheticClientId}:${syntheticSecret}`
  ).toString('base64')}`
  const secondHeader = `Basic ${Buffer.from(
    `${secondClientId}:${secondSecret}`
  ).toString('base64')}`
  assert.equal(
    received.some(item => item.authorization === expectedHeader),
    true
  )
  assert.equal(received.at(-1).authorization, secondHeader)
  assert.equal(
    received.filter(item => item.method === 'initialize').length,
    2,
    'organization switch must create a fresh remote MCP session'
  )
  assert.equal(client.stdoutText().includes(syntheticSecret), false)
  assert.equal(client.stdoutText().includes(secondSecret), false)
  assert.equal(client.stderrText().includes(syntheticSecret), false)
  assert.equal(client.stderrText().includes(secondSecret), false)
})

test('bridge blocks Test Plan listing after a failed creation instead of a silent fallback', async t => {
  const receivedTools = []
  const server = createServer(async (request, response) => {
    const message = JSON.parse(await readBody(request))
    if (message.params?.name) receivedTools.push(message.params.name)
    response.setHeader('content-type', 'application/json')
    response.setHeader('mcp-session-id', 'synthetic-session')
    if (message.method === 'notifications/initialized') {
      response.writeHead(202)
      response.end()
    } else if (message.method === 'initialize') {
      sendResult(response, message.id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'mock', version: '1' }
      })
    } else if (message.method === 'tools/call') {
      if (message.params.name === 'applications_list_applications') {
        sendResult(response, message.id, {
          structuredContent: { data: { called: message.params.name } },
          content: [
            { type: 'text', text: JSON.stringify({ called: message.params.name }) }
          ]
        })
        return
      }
      // Creation "succeeds" at the HTTP layer but omits the provisioned
      // repository, which the bridge treats as a failed creation.
      sendResult(response, message.id, {
        structuredContent: { data: { _id: '0123456789abcdef01234567' } },
        content: [
          { type: 'text', text: JSON.stringify({ _id: '0123456789abcdef01234567' }) }
        ]
      })
    } else {
      sendResult(response, message.id, { tools: [] })
    }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => server.close())

  const temp = mkdtempSync(join(tmpdir(), 'voidr-bridge-create-failure-'))
  const storePath = join(temp, 'service-accounts.json')
  writeFileSync(
    storePath,
    JSON.stringify({
      activeOrgId: 'org-create',
      accounts: {
        'org-create': {
          clientId: 'sa_create_e2e',
          clientSecret: 'synthetic-create-secret',
          scopes: ['read', 'write']
        }
      }
    })
  )
  const child = spawn(process.execPath, [bridgePath], {
    cwd: temp,
    env: {
      ...process.env,
      VOIDR_SERVICE_ACCOUNTS_PATH: storePath,
      VOIDR_MCP_URL: `http://127.0.0.1:${server.address().port}/mcp`
    },
    stdio: ['pipe', 'pipe', 'pipe']
  })
  t.after(() => child.kill())
  const client = jsonRpcClient(child)

  await client.request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'e2e', version: '1' }
  })

  await client.request('tools/call', {
    name: 'applications_list_applications',
    arguments: {}
  })

  const failedCreate = await client.requestRaw('tools/call', {
    name: 'test_plans_create_test_plan',
    arguments: { applicationId: 'app-create', name: 'New Plan' }
  })
  assert.match(
    failedCreate.error.message,
    /Incomplete Voidr creation response/i
  )

  const blockedList = await client.requestRaw('tools/call', {
    name: 'test_plans_list_test_plans',
    arguments: { applicationId: 'app-create' }
  })
  assert.match(blockedList.error.message, /retry or cancel/i)
  assert.equal(
    receivedTools.includes('test_plans_list_test_plans'),
    false,
    'the failed-creation fallback must be blocked before any network call'
  )

  const mutatedRetry = await client.requestRaw('tools/call', {
    name: 'test_plans_create_test_plan',
    arguments: {
      applicationId: 'app-create',
      name: 'New Plan — Retry',
      status: 'DRAFT'
    }
  })
  assert.match(
    mutatedRetry.error.message,
    /never fixes a provisioning failure/i
  )
  assert.equal(
    receivedTools.filter(name => name === 'test_plans_create_test_plan').length,
    1,
    'a parameter-mutating retry must be blocked before the network'
  )

  const retriedCreate = await client.requestRaw('tools/call', {
    name: 'test_plans_create_test_plan',
    arguments: { applicationId: 'app-create', name: 'New Plan' }
  })
  assert.match(
    retriedCreate.error.message,
    /Incomplete Voidr creation response/i
  )
  assert.equal(
    receivedTools.filter(name => name === 'test_plans_create_test_plan').length,
    2,
    'an explicit retry of the same creation remains possible'
  )
})

test('bridge blocks invented module/suite slugs and not-found retries', async t => {
  const receivedCalls = []
  const server = createServer(async (request, response) => {
    const message = JSON.parse(await readBody(request))
    response.setHeader('content-type', 'application/json')
    response.setHeader('mcp-session-id', 'synthetic-session')
    if (message.method === 'notifications/initialized') {
      response.writeHead(202)
      response.end()
      return
    }
    if (message.method === 'initialize') {
      sendResult(response, message.id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'mock', version: '1' }
      })
      return
    }
    if (message.method === 'tools/call') {
      const { name, arguments: args } = message.params
      receivedCalls.push({ name, args })
      if (name === 'test_plans_create_module') {
        sendResult(response, message.id, {
          structuredContent: { data: { slug: 'antecipacao' } },
          content: [{ type: 'text', text: JSON.stringify({ slug: 'antecipacao' }) }]
        })
        return
      }
      if (name === 'test_plans_create_suite') {
        sendResult(response, message.id, {
          structuredContent: { data: { slug: 'solicitacao-acima-limite' } },
          content: [
            {
              type: 'text',
              text: JSON.stringify({ slug: 'solicitacao-acima-limite' })
            }
          ]
        })
        return
      }
      if (name === 'test_plans_create_case') {
        if (args.moduleSlug === 'legacy') {
          sendResult(response, message.id, {
            isError: true,
            content: [
              {
                type: 'text',
                text: `Error executing test_plans_create_case: Suite with identifier '${args.suiteSlug}' not found`
              }
            ]
          })
          return
        }
        sendResult(response, message.id, {
          structuredContent: { data: { slug: 'case-1' } },
          content: [{ type: 'text', text: JSON.stringify({ slug: 'case-1' }) }]
        })
        return
      }
      sendResult(response, message.id, { content: [] })
      return
    }
    sendResult(response, message.id, { tools: [] })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => server.close())

  const temp = mkdtempSync(join(tmpdir(), 'voidr-bridge-structure-'))
  const storePath = join(temp, 'service-accounts.json')
  writeFileSync(
    storePath,
    JSON.stringify({
      activeOrgId: 'org-structure',
      accounts: {
        'org-structure': {
          clientId: 'sa_structure_e2e',
          clientSecret: 'synthetic-structure-secret',
          scopes: ['read', 'write']
        }
      }
    })
  )
  const child = spawn(process.execPath, [bridgePath], {
    cwd: temp,
    env: {
      ...process.env,
      VOIDR_SERVICE_ACCOUNTS_PATH: storePath,
      VOIDR_MCP_URL: `http://127.0.0.1:${server.address().port}/mcp`
    },
    stdio: ['pipe', 'pipe', 'pipe']
  })
  t.after(() => child.kill())
  const client = jsonRpcClient(child)
  await client.request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'e2e', version: '1' }
  })

  const planId = '6a5303e59a93b9f0daef3a53'
  await client.request('tools/call', {
    name: 'test_plans_create_module',
    arguments: { planId, name: 'Antecipação' }
  })
  await client.request('tools/call', {
    name: 'test_plans_create_suite',
    arguments: { planId, moduleSlug: 'antecipacao', name: 'Solicitação acima do limite' }
  })

  const invented = await client.requestRaw('tools/call', {
    name: 'test_plans_create_case',
    arguments: { planId, moduleSlug: 'antecipacao', suiteSlug: 'LIMITE', name: 'Caso' }
  })
  assert.match(invented.error.message, /never created in module/i)
  assert.match(invented.error.message, /solicitacao-acima-limite/)
  assert.equal(
    receivedCalls.filter(call => call.name === 'test_plans_create_case').length,
    0,
    'the invented suite slug must be blocked before any network call'
  )

  const validCase = await client.request('tools/call', {
    name: 'test_plans_create_case',
    arguments: {
      planId,
      moduleSlug: 'antecipacao',
      suiteSlug: 'solicitacao-acima-limite',
      name: 'Caso'
    }
  })
  assert.match(validCase.content[0].text, /case-1/)

  const legacyMiss = await client.request('tools/call', {
    name: 'test_plans_create_case',
    arguments: { planId, moduleSlug: 'legacy', suiteSlug: 'GHOST', name: 'Caso' }
  })
  assert.equal(legacyMiss.isError, true)
  assert.match(
    structureText(legacyMiss),
    /Do not retry the same identifier/i
  )

  const blockedRetry = await client.requestRaw('tools/call', {
    name: 'test_plans_create_case',
    arguments: { planId, moduleSlug: 'legacy', suiteSlug: 'GHOST', name: 'Caso 2' }
  })
  assert.match(blockedRetry.error.message, /already failed with not-found/i)
  assert.equal(
    receivedCalls.filter(call => call.args?.suiteSlug === 'GHOST').length,
    1,
    'a not-found identifier must not be retried against the network'
  )
})

function structureText(result) {
  return (result.content || [])
    .filter(item => item?.type === 'text')
    .map(item => item.text)
    .join('\n')
}

test('bridge blocks platform data that was never returned by a tool this session', async t => {
  const server = createServer(async (request, response) => {
    const message = JSON.parse(await readBody(request))
    response.setHeader('content-type', 'application/json')
    response.setHeader('mcp-session-id', 'synthetic-session')
    if (message.method === 'notifications/initialized') {
      response.writeHead(202)
      response.end()
      return
    }
    if (message.method === 'initialize') {
      sendResult(response, message.id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'mock', version: '1' }
      })
      return
    }
    if (message.method === 'tools/call') {
      const { name } = message.params
      if (name === 'executions_create_execution') {
        sendResult(response, message.id, {
          isError: true,
          content: [
            {
              type: 'text',
              text: 'Error executing executions_create_execution: Only automated test cases can be executed'
            }
          ]
        })
        return
      }
      const data =
        name === 'applications_list_applications'
          ? { applications: [{ _id: '6a5113d133cfac0a5ec0fd7b', name: 'Portal' }] }
          : name === 'applications_list_environments'
            ? { environments: [{ slug: 'producao', applicationUrl: 'https://portal.example.test' }] }
            : name === 'test_plans_get_test_plan'
              ? {
                  _id: '6a5303e59a93b9f0daef3a53',
                  modules: [
                    {
                      slug: 'recarga',
                      suites: [
                        { slug: 'compra', cases: [{ slug: 'recarga-01' }] }
                      ]
                    }
                  ]
                }
              : { called: name }
      sendResult(response, message.id, {
        structuredContent: { data },
        content: [{ type: 'text', text: JSON.stringify(data) }]
      })
      return
    }
    sendResult(response, message.id, { tools: [] })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => server.close())

  const temp = mkdtempSync(join(tmpdir(), 'voidr-bridge-provenance-'))
  const storePath = join(temp, 'service-accounts.json')
  writeFileSync(
    storePath,
    JSON.stringify({
      activeOrgId: 'org-prov',
      accounts: {
        'org-prov': {
          clientId: 'sa_provenance_e2e',
          clientSecret: 'synthetic-provenance-secret',
          scopes: ['read', 'write']
        }
      }
    })
  )
  const child = spawn(process.execPath, [bridgePath], {
    cwd: temp,
    env: {
      ...process.env,
      VOIDR_SERVICE_ACCOUNTS_PATH: storePath,
      VOIDR_MCP_URL: `http://127.0.0.1:${server.address().port}/mcp`
    },
    stdio: ['pipe', 'pipe', 'pipe']
  })
  t.after(() => child.kill())
  const client = jsonRpcClient(child)
  await client.request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'e2e', version: '1' }
  })

  const applicationId = '6a5113d133cfac0a5ec0fd7b'
  const planId = '6a5303e59a93b9f0daef3a53'
  const prepareBase = {
    repositoryPath: join(temp, 'tests'),
    organizationId: 'org-prov',
    testPlanId: planId,
    repositoryUrl: 'https://github.com/voidrco/voidr-tp-prov.git',
    workspaceRoot: temp
  }

  const beforeListing = await client.requestRaw('tools/call', {
    name: 'test_plans_create_test_plan',
    arguments: { applicationId, name: 'Plano' }
  })
  assert.match(
    beforeListing.error.message,
    /applications_list_applications/i
  )

  await client.request('tools/call', {
    name: 'applications_list_applications',
    arguments: {}
  })

  const inventedApplication = await client.requestRaw('tools/call', {
    name: 'test_plans_create_test_plan',
    arguments: { applicationId: 'ffffffffffffffffffffffff', name: 'Plano' }
  })
  assert.match(
    inventedApplication.error.message,
    /was not returned by the platform/i
  )

  const environmentsNotListed = await client.requestRaw('tools/call', {
    name: 'voidr_workspace_prepare_test_repository',
    arguments: {
      ...prepareBase,
      applicationId,
      environmentSlug: 'producao',
      cases: ['recarga-01']
    }
  })
  assert.match(
    environmentsNotListed.error.message,
    /applications_list_environments/i
  )

  await client.request('tools/call', {
    name: 'applications_list_environments',
    arguments: { applicationId }
  })

  const inventedEnvironment = await client.requestRaw('tools/call', {
    name: 'voidr_workspace_prepare_test_repository',
    arguments: {
      ...prepareBase,
      applicationId,
      environmentSlug: 'staging',
      cases: ['recarga-01']
    }
  })
  assert.match(inventedEnvironment.error.message, /Use exactly one of: producao/i)

  const executionBeforeSync = await client.requestRaw('tools/call', {
    name: 'executions_create_execution',
    arguments: { testPlanId: planId }
  })
  assert.match(
    executionBeforeSync.error.message,
    /sync verification first/i
  )

  await client.request('tools/call', {
    name: 'test_plans_get_test_plan',
    arguments: { testPlanId: planId }
  })
  const inventedCase = await client.requestRaw('tools/call', {
    name: 'voidr_workspace_prepare_test_repository',
    arguments: {
      ...prepareBase,
      applicationId,
      environmentSlug: 'producao',
      cases: ['recarga-01', 'ghost-99']
    }
  })
  assert.match(inventedCase.error.message, /ghost-99/)
  assert.match(inventedCase.error.message, /never invent slugs/i)

  await client.request('tools/call', {
    name: 'test_plans_get_test_counts',
    arguments: { testPlanId: planId }
  })
  const notAutomated = await client.request('tools/call', {
    name: 'executions_create_execution',
    arguments: { testPlanId: planId }
  })
  assert.equal(notAutomated.isError, true)
  const enriched = notAutomated.content
    .map(item => item.text)
    .join('\n')
  assert.match(enriched, /Do NOT re-create modules/i)
  assert.match(enriched, /voidr_release_deploy_merged_pr/)

  const blockedRecreate = await client.requestRaw('tools/call', {
    name: 'test_plans_create_module',
    arguments: { planId, name: 'Recarga de Créditos' }
  })
  assert.match(
    blockedRecreate.error.message,
    /not automated \(not deployed\)/i
  )
})

test('bridge blocks writes for an account without write scope before network', async t => {
  const receivedTools = []
  const server = createServer(async (request, response) => {
    const message = JSON.parse(await readBody(request))
    if (message.params?.name) receivedTools.push(message.params.name)
    response.setHeader('content-type', 'application/json')
    if (message.method === 'notifications/initialized') {
      response.writeHead(202)
      response.end()
    } else if (message.method === 'initialize') {
      sendResult(response, message.id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'mock', version: '1' }
      })
    } else if (message.method === 'tools/call') {
      sendResult(response, message.id, { content: [] })
    } else {
      sendResult(response, message.id, { tools: [] })
    }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => server.close())

  const temp = mkdtempSync(join(tmpdir(), 'voidr-bridge-readonly-'))
  const storePath = join(temp, 'service-accounts.json')
  writeFileSync(
    storePath,
    JSON.stringify({
      activeOrgId: 'org-read',
      accounts: {
        'org-read': {
          clientId: 'sa_read_e2e',
          clientSecret: 'synthetic-readonly-secret',
          scopes: ['read']
        }
      }
    })
  )
  const child = spawn(process.execPath, [bridgePath], {
    cwd: temp,
    env: {
      ...process.env,
      VOIDR_SERVICE_ACCOUNTS_PATH: storePath,
      VOIDR_MCP_URL: `http://127.0.0.1:${server.address().port}/mcp`
    },
    stdio: ['pipe', 'pipe', 'pipe']
  })
  t.after(() => child.kill())
  const client = jsonRpcClient(child)

  await client.request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'e2e', version: '1' }
  })
  const result = await client.requestRaw('tools/call', {
    name: 'executions_create_execution',
    arguments: { testPlanId: '0123456789abcdef01234567' }
  })
  assert.match(result.error.message, /does not declare the write scope/i)

  const localRelease = await client.requestRaw('tools/call', {
    name: 'voidr_release_deploy_merged_pr',
    arguments: {
      repositoryPath: temp,
      pullRequestNumber: 1,
      testPlanId: '0123456789abcdef01234567'
    }
  })
  assert.match(localRelease.error.message, /does not declare the write scope/i)
  assert.deepEqual(receivedTools, [])
})

function jsonRpcClient(child) {
  let nextId = 1
  const pending = new Map()
  const notifications = []
  const notificationWaiters = new Map()
  let stdout = ''
  let stderr = ''
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })
  lines.on('line', line => {
    stdout += `${line}\n`
    const message = JSON.parse(line)
    if (!Object.hasOwn(message, 'id')) {
      notifications.push(message)
      const waiters = notificationWaiters.get(message.method) || []
      notificationWaiters.delete(message.method)
      for (const resolve of waiters) resolve(message)
      return
    }
    const waiter = pending.get(message.id)
    if (waiter) {
      pending.delete(message.id)
      waiter.resolve(message)
    }
  })
  child.stderr.on('data', chunk => {
    stderr += String(chunk)
  })

  return {
    async request(method, params) {
      const message = await this.requestRaw(method, params)
      if (message.error) throw new Error(message.error.message)
      return message.result
    },
    requestRaw(method, params) {
      const id = nextId++
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`
      )
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(id)
          reject(new Error(`Timed out waiting for ${method}`))
        }, 5000)
        pending.set(id, {
          resolve(value) {
            clearTimeout(timeout)
            resolve(value)
          }
        })
      })
    },
    waitForNotification(method) {
      const existing = notifications.find(item => item.method === method)
      if (existing) return Promise.resolve(existing)
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          const waiters = notificationWaiters.get(method) || []
          notificationWaiters.set(
            method,
            waiters.filter(waiter => waiter !== onNotification)
          )
          reject(new Error(`Timed out waiting for notification ${method}`))
        }, 5000)
        const onNotification = value => {
          clearTimeout(timeout)
          resolve(value)
        }
        const waiters = notificationWaiters.get(method) || []
        waiters.push(onNotification)
        notificationWaiters.set(method, waiters)
      })
    },
    stdoutText: () => stdout,
    stderrText: () => stderr
  }
}

function toolDefinition(name) {
  return {
    name,
    description: `Mock ${name}`,
    inputSchema: { type: 'object', properties: {} }
  }
}

function jwt(payload) {
  return [
    Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString(
      'base64url'
    ),
    Buffer.from(JSON.stringify(payload)).toString('base64url'),
    'synthetic-signature'
  ].join('.')
}

function sendResult(response, id, result) {
  response.end(JSON.stringify({ jsonrpc: '2.0', id, result }))
}

async function readBody(request) {
  let body = ''
  for await (const chunk of request) body += chunk
  return body
}
