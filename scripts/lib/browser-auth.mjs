import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { upsertOrganizationAccount } from './credentials.mjs'
import { describeNetworkFailure } from './network-trust.mjs'

const DEFAULT_PLATFORM_URL = 'https://platform.voidr.co'
const DEFAULT_API_URL = 'https://api.voidr.co/v1'
const DEFAULT_AUTH_CALLBACK_URL =
  `${DEFAULT_PLATFORM_URL}/auth/cli-connect`

export function buildBrowserConnectUrl({
  port,
  nonce,
  platformUrl = process.env.VOIDR_PLATFORM_URL || DEFAULT_PLATFORM_URL,
  callbackUrl = process.env.VOIDR_AUTH_CALLBACK_URL
}) {
  const normalizedPlatform = String(platformUrl).replace(/\/+$/, '')
  const resolvedCallbackUrl = String(
    callbackUrl || `${normalizedPlatform}/auth/cli-connect`
  )
  const url = new URL(resolvedCallbackUrl)
  const state = Buffer.from(
    JSON.stringify({ port, nonce, cliLogin: true })
  ).toString('base64url')

  url.searchParams.set('state', state)
  return url.toString()
}

export async function startLocalBrowserAuthServer({
  expectedNonce,
  timeoutMs = 300000,
  allowedOrigins,
  callbackUrl = process.env.VOIDR_AUTH_CALLBACK_URL ||
    DEFAULT_AUTH_CALLBACK_URL
} = {}) {
  if (!expectedNonce) {
    throw new Error('A browser authentication nonce is required.')
  }

  const configuredPlatform = String(
    process.env.VOIDR_PLATFORM_URL || DEFAULT_PLATFORM_URL
  ).replace(/\/+$/, '')
  const callbackOrigin = new URL(callbackUrl).origin
  const origins = new Set(
    allowedOrigins || [
      callbackOrigin,
      configuredPlatform,
      DEFAULT_PLATFORM_URL,
      'https://canary.voidr.co'
    ]
  )

  let completed = false
  let resolveResult
  let rejectResult
  let timer
  const resultPromise = new Promise((resolve, reject) => {
    resolveResult = resolve
    rejectResult = reject
  })

  const server = createServer(async (request, response) => {
    const origin = request.headers.origin
    const applyCors = () => {
      if (origin && origins.has(origin)) {
        response.setHeader('access-control-allow-origin', origin)
        response.setHeader('vary', 'Origin')
      }
    }

    response.setHeader('x-content-type-options', 'nosniff')
    response.setHeader('cache-control', 'no-store')

    if (
      request.method === 'OPTIONS' &&
      request.url === '/cli-callback'
    ) {
      if (!origin || !origins.has(origin)) {
        response.writeHead(403).end()
        return
      }
      applyCors()
      response.setHeader('access-control-allow-methods', 'POST, OPTIONS')
      response.setHeader('access-control-allow-headers', 'content-type')
      if (
        request.headers['access-control-request-private-network'] === 'true'
      ) {
        response.setHeader('access-control-allow-private-network', 'true')
      }
      response.writeHead(204).end()
      return
    }

    if (request.method !== 'POST' || request.url !== '/cli-callback') {
      response.writeHead(404).end()
      return
    }

    // Chrome's Local Network Access permission gates fetch()/XHR from public
    // pages to loopback, but exempts top-level navigations. The platform falls
    // back to a form-POST navigation when the fetch path is blocked, so this
    // server must answer that navigation with a human-readable HTML page.
    const isNavigation =
      String(request.headers['sec-fetch-mode'] || '') === 'navigate' ||
      String(request.headers['content-type'] || '').includes(
        'application/x-www-form-urlencoded'
      )
    const reply = (status, payload) => {
      if (isNavigation) {
        response.writeHead(status, {
          'content-type': 'text/html; charset=utf-8'
        })
        response.end(renderCallbackPage(status, payload))
        return
      }
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end(JSON.stringify(payload))
    }

    try {
      if (!origin || !origins.has(origin)) {
        reply(403, { error: 'invalid_origin' })
        return
      }
      applyCors()

      const host = String(request.headers.host || '')
      if (
        !/^127\.0\.0\.1:\d+$/.test(host) &&
        !/^localhost:\d+$/.test(host)
      ) {
        reply(403, { error: 'invalid_host' })
        return
      }
      if (completed) {
        reply(409, { error: 'already_handled' })
        return
      }

      const rawBody = await readLimitedBody(request)
      const body = String(
        request.headers['content-type'] || ''
      ).includes('application/x-www-form-urlencoded')
        ? Object.fromEntries(new URLSearchParams(rawBody))
        : JSON.parse(rawBody)
      if (!body?.nonce || body.nonce !== expectedNonce) {
        reply(400, { error: 'invalid_nonce' })
        return
      }
      if (!body.accessToken || typeof body.accessToken !== 'string') {
        reply(400, { error: 'missing_payload' })
        return
      }

      completed = true
      reply(200, { status: 'ok' })
      resolveResult({ accessToken: body.accessToken })
    } catch {
      applyCors()
      reply(400, { error: 'invalid_request' })
    }
  })

  const listening = new Promise((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })
  server.listen(0, '127.0.0.1')
  await listening

  timer = setTimeout(() => {
    if (!completed) rejectResult(new Error('Browser authentication timed out.'))
    void close()
  }, timeoutMs)

  const close = () =>
    new Promise(resolve => {
      if (timer) clearTimeout(timer)
      if (!server.listening) {
        resolve()
        return
      }
      server.close(() => resolve())
    })

  const waitForResult = async () => {
    try {
      return await resultPromise
    } finally {
      await close()
    }
  }

  const address = server.address()
  return {
    port:
      address && typeof address === 'object' ? address.port : null,
    waitForResult,
    close
  }
}

