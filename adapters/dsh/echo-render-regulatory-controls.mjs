import { createHash } from 'node:crypto'
import { echoDeviationsSchema, validateEchoDeviationsFilters } from './echo-render-deviations.mjs'

export const echoRegulatoryReportSchema = echoDeviationsSchema

function readEnvelope(result) {
  if (result?.isError) throw new Error('Regulatory query failed; no report was published')
  const text = result?.content?.find(item => item.type === 'text')?.text
  const envelope = result?.structuredContent?.data ?? (text ? JSON.parse(text) : null)
  if (!envelope?.data || envelope.data.available === false) {
    throw new Error('Regulatory results unavailable; no report was published')
  }
  return envelope
}

function count(value) {
  return Number.isSafeInteger(value) && value >= 0
}

function tableRows(controls) {
  const ids = new Set()
  return controls.map(control => {
    if (typeof control.stableId !== 'string' || !control.stableId || ids.has(control.stableId) ||
      typeof control.title !== 'string' || !control.title ||
      !count(control.nonCompliantSessions) || !count(control.criticalNonCompliantSessions) ||
      control.criticalNonCompliantSessions > control.nonCompliantSessions ||
      (control.inconclusiveSessions != null && !count(control.inconclusiveSessions))) {
      throw new Error('Invalid regulatory control row; no report was published')
    }
    ids.add(control.stableId)
    const citation = typeof control.regulatoryCitationLabel === 'string' && control.regulatoryCitationLabel.trim()
      ? ` (${control.regulatoryCitationLabel.trim()})` : ''
    return [
      control.title + citation,
      String(control.nonCompliantSessions),
      String(control.criticalNonCompliantSessions),
      control.inconclusiveSessions == null ? 'Indisponível' : String(control.inconclusiveSessions)
    ]
  })
}

