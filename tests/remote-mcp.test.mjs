import test from 'node:test'
import assert from 'node:assert/strict'
import { RemoteMcpClient } from '../scripts/lib/remote-mcp.mjs'

test('credential changes create a fresh remote MCP session', async () => {
  let authorization = 'Basic first-credential'
  let sessionSequence = 0
  const calls = []

  const fetchImpl = async (_url, options) => {
    const message = JSON.parse(options.body)
    const sessionId = options.headers['mcp-session-id'] || null
    calls.push({
      method: message.method,
      authorization: options.headers.authorization,
      sessionId
    })

    if (message.method === 'notifications/initialized') {
      return new Response(null, { status: 202 })
    }

    const headers = { 'content-type': 'application/json' }
    if (message.method === 'initialize') {
      sessionSequence += 1
      headers['mcp-session-id'] = `session-${sessionSequence}`
    }
    const result =
      message.method === 'initialize'
        ? {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'mock-voidr', version: '1.0.0' }
          }
        : { content: [] }

    return new Response(
      JSON.stringify({ jsonrpc: '2.0', id: message.id, result }),
      { status: 200, headers }
    )
  }

  const client = new RemoteMcpClient({
    url: 'https://example.test/mcp',
    origin: 'https://example.test',
    fetchImpl,
    authorizationHeader: () => authorization
  })

  await client.callTool('applications_list_applications', {})
  authorization = 'Basic second-credential'
  await client.callTool('applications_list_applications', {})

  const initializeCalls = calls.filter(call => call.method === 'initialize')
  assert.equal(initializeCalls.length, 2)
  assert.equal(initializeCalls[0].sessionId, null)
  assert.equal(initializeCalls[1].sessionId, null)
  assert.equal(initializeCalls[1].authorization, 'Basic second-credential')

  const toolCalls = calls.filter(call => call.method === 'tools/call')
  assert.equal(toolCalls[0].sessionId, 'session-1')
  assert.equal(toolCalls[1].sessionId, 'session-2')
  assert.equal(toolCalls[1].authorization, 'Basic second-credential')
})
