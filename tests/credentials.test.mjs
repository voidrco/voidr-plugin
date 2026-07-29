import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  authStatus,
  basicAuthorizationHeader,
  credentialsPath,
  selectOrganization,
  validatedAuthStatus
} from '../scripts/lib/credentials.mjs'

test('isolates non-production credentials by profile', () => {
  const previousPath = process.env.VOIDR_SERVICE_ACCOUNTS_PATH
  const previousProfile = process.env.VOIDR_CREDENTIAL_PROFILE
  delete process.env.VOIDR_SERVICE_ACCOUNTS_PATH
  process.env.VOIDR_CREDENTIAL_PROFILE = 'Release Outside Repo Creation'
  try {
    assert.equal(
      credentialsPath(),
      join(
        homedir(),
        '.voidr',
        'service-accounts.release-outside-repo-creation.json'
      )
    )
  } finally {
    if (previousPath === undefined) {
      delete process.env.VOIDR_SERVICE_ACCOUNTS_PATH
    } else {
      process.env.VOIDR_SERVICE_ACCOUNTS_PATH = previousPath
    }
    if (previousProfile === undefined) {
      delete process.env.VOIDR_CREDENTIAL_PROFILE
    } else {
      process.env.VOIDR_CREDENTIAL_PROFILE = previousProfile
    }
  }
})

test('reuses the framework Service Account store without exposing secrets', () => {
  const dir = mkdtempSync(join(tmpdir(), 'voidr-auth-'))
  const storePath = join(dir, 'service-accounts.json')
  const secret = 'synthetic-test-secret-never-log'
  writeFileSync(
    storePath,
    JSON.stringify({
      activeOrgId: 'org-a',
      accounts: {
        'org-a': {
          clientId: 'sa_synthetic_org_a',
          clientSecret: secret,
          orgName: 'Acme QA',
          accountName: 'Copilot Writer',
          scopes: ['read', 'write']
        },
        'org-b': {
          clientId: 'sa_synthetic_org_b',
          clientSecret: 'synthetic-second-secret',
          orgName: 'Beta QA',
          scopes: ['read']
        }
      }
    })
  )

  const previous = process.env.VOIDR_SERVICE_ACCOUNTS_PATH
  process.env.VOIDR_SERVICE_ACCOUNTS_PATH = storePath
  try {
    const status = authStatus()
    assert.equal(status.authenticated, true)
    assert.equal(status.organizationId, 'org-a')
    assert.equal(status.canWrite, true)
    assert.equal(status.serviceAccountSelectionRequired, true)
    assert.equal(status.serviceAccounts.length, 2)
    assert.equal(status.serviceAccounts[0].accountName, 'Copilot Writer')
    assert.equal(status.serviceAccounts[0].selected, true)
    assert.equal(status.serviceAccounts[0].canWrite, true)
    assert.equal(JSON.stringify(status).includes(secret), false)

    const header = basicAuthorizationHeader()
    assert.match(header, /^Basic /)
    assert.equal(header.includes(secret), false)

    const selected = selectOrganization('org-b')
    assert.equal(selected.orgId, 'org-b')
    assert.equal(authStatus().canWrite, false)
    assert.equal(
      JSON.parse(readFileSync(storePath, 'utf8')).activeOrgId,
      'org-b'
    )
  } finally {
    if (previous === undefined) delete process.env.VOIDR_SERVICE_ACCOUNTS_PATH
    else process.env.VOIDR_SERVICE_ACCOUNTS_PATH = previous
  }
})

test('reports an empty isolated store as no configured Service Account', () => {
  const dir = mkdtempSync(join(tmpdir(), 'voidr-auth-empty-'))
  const storePath = join(dir, 'missing-service-accounts.json')
  const previous = process.env.VOIDR_SERVICE_ACCOUNTS_PATH
  const previousClientId = process.env.VOIDR_CLIENT_ID
  const previousClientSecret = process.env.VOIDR_CLIENT_SECRET
  process.env.VOIDR_SERVICE_ACCOUNTS_PATH = storePath
  delete process.env.VOIDR_CLIENT_ID
  delete process.env.VOIDR_CLIENT_SECRET
  try {
    const status = authStatus()
    assert.equal(status.authenticated, false)
    assert.equal(status.canRead, false)
    assert.equal(status.canWrite, false)
    assert.deepEqual(status.serviceAccounts, [])
    assert.equal(status.serviceAccountSelectionRequired, false)
  } finally {
    if (previous === undefined) delete process.env.VOIDR_SERVICE_ACCOUNTS_PATH
    else process.env.VOIDR_SERVICE_ACCOUNTS_PATH = previous
    if (previousClientId === undefined) delete process.env.VOIDR_CLIENT_ID
    else process.env.VOIDR_CLIENT_ID = previousClientId
    if (previousClientSecret === undefined) delete process.env.VOIDR_CLIENT_SECRET
    else process.env.VOIDR_CLIENT_SECRET = previousClientSecret
  }
})

