#!/usr/bin/env node

import { emitKeypressEvents } from 'node:readline'
import { upsertOrganizationAccount } from './lib/credentials.mjs'

const options = parseArgs(process.argv.slice(2))
if (!options['client-id']) fail('Missing required option --client-id')

const clientSecret =
  process.env.VOIDR_CLIENT_SECRET || (await readHiddenSecret('Client secret: '))
if (!clientSecret) fail('Client secret is required.')

const tokenUrl =
  options['token-url'] ||
  process.env.VOIDR_TOKEN_URL ||
  'https://api.voidr.co/v1/service-accounts/token'

let response
try {
  response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      grantType: 'client_credentials',
      clientId: options['client-id'],
      clientSecret
    })
  })
} catch {
  fail('Could not reach the Voidr token endpoint.')
}

if (!response.ok) {
  fail(
    response.status === 401 || response.status === 403
      ? 'Voidr rejected the Service Account.'
      : `Voidr token validation failed with HTTP ${response.status}.`
  )
}

let tokenResponse
try {
  tokenResponse = await response.json()
} catch {
  fail('Voidr returned an invalid token response.')
}
const accessToken = tokenResponse.access_token
if (!accessToken) fail('Voidr returned no access token.')

const claims = decodeJwtPayload(accessToken)
const organizationId = options['org-id'] || claims.organizationId
if (!organizationId) {
  fail('The token does not identify an organization; pass --org-id explicitly.')
}
if (options['org-id'] && claims.organizationId !== options['org-id']) {
  fail('The Service Account belongs to a different organization.')
}

const scopes = Array.isArray(claims.scopes) ? claims.scopes.map(String) : []
if (!scopes.map(scope => scope.toLowerCase()).includes('write')) {
  fail(
    'The Service Account is read-only. Create or rotate one with read and write scopes.'
  )
}

const status = upsertOrganizationAccount(organizationId, {
  clientId: options['client-id'],
  clientSecret,
  orgName: options['org-name'] || claims.name || null,
  scopes
})

process.stdout.write(
  `${JSON.stringify({
    connected: true,
    organizationId: status.organizationId,
    organizationName: status.organizationName,
    clientIdHint: status.clientIdHint,
    scopes: status.scopes,
    credentialStore: status.credentialStore
  })}\n`
)

function decodeJwtPayload(token) {
  const parts = String(token).split('.')
  if (parts.length !== 3) fail('Voidr returned a malformed access token.')
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
  } catch {
    fail('Voidr returned a token with an invalid payload.')
  }
}

async function readHiddenSecret(prompt) {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) {
    fail(
      'A terminal is required for secret input. Run this command directly in a terminal.'
    )
  }

  process.stdout.write(prompt)
  emitKeypressEvents(process.stdin)
  process.stdin.setRawMode(true)
  process.stdin.resume()

  return new Promise(resolveSecret => {
    let secret = ''
    function onKeypress(character, key) {
      if (key?.ctrl && key.name === 'c') {
        cleanup()
        process.stdout.write('\n')
        process.exit(130)
      }
      if (key?.name === 'return' || key?.name === 'enter') {
        cleanup()
        process.stdout.write('\n')
        resolveSecret(secret)
        return
      }
      if (key?.name === 'backspace') {
        secret = secret.slice(0, -1)
        return
      }
      if (!key?.ctrl && !key?.meta && character) secret += character
    }
    function cleanup() {
      process.stdin.off('keypress', onKeypress)
      process.stdin.setRawMode(false)
      process.stdin.pause()
    }
    process.stdin.on('keypress', onKeypress)
  })
}

function parseArgs(args) {
  const parsed = {}
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]
    if (!token.startsWith('--')) fail(`Unexpected argument: ${token}`)
    const key = token.slice(2)
    const value = args[index + 1]
    if (!value || value.startsWith('--')) fail(`Missing value for --${key}`)
    parsed[key] = value
    index += 1
  }
  return parsed
}

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}
