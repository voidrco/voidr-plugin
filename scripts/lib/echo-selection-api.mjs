import { connectHumanWithBrowser } from './browser-auth.mjs'

const base = 'echo/scenario-selections'
const objectId = /^[a-f0-9]{24}$/
const idField = { type: 'string', pattern: '^[a-f0-9]{24}$' }
const textField = { type: 'string' }
const target = {
  type: 'object',
  properties: { moduleSlug: textField, suiteSlug: textField, testCaseSlug: textField },
  required: ['moduleSlug', 'suiteSlug', 'testCaseSlug'],
  additionalProperties: false
}
const judge = {
  oneOf: [
    { type: 'object', properties: { kind: { const: 'VOIDR_DEFAULT' } }, required: ['kind'], additionalProperties: false },
    { type: 'object', properties: { kind: { const: 'CUSTOM' }, profileId: idField, profileVersionId: idField },
      required: ['kind', 'profileId'], additionalProperties: false }
  ]
}
const publication = {
  type: 'object', additionalProperties: false,
  properties: { planId: idField, moduleSlug: textField, journeyFlowId: idField,
    journeyFlowVersion: { type: 'integer', minimum: 1 }, journeySpecChecksum: { type: 'string', pattern: '^[a-fA-F0-9]{64}$' } },
  required: ['planId', 'moduleSlug', 'journeyFlowId', 'journeyFlowVersion', 'journeySpecChecksum']
}
const scope = {
  type: 'object',
  properties: {
    applicationId: idField, planId: idField,
    targets: { type: 'array', items: target, minItems: 1, maxItems: 3000 },
    scenarioPersonaMode: { enum: ['RANDOM', 'ALL'] },
    personas: { type: 'array', minItems: 1, maxItems: 8, uniqueItems: true, items: {
      type: 'object', additionalProperties: false, properties: { personaId: idField }, required: ['personaId']
    } },
    chatTransport: { enum: ['autopilot_api', 'physical_device'] },
    physical: { type: 'object', additionalProperties: false, required: ['devices'], properties: {
      devices: { type: 'array', minItems: 1, maxItems: 20, uniqueItems: true, items: {
        type: 'object', additionalProperties: false, properties: { hostId: textField, udid: textField },
        required: ['hostId', 'udid']
      } },
      queueTimeoutMinutes: { type: 'integer', minimum: 1, maximum: 1440 }
    } },
    repetitions: { type: 'integer', minimum: 1, maximum: 8 },
    anis: { type: 'array', minItems: 1, maxItems: 64, items: { type: 'string', pattern: '^[0-9]{4,20}$' } },
    judgeProfileSelections: { type: 'array', maxItems: 5, items: judge },
    journeyVersionPolicy: { enum: ['LATEST_APPROVED', 'PINNED'] },
    journeyPublicationPins: { type: 'array', minItems: 1, maxItems: 100, items: publication }
  },
  required: ['applicationId', 'planId', 'targets'],
  additionalProperties: false
}
export const echoSelectionReadSchema = {
  type: 'object',
  properties: {
    operation: { enum: ['journeys', 'catalog', 'catalog_page', 'catalog_targets', 'list', 'get', 'preview', 'list_schedules', 'get_schedule', 'accounts', 'judge_profiles', 'personas', 'devices'] },
    applicationId: idField, planId: idField, moduleSlug: textField, environment: { type: 'string', minLength: 1, maxLength: 120 },
    moduleSlugs: { type: 'array', items: textField, minItems: 1, maxItems: 50 },
    chatTransport: { enum: ['autopilot_api', 'physical_device'] },
    id: idField, before: idField, page: { type: 'integer', minimum: 1 }, q: { type: 'string', maxLength: 80 }, limit: { type: 'integer', minimum: 1, maximum: 25 }, scope
  },
  required: ['operation', 'applicationId'], additionalProperties: false
}
export const echoSelectionWriteSchema = {
  type: 'object',
  properties: {
    operation: { enum: ['save', 'edit', 'delete', 'run', 'schedule', 'edit_schedule', 'toggle_schedule', 'delete_schedule'] },
    applicationId: idField, id: idField, scope,
    requestId: { type: 'string', format: 'uuid' },
    fingerprint: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    name: textField, revision: { type: 'integer', minimum: 1 },
    timezone: textField, cronExpression: textField, enabled: { type: 'boolean' }
  },
  required: ['operation', 'applicationId'], additionalProperties: false
}

function checkedScope(scope, applicationId) {
  if (!scope || scope.applicationId !== applicationId)
    throw new Error('The selection must belong to the selected application.')
  return scope
}

function requireId(value, field) {
  if (typeof value !== 'string' || !objectId.test(value)) throw new Error(`Select a valid ${field}.`)
  return value
}

export class EchoSelectionApi {
  #session = null
  #connect
  #fetch
  constructor({ connect = connectHumanWithBrowser, fetchImpl = globalThis.fetch } = {}) {
    this.#connect = connect
    this.#fetch = fetchImpl
  }

  async login() {
    this.#session = null
    const session = await this.#connect()
    this.#session = session
    return { organizationId: session.organizationId, organizationName: session.organization.name ?? null }
  }

