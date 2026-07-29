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
          toolDefinition('test_plans_create_test_plan'),
          toolDefinition('executions_create_execution'),
          toolDefinition('agent_jobs_trigger_hive_automation'),
          toolDefinition('system_batch_execute')
        ]
      })
      return
    }
    if (message.method === 'tools/call') {
      sendResult(response, message.id, {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ called: message.params.name })
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

  const listed = await client.request('tools/list', {})
  const names = listed.tools.map(tool => tool.name)
  assert.equal(names.includes('applications_list_applications'), true)
  assert.equal(names.includes('test_plans_create_test_plan'), true)
  assert.equal(names.includes('voidr_auth_status'), true)
  assert.equal(names.includes('voidr_auth_login'), true)
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

  const safeCall = await client.request('tools/call', {
    name: 'test_plans_create_test_plan',
    arguments: { applicationId: 'app-e2e', name: 'E2E Plan' }
  })
  assert.match(safeCall.content[0].text, /test_plans_create_test_plan/)

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
  let stdout = ''
  let stderr = ''
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })
  lines.on('line', line => {
    stdout += `${line}\n`
    const message = JSON.parse(line)
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
