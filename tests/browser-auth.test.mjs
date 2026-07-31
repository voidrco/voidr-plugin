import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildBrowserConnectUrl,
  connectWithBrowser,
  startLocalBrowserAuthServer
} from '../scripts/lib/browser-auth.mjs'

test('browser login creates, validates, and stores a role-scoped Copilot account', async t => {
  const temp = mkdtempSync(join(tmpdir(), 'voidr-browser-auth-'))
  const storePath = join(temp, 'service-accounts.json')
  const temporaryUserToken = 'synthetic-user-token-never-return'
  const clientSecret = 'synthetic-created-secret-never-return'
  const serviceAccountToken = jwt({
    organizationId: 'org-browser',
    scopes: ['read', 'write']
  })
  const requests = []
  const restore = setEnvironment({
    VOIDR_SERVICE_ACCOUNTS_PATH: storePath
  })
  t.after(restore)

  const result = await connectWithBrowser({
    platformUrl:
      'https://release-outside-repo-crea.app-preview.voidr.co',
    callbackUrl: 'https://platform.voidr.co/auth/cli-connect',
    allowedOrigins: ['https://platform.voidr.co'],
    apiUrl:
      'https://release-outside-repo-crea.api-preview.voidr.co/v1',
    openBrowserImpl: async connectUrl => {
      const url = new URL(connectUrl)
      const state = JSON.parse(
        Buffer.from(url.searchParams.get('state'), 'base64url').toString(
          'utf8'
        )
      )
      assert.equal(url.origin, 'https://platform.voidr.co')
      assert.equal(url.pathname, '/auth/cli-connect')
      setImmediate(async () => {
        await fetch(`http://127.0.0.1:${state.port}/cli-callback`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: 'https://platform.voidr.co'
          },
          body: JSON.stringify({
            nonce: state.nonce,
            accessToken: temporaryUserToken
          })
        })
      })
      return true
    },
    fetchImpl: async (url, options = {}) => {
      requests.push({
        url,
        method: options.method || 'GET',
        authorization: options.headers?.authorization || null,
        body: options.body || null
      })
      if (url.endsWith('/auth/me')) {
        return jsonResponse({
          success: true,
          data: {
            name: 'Test User',
            organizationId: 'org-browser',
            organization: {
              id: 'org-browser',
              display_name: 'Browser Organization'
            }
          }
        })
      }
      if (url.endsWith('/service-accounts')) {
        const body = JSON.parse(options.body)
        assert.equal(Object.hasOwn(body, 'scopes'), false)
        return jsonResponse({
          success: true,
          data: {
            organizationId: 'org-browser',
            name: 'Test User - copilot-a1b2c3',
            clientId: 'sa_synthetic_browser',
            clientSecret,
            scopes: ['read', 'write']
          }
        })
      }
      if (url.endsWith('/service-accounts/token')) {
        return jsonResponse({ access_token: serviceAccountToken })
      }
      return new Response(null, { status: 404 })
    }
  })

  assert.equal(result.connected, true)
  assert.equal(result.authentication, 'browser')
  assert.equal(result.organizationId, 'org-browser')
  assert.equal(result.organizationName, 'Browser Organization')
  assert.deepEqual(result.scopes, ['read', 'write'])
  assert.equal(result.canWrite, true)
  assert.equal(JSON.stringify(result).includes(temporaryUserToken), false)
  assert.equal(JSON.stringify(result).includes(clientSecret), false)

  const stored = JSON.parse(readFileSync(storePath, 'utf8'))
  assert.equal(stored.activeOrgId, 'org-browser')
  assert.equal(
    stored.accounts['org-browser'].clientSecret,
    clientSecret
  )
  assert.equal(
    stored.accounts['org-browser'].orgName,
    'Browser Organization'
  )
  assert.equal(
    requests.filter(
      request => request.authorization === `Bearer ${temporaryUserToken}`
    ).length,
    2
  )
  assert.equal(
    requests.every(request =>
      request.url.startsWith(
        'https://release-outside-repo-crea.api-preview.voidr.co/v1/'
      )
    ),
    true,
    'the production callback must not move API operations away from preview'
  )
  assert.equal(
    requests.at(-1).body.includes(clientSecret),
    true,
    'the new secret is sent only to the token endpoint for local validation'
  )
})

