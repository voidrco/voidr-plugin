import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EchoSelectionApi } from '../scripts/lib/echo-selection-api.mjs'

test('uses human authentication and keeps schedule writes separate from dispatch', async () => {
  const applicationId = 'a'.repeat(24)
  const planId = 'b'.repeat(24)
  const scope = { applicationId, planId, targets: [{ moduleSlug: 'journey', suiteSlug: 'suite', testCaseSlug: 'case' }],
    scenarioPersonaMode: 'ALL', repetitions: 2, anis: ['551199990000'],
    judgeProfileSelections: [{ kind: 'VOIDR_DEFAULT' }], journeyVersionPolicy: 'PINNED' }
  const calls = []
  const client = new EchoSelectionApi({
    connect: async () => ({ accessToken: 'test-token', apiUrl: 'http://127.0.0.1:9999/v1',
      organizationId: 'fixture-org', organization: { name: 'Fixture' } }),
    fetchImpl: async (url, options) => {
      calls.push({ url, method: options.method, auth: options.headers.authorization, body: JSON.parse(options.body) })
      return Response.json({ success: true, data: { _id: 'schedule' } })
    }
  })
  await assert.rejects(client.read({ operation: 'preview', applicationId, scope }), /connect a Voidr user/)
  assert.deepEqual(await client.login(), { organizationId: 'fixture-org', organizationName: 'Fixture' })
  await assert.rejects(client.read({ operation: 'preview', applicationId: 'c'.repeat(24), scope }), /selected application/)
  await client.read({ operation: 'preview', applicationId, scope })
  const args = { operation: 'schedule', applicationId, scope, name: 'My schedule',
    requestId: '329c823b-51c0-4cc1-b4cf-a835a3dddf5f', fingerprint: 'd'.repeat(64),
    timezone: 'America/Sao_Paulo', cronExpression: '0 9 * * *', enabled: false }
  assert.deepEqual(await client.write(args), { _id: 'schedule' })
  assert.equal(calls.length, 2)
  assert.match(calls[0].url, /scenario-selections\/preview$/)
  assert.match(calls[1].url, /scenario-selections\/schedules$/)
  assert.equal(calls[1].auth, 'Bearer test-token')
  assert.equal(calls[1].body.enabled, false)
  assert.equal(calls[1].body.requestId, args.requestId)
  assert.deepEqual(calls[0].body, scope)
  assert.deepEqual(calls[1].body.scope, scope)
  await client.write({ ...args, operation: 'run' })
  assert.match(calls[2].url, /scenario-selections\/run$/)
  assert.deepEqual(calls[2].body.scope, scope)
  assert.equal(calls[2].body.name, args.name)
})

test('reads large catalogs and named groups without a whole-catalog fetch', async () => {
  const applicationId = 'a'.repeat(24)
  const planId = 'b'.repeat(24)
  const requests = []
  const client = new EchoSelectionApi({
    connect: async () => ({ accessToken:'local', apiUrl:'http://127.0.0.1:9999/v1',
      organizationId:'fixture', organization:{ name:'Fixture' } }),
    fetchImpl: async (url) => {
      requests.push(new URL(url))
      return Response.json({ success:true, data:{ items:[] } })
    }
  })
  await client.login()
  await client.read({ operation:'catalog_page', applicationId, planId, moduleSlug:'roaming', q:'Saldo [local]', page:2 })
  await client.read({ operation:'list', applicationId, q:'Grupo de teste', limit:10 })
  assert.equal(requests[0].pathname, '/v1/echo/scenario-selections/catalog/page')
  assert.equal(requests[0].searchParams.get('q'), 'Saldo [local]')
  assert.equal(requests[0].searchParams.get('page'), '2')
  assert.equal(requests[1].searchParams.get('limit'), '10')
  assert.equal(requests[1].searchParams.get('q'), 'Grupo de teste')
})

test('discovers manual personas and staff devices and requests compact schedule rows', async () => {
  const applicationId = 'a'.repeat(24)
  const planId = 'b'.repeat(24)
  const requests = []
  const client = new EchoSelectionApi({
    connect: async () => ({
      accessToken: 'local', apiUrl: 'http://127.0.0.1:9999/v1',
      organizationId: 'fixture', organization: { name: 'Fixture' }
    }),
    fetchImpl: async (url) => {
      const request = new URL(url)
      requests.push(request)
      return Response.json(request.pathname.endsWith('/personas')
        ? { success: true, data: [{ _id: 'p1', name: 'Rafael', slug: 'rafael', extra: 'unused' }], total: 2, page: 2, pages: 2, limit: 1 }
        : { success: true, data: [] })
    }
  })
  await client.login()
  assert.deepEqual(await client.read({ operation: 'personas', applicationId, page: 2, limit: 1 }), {
    items: [{ _id: 'p1', name: 'Rafael', slug: 'rafael' }], total: 2, page: 2, pages: 2, limit: 1
  })
  await client.read({ operation: 'devices', applicationId, environment: 'qa' })
  await client.read({ operation: 'catalog_targets', applicationId, planId, moduleSlug: 'roaming', chatTransport: 'physical_device' })
  await client.read({ operation: 'list_schedules', applicationId, page: 2 })
  assert.deepEqual(requests.map((request) => request.pathname), [
    '/v1/echo/personas', '/v1/echo/physical/devices',
    '/v1/echo/scenario-selections/catalog/targets', '/v1/echo/schedules'
  ])
  assert(requests.every((request) => request.searchParams.get('applicationId') === applicationId))
  assert.equal(requests[0].searchParams.get('page'), '2')
  assert.equal(requests[1].searchParams.get('environment'), 'qa')
  assert.equal(requests[2].searchParams.get('chatTransport'), 'physical_device')
  assert.equal(requests[3].searchParams.get('view'), 'summary')
})