export function registerEchoRenderRegulatoryControls(ctx, callEchoTool) {
  ctx.tools.register({
    name: 'echo_render_regulatory_controls',
    description: 'Publish the complete observed Echo regulatory-violation control list as a read-only table. Supply only the selected application and exact interval; the signed Echo screen context fixes Journey scope. This tool calls the canonical Service aggregate and constructs rows in code, so never supply rows or rewrite the table in prose. Missing evaluation coverage remains distinct from complete control-row pagination.',
    parameters: echoRegulatoryReportSchema,
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        widgetId: { type: 'string' }, controlsRendered: { type: 'integer' },
        controlsTotal: { type: 'integer' }, violationOccurrences: { type: 'integer' },
        criticalOccurrences: { type: 'integer' }, affectedSessions: { type: 'integer' },
        coverage: { type: 'object' }, asOf: { type: 'string' }, consistency: { type: 'string' },
        mostRecurrentControls: { type: 'array', items: { type: 'object' } },
        mostCriticalControls: { type: 'array', items: { type: 'object' } }
      }, required: ['widgetId', 'controlsRendered', 'controlsTotal', 'violationOccurrences',
        'criticalOccurrences', 'affectedSessions', 'coverage', 'asOf', 'consistency',
        'mostRecurrentControls', 'mostCriticalControls'] },
      render: (_args, value) => [{ type: 'text', text: `Published a read-only regulatory table with ${value.controlsRendered} of ${value.controlsTotal} observed violated controls. The rows were copied from the Service in code; do not recreate, shorten or renumber them in prose. Violation occurrences: ${value.violationOccurrences}; critical occurrences: ${value.criticalOccurrences}; affected sessions: ${value.affectedSessions}. Most recurrent: ${JSON.stringify(value.mostRecurrentControls)}. Most critical: ${JSON.stringify(value.mostCriticalControls)}. As of ${value.asOf}; consistency: ${value.consistency}. Coverage: ${JSON.stringify(value.coverage)}. Complete control rows do not mean every selected session had readable evaluation.` }]
    },
    execute: async (args, exec) => {
      const filters = validateEchoDeviationsFilters(args)
      const controls = []
      let first
      let page = 1
      while (true) {
        if (exec.signal?.aborted) throw new Error('Report cancelled before publication')
        const envelope = readEnvelope(await callEchoTool(exec.agent, 'echo_summarize_regulatory_controls', {
          ...filters, outcome: 'NON_COMPLIANT', page, limit: 100
        }, exec.signal))
        const data = envelope.data
        const pagination = data.pagination
        if (!Array.isArray(data.controls) || !pagination || pagination.page !== page ||
          !count(pagination.total) || typeof pagination.hasMore !== 'boolean' ||
          pagination.outcome !== 'NON_COMPLIANT') {
          throw new Error('Invalid regulatory pagination; no report was published')
        }
        if (!first) first = envelope
        if (pagination.total !== first.data.pagination.total ||
          data.totals?.distinctNonCompliantControls !== first.data.totals?.distinctNonCompliantControls) {
          throw new Error('Regulatory totals changed during pagination; no report was published')
        }
        controls.push(...data.controls)
        if (!pagination.hasMore) break
        if (!Number.isSafeInteger(pagination.nextPage) || pagination.nextPage <= page ||
          pagination.nextPage > 1000 || controls.length >= pagination.total) {
          throw new Error('Invalid regulatory continuation; no report was published')
        }
        page = pagination.nextPage
      }
      const data = first.data
      const total = data.pagination.total
      if (controls.length !== total || total !== data.totals?.distinctNonCompliantControls ||
        !count(data.totals?.nonCompliantOccurrences) ||
        !count(data.totals?.criticalNonCompliantOccurrences) ||
        !count(data.affectedSessions?.nonCompliant) ||
        !data.coverage || typeof data.coverage !== 'object' ||
        typeof first.asOf !== 'string' || typeof data.consistency !== 'string') {
        throw new Error('Incomplete regulatory report; no table was published')
      }
      const rows = tableRows(controls)
      const violations = controls.reduce((sum, control) => sum + control.nonCompliantSessions, 0)
      const critical = controls.reduce((sum, control) => sum + control.criticalNonCompliantSessions, 0)
      if (violations !== data.totals.nonCompliantOccurrences ||
        critical !== data.totals.criticalNonCompliantOccurrences) {
        throw new Error('Regulatory row totals do not reconcile; no table was published')
      }
      const maxViolations = Math.max(0, ...controls.map(control => control.nonCompliantSessions))
      const maxCritical = Math.max(0, ...controls.map(control => control.criticalNonCompliantSessions))
      const mostRecurrentControls = controls
        .filter(control => control.nonCompliantSessions === maxViolations && maxViolations > 0)
        .map(control => ({ stableId: control.stableId, title: control.title,
          nonCompliantSessions: control.nonCompliantSessions }))
      const mostCriticalControls = controls
        .filter(control => control.criticalNonCompliantSessions === maxCritical && maxCritical > 0)
        .map(control => ({ stableId: control.stableId, title: control.title,
          criticalNonCompliantSessions: control.criticalNonCompliantSessions }))
      if (exec.signal?.aborted) throw new Error('Report cancelled before publication')
      const widgetId = 'echo-regulatory-' + createHash('sha256')
        .update(JSON.stringify({ filters, asOf: first.asOf, controls })).digest('hex').slice(0, 20)
      exec.agent.session.append('voidr/widget', { widget: {
        id: widgetId, version: 2, capability: 'voidr-assistant',
        title: `${total} controles com violação observados`, interactive: false, status: 'resolved',
        spec: { root: 'report', elements: { report: { type: 'Table', props: {
          columns: [
            { header: 'Controle' }, { header: 'Violações', align: 'right' },
            { header: 'Críticas', align: 'right' }, { header: 'Inconclusivas', align: 'right' }
          ],
          rows
        } } } }
      } })
      return {
        widgetId, controlsRendered: rows.length, controlsTotal: total,
        violationOccurrences: violations, criticalOccurrences: critical,
        affectedSessions: data.affectedSessions.nonCompliant, coverage: data.coverage,
        asOf: first.asOf, consistency: data.consistency,
        mostRecurrentControls, mostCriticalControls
      }
    }
  })
}
