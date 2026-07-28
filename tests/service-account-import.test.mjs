import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import {
  importServiceAccount,
  prepareServiceAccountImport
} from '../scripts/lib/service-account-import.mjs'

test('opens a protected JSON and imports a writable Service Account', async t => {
  const clientId = 'sa_synthetic_json_import'
  const clientSecret = 'synthetic-json-import-secret'
  const token = jwt({
    organizationId: 'org-json-import',
    name: 'Copilot JSON Writer',
    scopes: ['read', 'write']
  })
  const server = createServer(async (request, response) => {
    const body = JSON.parse(await readBody(request))
    if (
      body.grantType !== 'client_credentials' ||
      body.clientId !== clientId ||
      body.clientSecret !== clientSecret
    ) {
      response.writeHead(401)
      response.end()
      return
    }
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ access_token: token }))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => server.close())

  const temp = mkdtempSync(join(tmpdir(), 'voidr-sa-import-'))
  const importPath = join(temp, 'copilot-service-account.json')
  const storePath = join(temp, 'service-accounts.json')
  const restore = setEnvironment({
    VOIDR_SERVICE_ACCOUNT_IMPORT_PATH: importPath,
    VOIDR_SERVICE_ACCOUNTS_PATH: storePath,
    VOIDR_TOKEN_URL: `http://127.0.0.1:${server.address().port}/token`,
    VOIDR_DISABLE_EDITOR_OPEN: '1'
  })
  t.after(restore)

  const prepared = await prepareServiceAccountImport()
  assert.equal(prepared.prepared, true)
  assert.equal(prepared.opened, false)
  assert.equal(prepared.path, importPath)
  assert.deepEqual(JSON.parse(readFileSync(importPath, 'utf8')), {
    clientId: '',
    clientSecret: ''
  })
  if (process.platform !== 'win32') {
    assert.equal(statSync(importPath).mode & 0o777, 0o600)
  }

  writeFileSync(
    importPath,
    JSON.stringify({ clientId, clientSecret }, null, 2),
    'utf8'
  )
  const imported = await importServiceAccount()
  assert.equal(imported.connected, true)
  assert.equal(imported.organizationId, 'org-json-import')
  assert.equal(imported.serviceAccountName, 'Copilot JSON Writer')
  assert.equal(imported.canWrite, true)
  assert.equal(JSON.stringify(imported).includes(clientSecret), false)
  assert.equal(existsSync(importPath), false)

  const store = JSON.parse(readFileSync(storePath, 'utf8'))
  assert.equal(store.activeOrgId, 'org-json-import')
  assert.equal(
    store.accounts['org-json-import'].clientSecret,
    clientSecret
  )
  assert.equal(
    store.accounts['org-json-import'].accountName,
    'Copilot JSON Writer'
  )
})

test('keeps an incomplete protected JSON for correction', async t => {
  const temp = mkdtempSync(join(tmpdir(), 'voidr-sa-import-empty-'))
  const importPath = join(temp, 'copilot-service-account.json')
  const restore = setEnvironment({
    VOIDR_SERVICE_ACCOUNT_IMPORT_PATH: importPath,
    VOIDR_SERVICE_ACCOUNTS_PATH: join(temp, 'service-accounts.json'),
    VOIDR_DISABLE_EDITOR_OPEN: '1'
  })
  t.after(restore)

  await prepareServiceAccountImport()
  await assert.rejects(
    importServiceAccount(),
    /Fill clientId and clientSecret/
  )
  assert.equal(existsSync(importPath), true)
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

async function readBody(request) {
  let body = ''
  for await (const chunk of request) body += chunk
  return body
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
