import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'

export function credentialsPath() {
  return resolve(
    process.env.VOIDR_SERVICE_ACCOUNTS_PATH ||
      `${homedir()}/.voidr/service-accounts.json`
  )
}

function emptyStore() {
  return { activeOrgId: null, accounts: {} }
}

export function readCredentialStore() {
  const path = credentialsPath()
  if (!existsSync(path)) return { path, ...emptyStore() }

  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return {
      path,
      activeOrgId: parsed.activeOrgId || null,
      accounts:
        parsed.accounts && typeof parsed.accounts === 'object'
          ? parsed.accounts
          : {}
    }
  } catch {
    return { path, ...emptyStore(), invalid: true }
  }
}

export function resolveCredential() {
  const envClientId = process.env.VOIDR_CLIENT_ID
  const envClientSecret = process.env.VOIDR_CLIENT_SECRET
  if (envClientId && envClientSecret) {
    return {
      source: 'environment',
      orgId: process.env.VOIDR_ORG_ID || null,
      account: {
        clientId: envClientId,
        clientSecret: envClientSecret,
        orgName: process.env.VOIDR_ORG_NAME || null,
        scopes: parseScopes(process.env.VOIDR_SCOPES)
      }
    }
  }

  const store = readCredentialStore()
  const orgIds = Object.keys(store.accounts)
  const orgId =
    process.env.VOIDR_ORG_ID ||
    store.activeOrgId ||
    (orgIds.length === 1 ? orgIds[0] : null)
  const account = orgId ? store.accounts[orgId] : null

  return {
    source: 'service-account-store',
    path: store.path,
    invalid: store.invalid === true,
    orgId,
    account: account || null,
    accounts: orgIds.map(id => ({
      orgId: id,
      orgName: store.accounts[id]?.orgName || null,
      accountName: store.accounts[id]?.accountName || null,
      scopes: normalizeScopes(store.accounts[id]?.scopes),
      clientIdHint: maskClientId(store.accounts[id]?.clientId),
      selected: id === orgId,
      canWrite: normalizeScopes(store.accounts[id]?.scopes).includes('write')
    }))
  }
}

export function selectOrganization(orgId) {
  const store = readCredentialStore()
  if (!store.accounts[orgId]) {
    throw new Error(`No local Voidr Service Account exists for organization ${orgId}`)
  }

  writeFileSync(
    store.path,
    JSON.stringify(
      {
        activeOrgId: orgId,
        accounts: store.accounts
      },
      null,
      2
    ),
    'utf8'
  )
  try {
    chmodSync(store.path, 0o600)
  } catch {
    // Best effort on filesystems that do not support POSIX modes.
  }
  return resolveCredential()
}

export function upsertOrganizationAccount(orgId, account) {
  if (!orgId) throw new Error('Organization ID is required.')
  if (!account?.clientId || !account?.clientSecret) {
    throw new Error('Client ID and client secret are required.')
  }

  const store = readCredentialStore()
  const accounts = {
    ...store.accounts,
    [orgId]: {
      ...(store.accounts[orgId] || {}),
      clientId: account.clientId,
      clientSecret: account.clientSecret,
      orgName: account.orgName || store.accounts[orgId]?.orgName || null,
      accountName:
        account.accountName || store.accounts[orgId]?.accountName || null,
      scopes: normalizeScopes(account.scopes),
      createdAt: account.createdAt || Date.now()
    }
  }
  mkdirSync(dirname(store.path), { recursive: true })
  writeFileSync(
    store.path,
    JSON.stringify({ activeOrgId: orgId, accounts }, null, 2),
    'utf8'
  )
  try {
    chmodSync(store.path, 0o600)
  } catch {
    // Best effort on filesystems that do not support POSIX modes.
  }
  return authStatus()
}

export function authStatus() {
  const resolved = resolveCredential()
  const scopes = normalizeScopes(resolved.account?.scopes)
  const serviceAccounts = resolved.accounts || []
  const authenticated = Boolean(
    resolved.account?.clientId && resolved.account?.clientSecret
  )

  return {
    authenticated,
    source: resolved.source,
    organizationId: resolved.orgId || null,
    organizationName: resolved.account?.orgName || null,
    clientIdHint: maskClientId(resolved.account?.clientId),
    scopes,
    // The current Voidr MCP contract treats an empty/legacy scope list as
    // read-only. Only write must be explicit.
    canRead: authenticated,
    canWrite: authenticated && scopes.includes('write'),
    scopeStatus: scopes.length ? 'known' : 'legacy-read-only',
    // `accounts` is preserved for compatibility with the Playwright framework.
    accounts: serviceAccounts,
    serviceAccounts,
    serviceAccountSelectionRequired: serviceAccounts.length > 1,
    credentialStore: resolved.path || null,
    credentialStoreInvalid: resolved.invalid === true
  }
}

export function basicAuthorizationHeader() {
  const resolved = resolveCredential()
  const { clientId, clientSecret } = resolved.account || {}
  if (!clientId || !clientSecret) {
    throw new Error(
      'Voidr authentication is not configured. Provision a Service Account; do not paste its secret into chat.'
    )
  }
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
}

function normalizeScopes(scopes) {
  if (!Array.isArray(scopes)) return []
  return [...new Set(scopes.map(String).map(value => value.toLowerCase()))]
}

function parseScopes(value) {
  if (!value) return []
  return value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}

function maskClientId(clientId) {
  if (!clientId) return null
  const value = String(clientId)
  if (value.length <= 8) return `${value.slice(0, 2)}…`
  return `${value.slice(0, 6)}…${value.slice(-4)}`
}
