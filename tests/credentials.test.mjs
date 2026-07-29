import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  authStatus,
  basicAuthorizationHeader,
  selectOrganization
} from '../scripts/lib/credentials.mjs'

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