test('reports a missing write scope without guessing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'voidr-auth-scope-'))
  const storePath = join(dir, 'service-accounts.json')
  writeFileSync(
    storePath,
    JSON.stringify({
      activeOrgId: 'org-read-only',
      accounts: {
        'org-read-only': {
          clientId: 'sa_read_only',
          clientSecret: 'synthetic-read-secret',
          scopes: []
        }
      }
    })
  )

  const previous = process.env.VOIDR_SERVICE_ACCOUNTS_PATH
  process.env.VOIDR_SERVICE_ACCOUNTS_PATH = storePath
  try {
    const status = authStatus()
    assert.equal(status.authenticated, true)
    assert.equal(status.canRead, true)
    assert.equal(status.canWrite, false)
    assert.equal(status.scopeStatus, 'legacy-read-only')
  } finally {
    if (previous === undefined) delete process.env.VOIDR_SERVICE_ACCOUNTS_PATH
    else process.env.VOIDR_SERVICE_ACCOUNTS_PATH = previous
  }
})

test('live status reports a deleted or revoked local account as rejected', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'voidr-auth-rejected-'))
  const storePath = join(dir, 'service-accounts.json')
  const secret = 'synthetic-rejected-secret'
  writeFileSync(
    storePath,
    JSON.stringify({
      activeOrgId: 'org-rejected',
      accounts: {
        'org-rejected': {
          clientId: 'sa_rejected',
          clientSecret: secret,
          scopes: ['read', 'write']
        }
      }
    })
  )
  const previous = process.env.VOIDR_SERVICE_ACCOUNTS_PATH
  process.env.VOIDR_SERVICE_ACCOUNTS_PATH = storePath
  try {
    const status = await validatedAuthStatus({
      fetchImpl: async (_url, options) => {
        assert.equal(options.body.includes(secret), true)
        return new Response(null, { status: 401 })
      }
    })
    assert.equal(status.authenticated, false)
    assert.equal(status.canRead, false)
    assert.equal(status.canWrite, false)
    assert.equal(status.localCredentialPresent, true)
    assert.equal(status.validationStatus, 'rejected')
    assert.equal(JSON.stringify(status).includes(secret), false)
  } finally {
    if (previous === undefined) delete process.env.VOIDR_SERVICE_ACCOUNTS_PATH
    else process.env.VOIDR_SERVICE_ACCOUNTS_PATH = previous
  }
})

test('live status trusts scopes from the validated token', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'voidr-auth-live-scope-'))
  const storePath = join(dir, 'service-accounts.json')
  writeFileSync(
    storePath,
    JSON.stringify({
      activeOrgId: 'org-live',
      accounts: {
        'org-live': {
          clientId: 'sa_live',
          clientSecret: 'synthetic-live-secret',
          scopes: ['read', 'write']
        }
      }
    })
  )
  const previous = process.env.VOIDR_SERVICE_ACCOUNTS_PATH
  process.env.VOIDR_SERVICE_ACCOUNTS_PATH = storePath
  try {
    const status = await validatedAuthStatus({
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            access_token: jwt({
              organizationId: 'org-live',
              scopes: ['read']
            })
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' }
          }
        )
    })
    assert.equal(status.validationStatus, 'valid')
    assert.equal(status.authenticated, true)
    assert.equal(status.canWrite, false)
    assert.deepEqual(status.scopes, ['read'])
  } finally {
    if (previous === undefined) delete process.env.VOIDR_SERVICE_ACCOUNTS_PATH
    else process.env.VOIDR_SERVICE_ACCOUNTS_PATH = previous
  }
})

function jwt(payload) {
  return [
    Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString(
      'base64url'
    ),
    Buffer.from(JSON.stringify(payload)).toString('base64url'),
    'synthetic-signature'
  ].join('.')
}