test('browser login preserves a viewer account as read-only', async t => {
  const temp = mkdtempSync(join(tmpdir(), 'voidr-browser-viewer-'))
  const restore = setEnvironment({
    VOIDR_SERVICE_ACCOUNTS_PATH: join(temp, 'service-accounts.json')
  })
  t.after(restore)

  const result = await connectWithBrowser({
    platformUrl: 'https://platform.test',
    allowedOrigins: ['https://platform.test'],
    apiUrl: 'https://api.test/v1',
    openBrowserImpl: browserCallback('https://platform.test', 'viewer-token'),
    fetchImpl: async (url, options = {}) => {
      if (url.endsWith('/auth/me')) {
        return jsonResponse({
          data: {
            name: 'Viewer',
            organizationId: 'org-viewer',
            organization: { id: 'org-viewer' }
          }
        })
      }
      if (
        url.endsWith('/service-accounts') &&
        options.method === 'POST'
      ) {
        return jsonResponse({
          data: {
            organizationId: 'org-viewer',
            name: 'Viewer - copilot',
            clientId: 'sa_synthetic_viewer',
            clientSecret: 'synthetic-viewer-secret',
            scopes: ['read']
          }
        })
      }
      return jsonResponse({
        access_token: jwt({
          organizationId: 'org-viewer',
          scopes: ['read']
        })
      })
    }
  })

  assert.equal(result.canRead, true)
  assert.equal(result.canWrite, false)
  assert.deepEqual(result.scopes, ['read'])
})

test('loopback callback rejects invalid origin and nonce before accepting one request', async () => {
  const server = await startLocalBrowserAuthServer({
    expectedNonce: 'expected-nonce',
    allowedOrigins: ['https://platform.test'],
    timeoutMs: 2000
  })

  const invalidOrigin = await callbackRequest(server.port, {
    origin: 'https://attacker.test',
    nonce: 'expected-nonce'
  })
  assert.equal(invalidOrigin.status, 403)

  const invalidNonce = await callbackRequest(server.port, {
    origin: 'https://platform.test',
    nonce: 'wrong-nonce'
  })
  assert.equal(invalidNonce.status, 400)

  const waiting = server.waitForResult()
  const accepted = await callbackRequest(server.port, {
    origin: 'https://platform.test',
    nonce: 'expected-nonce',
    accessToken: 'synthetic-loopback-token'
  })
  assert.equal(accepted.status, 200)
  assert.deepEqual(await waiting, {
    accessToken: 'synthetic-loopback-token'
  })
})

test('loopback callback accepts a form-POST navigation and renders HTML', async () => {
  const server = await startLocalBrowserAuthServer({
    expectedNonce: 'navigation-nonce',
    allowedOrigins: ['https://platform.test'],
    timeoutMs: 2000
  })

  const navigationRequest = (fields, origin = 'https://platform.test') =>
    fetch(`http://127.0.0.1:${server.port}/cli-callback`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'sec-fetch-mode': 'navigate',
        origin
      },
      body: new URLSearchParams(fields).toString()
    })

  const invalidNonce = await navigationRequest({
    nonce: 'wrong-nonce',
    accessToken: 'synthetic-navigation-token'
  })
  assert.equal(invalidNonce.status, 400)
  assert.match(invalidNonce.headers.get('content-type'), /text\/html/)
  assert.match(await invalidNonce.text(), /invalid_nonce/)

  const waiting = server.waitForResult()
  const accepted = await navigationRequest({
    nonce: 'navigation-nonce',
    accessToken: 'synthetic-navigation-token'
  })
  assert.equal(accepted.status, 200)
  assert.match(accepted.headers.get('content-type'), /text\/html/)
  assert.match(await accepted.text(), /Login concluído/)
  assert.deepEqual(await waiting, {
    accessToken: 'synthetic-navigation-token'
  })
})

test('platform connect URL binds the browser to an ephemeral port and nonce', () => {
  const built = new URL(
    buildBrowserConnectUrl({
      port: 43123,
      nonce: 'synthetic-nonce',
      platformUrl: 'https://platform.test'
    })
  )
  const state = JSON.parse(
    Buffer.from(built.searchParams.get('state'), 'base64url').toString('utf8')
  )
  assert.deepEqual(state, {
    port: 43123,
    nonce: 'synthetic-nonce',
    cliLogin: true
  })
  assert.equal(
    `${built.origin}${built.pathname}`,
    'https://platform.test/auth/cli-connect'
  )
})

test('authorization callback can be separated from the target platform', () => {
  const built = new URL(
    buildBrowserConnectUrl({
      port: 43123,
      nonce: 'synthetic-nonce',
      platformUrl: 'https://preview.platform.test',
      callbackUrl: 'https://staging.platform.test/auth/cli-connect'
    })
  )
  assert.equal(
    `${built.origin}${built.pathname}`,
    'https://staging.platform.test/auth/cli-connect'
  )
})

function browserCallback(origin, accessToken) {
  return async connectUrl => {
    const state = JSON.parse(
      Buffer.from(
        new URL(connectUrl).searchParams.get('state'),
        'base64url'
      ).toString('utf8')
    )
    setImmediate(async () => {
      await callbackRequest(state.port, {
        origin,
        nonce: state.nonce,
        accessToken
      })
    })
    return true
  }
}

function callbackRequest(
  port,
  { origin, nonce, accessToken = 'synthetic-user-token' }
) {
  return fetch(`http://127.0.0.1:${port}/cli-callback`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin
    },
    body: JSON.stringify({ nonce, accessToken })
  })
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' }
  })
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

function setEnvironment(values) {
  const previous = Object.fromEntries(
    Object.keys(values).map(key => [key, process.env[key]])
  )
  Object.assign(process.env, values)
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}
