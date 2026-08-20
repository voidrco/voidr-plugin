import { createHash } from 'node:crypto'
import { basicAuthorizationHeader } from './credentials.mjs'
import { describeNetworkFailure } from './network-trust.mjs'

export class RemoteMcpClient {
  constructor({
    url = process.env.VOIDR_MCP_URL || 'https://api.voidr.co/v1/mcp',
    origin = process.env.VOIDR_MCP_ORIGIN || 'https://app.voidr.co',
    fetchImpl = globalThis.fetch,
    authorizationHeader = basicAuthorizationHeader
  } = {}) {
    this.url = url
    this.origin = origin
    this.fetch = fetchImpl
    this.authorizationHeader = authorizationHeader
    this.sessionId = null
    this.initialized = false
    this.authorizationFingerprint = null
    this.nextId = 1
  }

  reset() {
    this.sessionId = null
    this.initialized = false
    this.authorizationFingerprint = null
  }

  async initialize(protocolVersion = '2024-11-05') {
    this.synchronizeAuthorization()
    if (this.initialized) return

    await this.request('initialize', {
      protocolVersion,
      capabilities: {},
      clientInfo: {
        name: 'voidr-plugin',
        version: '0.2.22'
      }
    })
    await this.notify('notifications/initialized', {})
    this.initialized = true
  }

  async listTools() {
    await this.initialize()
    return this.request('tools/list', {})
  }

  async callTool(name, args) {
    await this.initialize()
    return this.request('tools/call', { name, arguments: args || {} })
  }

  async request(method, params) {
    const id = this.nextId++
    const response = await this.post({
      jsonrpc: '2.0',
      id,
      method,
      params
    })
    if (response?.error) {
      throw new Error(response.error.message || `Remote MCP error calling ${method}`)
    }
    return response?.result
  }

  async notify(method, params) {
    await this.post({
      jsonrpc: '2.0',
      method,
      params
    })
  }

  async post(payload) {
    const authorization = this.synchronizeAuthorization()
    const headers = {
      accept: 'application/json, text/event-stream',
      authorization,
      'content-type': 'application/json',
      origin: this.origin
    }
    if (this.sessionId) headers['mcp-session-id'] = this.sessionId

    let response
    try {
      response = await this.fetch(this.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      })
    } catch (error) {
      throw new Error(describeNetworkFailure(error, 'the Voidr MCP endpoint'))
    }

    const returnedSession =
      response.headers.get('mcp-session-id') ||
      response.headers.get('Mcp-Session-Id')
    if (returnedSession) this.sessionId = returnedSession

    const text = await response.text()
    if (!response.ok) {
      const safeMessage =
        response.status === 401 || response.status === 403
          ? 'Voidr Service Account was rejected or lacks the required scope.'
          : `Voidr MCP returned HTTP ${response.status}.`
      throw new Error(safeMessage)
    }
    if (!text.trim()) return null

    const contentType = response.headers.get('content-type') || ''
    if (contentType.includes('text/event-stream')) {
      return parseEventStream(text)
    }
    return JSON.parse(text)
  }

  synchronizeAuthorization() {
    const authorization = this.authorizationHeader()
    const fingerprint = createHash('sha256')
      .update(authorization)
      .digest('hex')

    if (
      this.authorizationFingerprint !== null &&
      this.authorizationFingerprint !== fingerprint
    ) {
      this.sessionId = null
      this.initialized = false
    }
    this.authorizationFingerprint = fingerprint
    return authorization
  }
}

export function parseEventStream(text) {
  const messages = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue
    const data = line.slice(5).trim()
    if (!data || data === '[DONE]') continue
    messages.push(JSON.parse(data))
  }
  if (!messages.length) {
    throw new Error('Voidr MCP returned an empty event stream.')
  }
  return messages.at(-1)
}
