import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import {
  credentialsPath,
  upsertOrganizationAccount
} from './credentials.mjs'

export function serviceAccountImportPath() {
  return resolve(
    process.env.VOIDR_SERVICE_ACCOUNT_IMPORT_PATH ||
      `${dirname(credentialsPath())}/copilot-service-account.json`
  )
}

export async function prepareServiceAccountImport() {
  const path = serviceAccountImportPath()
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })

  if (!existsSync(path)) {
    writeFileSync(
      path,
      JSON.stringify({ clientId: '', clientSecret: '' }, null, 2),
      { encoding: 'utf8', mode: 0o600 }
    )
  }
  protectFile(path)

  return {
    prepared: true,
    path,
    opened: await openInEditor(path),
    requiredFields: ['clientId', 'clientSecret'],
    nextAction: 'Fill both fields, save the file, and reply ready.'
  }
}

export async function importServiceAccount() {
  const path = serviceAccountImportPath()
  if (!existsSync(path)) {
    throw new Error(
      'The Service Account JSON is not prepared. Open the connection flow first.'
    )
  }

  let input
  try {
    input = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    throw new Error(
      'The Service Account JSON is invalid. Fix the JSON, save it, and try again.'
    )
  }

  const clientId = String(input?.clientId || '').trim()
  const clientSecret = String(input?.clientSecret || '').trim()
  if (!clientId || !clientSecret) {
    throw new Error(
      'Fill clientId and clientSecret in the opened JSON, save it, and try again.'
    )
  }

  const result = await validateAndStoreServiceAccount({
    clientId,
    clientSecret
  })
  unlinkSync(path)
  return result
}

export async function validateAndStoreServiceAccount({
  clientId,
  clientSecret,
  organizationId,
  organizationName,
  tokenUrl
}) {
  const normalizedClientId = String(clientId || '').trim()
  const normalizedSecret = String(clientSecret || '').trim()
  if (!normalizedClientId || !normalizedSecret) {
    throw new Error('Client ID and client secret are required.')
  }

  const endpoint =
    tokenUrl ||
    process.env.VOIDR_TOKEN_URL ||
    'https://api.voidr.co/v1/service-accounts/token'

  let response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        grantType: 'client_credentials',
        clientId: normalizedClientId,
        clientSecret: normalizedSecret
      })
    })
  } catch {
    throw new Error('Could not reach the Voidr token endpoint.')
  }

  if (!response.ok) {
    throw new Error(
      response.status === 401 || response.status === 403
        ? 'Voidr rejected the Service Account.'
        : `Voidr token validation failed with HTTP ${response.status}.`
    )
  }

  let tokenResponse
  try {
    tokenResponse = await response.json()
  } catch {
    throw new Error('Voidr returned an invalid token response.')
  }
  const accessToken = tokenResponse.access_token
  if (!accessToken) throw new Error('Voidr returned no access token.')

  const claims = decodeJwtPayload(accessToken)
  const resolvedOrganizationId =
    String(organizationId || claims.organizationId || '').trim()
  if (!resolvedOrganizationId) {
    throw new Error('The Service Account token does not identify an organization.')
  }
  if (
    organizationId &&
    String(claims.organizationId || '') !== String(organizationId)
  ) {
    throw new Error('The Service Account belongs to a different organization.')
  }

  const scopes = Array.isArray(claims.scopes)
    ? claims.scopes.map(String).map(scope => scope.toLowerCase())
    : []
  if (!scopes.includes('write')) {
    throw new Error(
      'The Service Account is read-only. Create or rotate one with read and write scopes.'
    )
  }

  const status = upsertOrganizationAccount(resolvedOrganizationId, {
    clientId: normalizedClientId,
    clientSecret: normalizedSecret,
    orgName: organizationName || null,
    accountName: claims.name || null,
    scopes
  })

  return {
    connected: true,
    organizationId: status.organizationId,
    organizationName: status.organizationName,
    serviceAccountName: claims.name || null,
    clientIdHint: status.clientIdHint,
    scopes: status.scopes,
    canWrite: status.canWrite
  }
}

function decodeJwtPayload(token) {
  const parts = String(token).split('.')
  if (parts.length !== 3) {
    throw new Error('Voidr returned a malformed access token.')
  }
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
  } catch {
    throw new Error('Voidr returned a token with an invalid payload.')
  }
}

function protectFile(path) {
  try {
    chmodSync(path, 0o600)
  } catch {
    // Best effort on filesystems that do not support POSIX modes.
  }
}

function openInEditor(path) {
  if (process.env.VOIDR_DISABLE_EDITOR_OPEN === '1') {
    return Promise.resolve(false)
  }

  return new Promise(resolveOpened => {
    const child = spawn('code', ['--reuse-window', path], {
      detached: true,
      stdio: 'ignore'
    })
    let settled = false
    child.once('spawn', () => {
      settled = true
      child.unref()
      resolveOpened(true)
    })
    child.once('error', () => {
      if (!settled) resolveOpened(false)
    })
  })
}
