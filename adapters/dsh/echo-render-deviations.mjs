import { createHash } from 'node:crypto'

export const echoDeviationsSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    applicationId: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' },
    occurredFrom: { type: 'string', format: 'date-time', description: 'Inclusive start, with timezone offset.' },
    occurredToExclusive: { type: 'string', format: 'date-time', description: 'Exclusive end, with timezone offset.' },
    timezone: { type: 'string', description: 'Display timezone; defaults to America/Sao_Paulo.' },
    environment: { type: 'string', minLength: 1, maxLength: 200 }
  },
  required: ['applicationId', 'occurredFrom', 'occurredToExclusive']
}

export function validateEchoDeviationsFilters(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args) ||
    Object.keys(args).some(key => !Object.hasOwn(echoDeviationsSchema.properties, key))) {
    throw new Error('Use only applicationId, occurredFrom, occurredToExclusive, timezone and environment. Do not supply rows, spec, SQL, URLs or organizationId.')
  }
  if (!/^[a-f\d]{24}$/i.test(args.applicationId ?? '')) throw new Error('applicationId must be an ObjectId')
  for (const key of ['occurredFrom', 'occurredToExclusive']) {
    if (typeof args[key] !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(args[key]) || !Number.isFinite(Date.parse(args[key]))) {
      throw new Error(key + ' must be an ISO timestamp with timezone offset')
    }
  }
  if (Date.parse(args.occurredFrom) >= Date.parse(args.occurredToExclusive)) throw new Error('The interval must have a start before its exclusive end')
  if (args.environment !== undefined && (typeof args.environment !== 'string' || !args.environment.trim() || args.environment.length > 200)) throw new Error('Invalid environment')
  const timezone = args.timezone ?? 'America/Sao_Paulo'
  if (typeof timezone !== 'string' || !timezone.trim() || timezone.length > 64) throw new Error('Invalid timezone')
  try { new Intl.DateTimeFormat('pt-BR', { timeZone: timezone }).format(0) } catch { throw new Error('Invalid timezone') }
  return { applicationId: args.applicationId, occurredFrom: new Date(args.occurredFrom).toISOString(),
    occurredToExclusive: new Date(args.occurredToExclusive).toISOString(), timezone,
    ...(args.environment !== undefined ? { environment: args.environment } : {}) }
}

export function registerEchoRenderDeviations(ctx, callEchoTool) {
  ctx.tools.register({
    name: 'echo_render_deviations',
    description: 'Show all Echo deviation records for an application and exact interval in a read-only paginated table. Supply filters only, never rows or widget JSON. Queries the authenticated Service and publishes a widget whose pages load directly from it. Use this for listing deviations instead of manually copying every page into render_widget. This does not perform causal analysis or ask for a selection.',
    parameters: echoDeviationsSchema,
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        widgetId: { type: 'string' }, total: { type: 'integer' }, pageSize: { type: 'integer' },
        pages: { type: 'integer' }, queriedAt: { type: 'string' }
      }, required: ['widgetId', 'total', 'pageSize', 'pages', 'queriedAt'] },
      render: (_args, value) => [{ type: 'text', text: `Published a read-only paginated deviations widget. Query found ${value.total} records, ${value.pages} pages of up to ${value.pageSize}. The UI loads pages with the viewer's current authorization. This confirms publication, not browser rendering or analysis of every record. Do not copy the rows or ask for a selection. Counts are live within the fixed interval.` }]
    },
    execute: async (args, exec) => {
      const filters = validateEchoDeviationsFilters(args)
      const { timezone, ...query } = filters
      const response = await callEchoTool(exec.agent, 'echo_list_deviations', { ...query, page: 1, limit: 20, sort: 'recent' }, exec.signal)
      const envelope = response.structuredContent?.data ?? JSON.parse(response.content.find(item => item.type === 'text').text)
      const page = envelope?.data
      if (!Array.isArray(page?.data) || !Number.isSafeInteger(page.total) || page.total < 0 ||
        !Number.isSafeInteger(page.pages) || page.pages < 0 || envelope.completeness?.complete === false) {
        throw new Error('Incomplete or invalid deviation query response; no report was published')
      }
      if (exec.signal?.aborted) throw new Error('Report cancelled before publication')
      const widgetId = 'echo-deviations-' + createHash('sha256').update(JSON.stringify(filters)).digest('hex').slice(0,20)
      exec.agent.session.append('voidr/widget', { widget: {
        id: widgetId, version: 2, capability: 'voidr-assistant', title: 'Desvios no período',
        interactive: false, status: 'resolved',
        spec: { root: 'report', elements: { report: { type: 'EchoDeviationsTable', props: filters } } }
      } })
      return { widgetId, total: page.total, pages: page.pages, pageSize: 20, queriedAt: new Date().toISOString() }
    }
  })
}