  async request(method, path, body, { preserveEnvelope = false } = {}) {
    const session = this.#session
    if (!session) throw new Error('Use voidr_echo_selection_login to connect a Voidr user.')
    const response = await this.#fetch(`${session.apiUrl}/${path}`, {
      method, redirect: 'error',
      headers: {
        accept: 'application/json', authorization: `Bearer ${session.accessToken}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' })
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    })
    if (response.status === 401) {
      this.#session = null
      throw new Error('Voidr login expired. Reconnect and retry with the same request ID.')
    }
    const result = await response.json()
    if (!response.ok || result.success === false)
      throw new Error(result.error?.message ?? result.message ?? `Echo API returned HTTP ${response.status}.`)
    return preserveEnvelope ? result : (result.data ?? result)
  }

  async read(args) {
    const applicationId = requireId(args.applicationId, 'application')
    const query = new URLSearchParams({ applicationId })
    switch (args.operation) {
      case 'journeys':
        return this.request('GET', `echo/journeys/evidence-catalog?${query}`)
      case 'accounts':
        return this.request('GET', `echo/chat-api/accounts?${query}`)
      case 'judge_profiles':
        return this.request('GET', `echo/applications/${applicationId}/judge-profiles`)
      case 'devices':
        if (args.environment) query.set('environment', args.environment)
        return this.request('GET', `echo/physical/devices?${query}`)
      case 'personas': {
        if (args.page) query.set('page', String(args.page))
        query.set('limit', String(args.limit ?? 20))
        const result = await this.request('GET', `echo/personas?${query}`, undefined, { preserveEnvelope: true })
        const { data, total, page, pages, limit } = result
        return { items: data.map(({ _id, name, slug }) => ({ _id, name, slug })), total, page, pages, limit }
      }
      case 'catalog_page':
      case 'catalog_targets':
        query.set('planId', requireId(args.planId, 'plan'))
        if (!args.moduleSlug) throw new Error('Select a journey for the catalog page.')
        query.set('moduleSlug', args.moduleSlug)
        if (args.q) query.set('q', args.q)
        if (args.page) query.set('page', String(args.page))
        if (args.chatTransport) query.set('chatTransport', args.chatTransport)
        const path = args.operation === 'catalog_page' ? 'page' : 'targets'
        return this.request('GET', `${base}/catalog/${path}?${query}`)
      case 'catalog':
        query.set('planId', requireId(args.planId, 'plan'))
        if (Array.isArray(args.moduleSlugs)) query.set('moduleSlugs', args.moduleSlugs.join(','))
        else query.set('moduleSlug', args.moduleSlug ?? '')
        return this.request('GET', `${base}/catalog?${query}`)
      case 'list':
        if (args.limit) query.set('limit', String(args.limit))
        if (args.q) query.set('q', args.q)
        if (args.before) query.set('before', requireId(args.before, 'cursor'))
        return this.request('GET', `${base}?${query}`)
      case 'get':
        return this.request('GET', `${base}/${requireId(args.id, 'selection')}?${query}`)
      case 'preview':
        return this.request('POST', `${base}/preview`, checkedScope(args.scope, applicationId))
      case 'list_schedules':
        query.set('view', 'summary')
        if (args.limit) query.set('limit', String(args.limit))
        if (args.q) query.set('q', args.q)
        if (args.page) query.set('page', String(args.page))
        return this.request('GET', `echo/schedules?${query}`)
      case 'get_schedule':
        return this.getSchedule(applicationId, args.id)
      default:
        throw new Error('Unknown Echo selection read operation.')
    }
  }

  async getSchedule(applicationId, id) {
    const schedule = await this.request('GET', `echo/schedules/${requireId(id, 'schedule')}`)
    if (schedule.applicationId !== applicationId || schedule.provider !== 'VOICE')
      throw new Error('Select an Echo schedule belonging to the selected application.')
    return schedule
  }

  async write(args) {
    const applicationId = requireId(args.applicationId, 'application')
    const { requestId, fingerprint, name, revision, cronExpression, timezone, enabled } = args
    const selected = () => checkedScope(args.scope, applicationId)
    const query = new URLSearchParams({ applicationId })
    switch (args.operation) {
      case 'save':
        return this.request('POST', base, { scope: selected(), name, requestId })
      case 'edit':
        return this.request('PATCH', `${base}/${requireId(args.id, 'selection')}`, { scope: selected(), name, revision })
      case 'delete':
        return this.request('DELETE', `${base}/${requireId(args.id, 'selection')}?${query}`)
      case 'run':
        return this.request('POST', `${base}/run`, { scope: selected(), requestId, fingerprint, name })
      case 'schedule':
        return this.request('POST', `${base}/schedules`, { scope: selected(), requestId, fingerprint, name, cronExpression, timezone, enabled })
      case 'edit_schedule':
        return this.request('PATCH', `${base}/schedules/${requireId(args.id, 'schedule')}`, {
          scope: selected(), fingerprint, name, cronExpression, timezone
        })
      case 'toggle_schedule':
      case 'delete_schedule': {
        const id = requireId(args.id, 'schedule')
        await this.getSchedule(applicationId, id)
        return args.operation === 'toggle_schedule'
          ? this.request('PATCH', `echo/schedules/${id}/toggle`, { enabled })
          : this.request('DELETE', `echo/schedules/${id}`)
      }
      default:
        throw new Error('Unknown Echo selection write operation.')
    }
  }
}