export async function connectWithBrowser({
  fetchImpl = globalThis.fetch,
  openBrowserImpl = openBrowser,
  timeoutMs = Number(process.env.VOIDR_BROWSER_AUTH_TIMEOUT_MS) || 300000,
  apiUrl = process.env.VOIDR_API_URL || DEFAULT_API_URL,
  platformUrl = process.env.VOIDR_PLATFORM_URL || DEFAULT_PLATFORM_URL,
  callbackUrl = process.env.VOIDR_AUTH_CALLBACK_URL,
  allowedOrigins
} = {}) {
  const normalizedPlatform = String(platformUrl).replace(/\/+$/, '')
  const resolvedCallbackUrl =
    callbackUrl || `${normalizedPlatform}/auth/cli-connect`
  const nonce = randomBytes(32).toString('hex')
  const local = await startLocalBrowserAuthServer({
    expectedNonce: nonce,
    timeoutMs,
    allowedOrigins,
    callbackUrl: resolvedCallbackUrl
  })
  const authorizationUrl = buildBrowserConnectUrl({
    port: local.port,
    nonce,
    platformUrl,
    callbackUrl: resolvedCallbackUrl
  })

  const opened = await openBrowserImpl(authorizationUrl)
  if (!opened) {
    await local.close()
    throw new Error(
      'Could not open the Voidr login page. Check that a default browser is configured and try again.'
    )
  }

  const { accessToken } = await local.waitForResult()
  const normalizedApiUrl = String(apiUrl).replace(/\/+$/, '')
  const me = await requestJson(fetchImpl, `${normalizedApiUrl}/auth/me`, {
    headers: bearerHeaders(accessToken)
  })
  const identity = me?.data || {}
  const organization = identity.organization || {}
  const organizationId = String(
    identity.organizationId || organization.id || ''
  )
  if (!organizationId) {
    throw new Error(
      'Voidr did not return an active organization for this login.'
    )
  }

  const suffix = randomBytes(3).toString('hex')
  const userName = String(identity.name || 'Voidr user').trim()
  const created = await requestJson(
    fetchImpl,
    `${normalizedApiUrl}/service-accounts`,
    {
      method: 'POST',
      headers: bearerHeaders(accessToken, true),
      body: JSON.stringify({
        name: `${userName} - copilot-${suffix}`,
        description:
          'Dedicated Service Account for the Voidr GitHub Copilot plugin.'
      })
    }
  )
  const account = created?.data
  if (!account?.clientId || !account?.clientSecret) {
    throw new Error('Voidr returned an invalid Service Account response.')
  }
  if (
    account.organizationId &&
    String(account.organizationId) !== organizationId
  ) {
    throw new Error(
      'Voidr returned a Service Account for a different organization.'
    )
  }

  const validated = await validateCreatedServiceAccount({
    fetchImpl,
    apiUrl: normalizedApiUrl,
    clientId: account.clientId,
    clientSecret: account.clientSecret,
    expectedOrganizationId: organizationId
  })
  const scopes =
    validated.scopes.length > 0
      ? validated.scopes
      : normalizeScopes(account.scopes)
  const organizationName =
    organization.display_name ||
    organization.displayName ||
    organization.name ||
    null

  const status = upsertOrganizationAccount(organizationId, {
    clientId: account.clientId,
    clientSecret: account.clientSecret,
    orgName: organizationName,
    accountName: account.name || null,
    scopes
  })

  return {
    connected: true,
    authentication: 'browser',
    organizationId,
    organizationName,
    serviceAccountName: account.name || null,
    clientIdHint: status.clientIdHint,
    scopes: status.scopes,
    canRead: status.canRead,
    canWrite: status.canWrite
  }
}

