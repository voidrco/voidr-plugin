import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'

const root = resolve(import.meta.dirname, '..')
const connector = join(root, 'scripts/connect-service-account.mjs')

test('validates and persists a writable Service Account without logging secrets', async t => {
  const secret = 'synthetic-connector-secret'
  const token = jwt({
    organizationId: 'org-connected',
    name: 'Copilot Writer',
    scopes: ['read', 'write']
  })
  const server = tokenServer({ secret, token })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => server.close())

  const temp = mkdtempSync(join(tmpdir(), 'voidr-connect-'))
  const storePath = join(temp, 'nested', 'service-accounts.json')
  const result = await runConnector({
    args: [
      '--client-id',
      'sa_synthetic_connected',
      '--org-id',
      'org-connected',
      '--org-name',
      'Connected Organization',
      '--token-url',
      `http://127.0.0.1:${server.address().port}/token`
    ],
    env: {
      VOIDR_CLIENT_SECRET: secret,
      VOIDR_SERVICE_ACCOUNTS_PATH: storePath
    }
  })

  assert.equal(result.code, 0, result.stderr)
  assert.equal(result.stdout.includes(secret), false)
  assert.equal(result.stderr.includes(secret), false)
  assert.equal(result.stdout.includes(token), false)
  const publicResult = JSON.parse(result.stdout)
  assert.equal(publicResult.connected, true)
  assert.equal(publicResult.serviceAccountName, 'Copilot Writer')
  assert.deepEqual(publicResult.scopes, ['read', 'write'])

  const stored = JSON.parse(readFileSync(storePath, 'utf8'))
  assert.equal(stored.activeOrgId, 'org-connected')
  assert.equal(
    stored.accounts['org-connected'].clientSecret,
    secret
  )
  assert.equal(
    stored.accounts['org-connected'].accountName,
    'Copilot Writer'
  )
  assert.equal(
    stored.accounts['org-connected'].orgName,
    'Connected Organization'
  )
})

test('rejects a read-only account without persisting it', async t => {
  const server = tokenServer({
    secret: 'synthetic-readonly-connector-secret',
    token: jwt({
      organizationId: 'org-readonly',
      scopes: ['read']
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => server.close())

  const temp = mkdtempSync(join(tmpdir(), 'voidr-connect-readonly-'))
  const storePath = join(temp, 'service-accounts.json')
  const result = await runConnector({
    args: [
      '--client-id',
      'sa_synthetic_readonly',
      '--org-id',
      'org-readonly',
      '--token-url',
      `http://127.0.0.1:${server.address().port}/token`
    ],
    env: {
      VOIDR_CLIENT_SECRET: 'synthetic-readonly-connector-secret',
      VOIDR_SERVICE_ACCOUNTS_PATH: storePath
    }
  })

  assert.notEqual(result.code, 0)
  assert.match(result.stderr, /read-only/i)
  assert.equal(existsSync(storePath), false)
})

function tokenServer({ secret, token }) {
  return createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    const parsed = JSON.parse(body)
    if (
      parsed.clientId.startsWith('sa_synthetic_') &&
      parsed.clientSecret === secret &&
      parsed.grantType === 'client_credentials'
    ) {
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({
          access_token: token,
          token_type: 'Bearer',
          expires_in: 3600
        })
      )
    } else {
      response.writeHead(401)
      response.end()
    }
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

function runConnector({ args, env }) {
  const child = spawn(process.execPath, [connector, ...args], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', chunk => {
    stdout += chunk
  })
  child.stderr.on('data', chunk => {
    stderr += chunk
  })
  return new Promise(resolveChild => {
    child.on('exit', code => resolveChild({ code, stdout, stderr }))
  })
}
