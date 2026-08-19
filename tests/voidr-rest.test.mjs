import test from 'node:test'
import assert from 'node:assert/strict'
import { VoidrRestClient } from '../scripts/lib/voidr-rest.mjs'

function jsonResponse(status, body = '') {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body))
  }
}

test('the platform is called with the Service Account bearer token', async () => {
  const calls = []
  const client = new VoidrRestClient({
    url: 'https://api.example.test/v1',
    accessToken: async () => 'token-1',
    fetchImpl: async (url, options) => {
      calls.push({ url, options })
      return jsonResponse(201, { data: { _id: 'exec-1' } })
    }
  })

  const created = await client.post('/executions', { planId: 'p1' })

  assert.equal(calls[0].url, 'https://api.example.test/v1/executions')
  // Basic auth is not accepted by the platform: the credential pair has to be
  // exchanged for a token first.
  assert.equal(calls[0].options.headers.authorization, 'Bearer token-1')
  assert.equal(calls[0].options.headers['content-type'], 'application/json')
  assert.equal(created.data._id, 'exec-1')
})

test('a rejected token is refreshed once before giving up', async () => {
  const issued = []
  let attempt = 0
  const client = new VoidrRestClient({
    url: 'https://api.example.test/v1',
    accessToken: async () => {
      const token = `token-${issued.length + 1}`
      issued.push(token)
      return token
    },
    fetchImpl: async (_url, options) => {
      attempt += 1
      // The stale token is rejected; the fresh one is accepted.
      return options.headers.authorization === 'Bearer token-1'
        ? jsonResponse(401, 'expired')
        : jsonResponse(200, { ok: true })
    }
  })

  assert.deepEqual(await client.get('/test-plans/abc'), { ok: true })
  assert.equal(attempt, 2)
  assert.deepEqual(issued, ['token-1', 'token-2'])
})

test('a persistent rejection reports the credential, not the endpoint', async () => {
  const client = new VoidrRestClient({
    url: 'https://api.example.test/v1',
    accessToken: async () => 'token-1',
    fetchImpl: async () => jsonResponse(403, 'forbidden')
  })

  await assert.rejects(
    client.post('/executions', {}),
    /Service Account was rejected or lacks the required scope/
  )
})

test('a rejected payload keeps the platform explanation', async () => {
  const client = new VoidrRestClient({
    url: 'https://api.example.test/v1',
    accessToken: async () => 'token-1',
    fetchImpl: async () =>
      jsonResponse(400, { message: 'codebaseVersion must match /^[a-f0-9]{64}$/' })
  })

  await assert.rejects(client.post('/executions', {}), error => {
    assert.match(error.message, /HTTP 400/)
    assert.match(error.message, /codebaseVersion must match/)
    return true
  })
})