export async function validateCreatedServiceAccount({
  fetchImpl = globalThis.fetch,
  apiUrl = process.env.VOIDR_API_URL || DEFAULT_API_URL,
  clientId,
  clientSecret,
  expectedOrganizationId
}) {
  const token = await requestJson(
    fetchImpl,
    `${String(apiUrl).replace(/\/+$/, '')}/service-accounts/token`,
    {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({
        grantType: 'client_credentials',
        clientId,
        clientSecret
      })
    }
  )
  if (!token?.access_token) {
    throw new Error('Voidr returned no Service Account access token.')
  }
  const claims = decodeJwtPayload(token.access_token)
  const organizationId = String(claims.organizationId || '')
  if (
    expectedOrganizationId &&
    organizationId !== String(expectedOrganizationId)
  ) {
    throw new Error(
      'The created Service Account belongs to a different organization.'
    )
  }
  return {
    organizationId,
    scopes: normalizeScopes(claims.scopes)
  }
}

export function openBrowser(url) {
  if (process.env.VOIDR_DISABLE_BROWSER_OPEN === '1') {
    return Promise.resolve(false)
  }
  const command =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]]

  return new Promise(resolve => {
    const child = spawn(command[0], command[1], {
      detached: true,
      stdio: 'ignore'
    })
    let settled = false
    child.once('spawn', () => {
      settled = true
      child.unref()
      resolve(true)
    })
    child.once('error', () => {
      if (!settled) resolve(false)
    })
  })
}

function renderCallbackPage(status, payload) {
  const ok = status === 200
  const title = ok ? 'Login concluído' : 'Falha no login do CLI'
  const detail = ok
    ? 'Você já pode fechar esta aba e voltar ao editor.'
    : `Feche esta aba e execute o comando de conexão novamente (${String(
        payload?.error || 'erro desconhecido'
      )}).`
  return (
    '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">' +
    `<title>${title}</title>` +
    '<style>body{font-family:system-ui,sans-serif;background:#111;color:#eee;' +
    'display:flex;align-items:center;justify-content:center;height:100vh;margin:0}' +
    'main{text-align:center;max-width:28rem;padding:2rem}' +
    `h1{font-size:1.4rem;color:${ok ? '#7ee787' : '#ff7b72'}}</style></head>` +
    `<body><main><h1>${title}</h1><p>${detail}</p></main></body></html>`
  )
}

async function readLimitedBody(request, limit = 256 * 1024) {
  let body = ''
  for await (const chunk of request) {
    body += chunk
    if (Buffer.byteLength(body) > limit) {
      throw new Error('request_too_large')
    }
  }
  return body
}

async function requestJson(fetchImpl, url, options) {
  let response
  try {
    response = await fetchImpl(url, options)
  } catch (error) {
    throw new Error(describeNetworkFailure(error))
  }
  if (!response.ok) {
    throw new Error(
      response.status === 401 || response.status === 403
        ? 'Voidr rejected this login or does not allow this operation.'
        : `Voidr API returned HTTP ${response.status}.`
    )
  }
  try {
    return await response.json()
  } catch {
    throw new Error('Voidr returned an invalid API response.')
  }
}

function bearerHeaders(accessToken, withJson = false) {
  return {
    accept: 'application/json',
    authorization: `Bearer ${accessToken}`,
    ...(withJson ? { 'content-type': 'application/json' } : {})
  }
}

function decodeJwtPayload(token) {
  const parts = String(token).split('.')
  if (parts.length !== 3) {
    throw new Error('Voidr returned a malformed Service Account token.')
  }
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
  } catch {
    throw new Error('Voidr returned an invalid Service Account token.')
  }
}

function normalizeScopes(scopes) {
  if (!Array.isArray(scopes)) return []
  return [...new Set(scopes.map(String).map(scope => scope.toLowerCase()))]
}
