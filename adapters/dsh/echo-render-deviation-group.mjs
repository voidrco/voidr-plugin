import { createHash } from 'node:crypto'
import { echoDeviationsSchema, validateEchoDeviationsFilters } from './echo-render-deviations.mjs'

export const echoDeviationGroupReportSchema = {
  ...echoDeviationsSchema,
  properties: {
    ...echoDeviationsSchema.properties,
    group: { type: 'string', enum: ['improper_transfer'] }
  },
  required: [...echoDeviationsSchema.required, 'group']
}

function reportData(result) {
  if (result?.isError) throw new Error('Deviation group query failed; no report was published')
  const body = result?.structuredContent?.data ?? JSON.parse(result?.content?.find(item => item.type === 'text')?.text ?? 'null')
  if (!body?.data || body.completeness?.complete === false) {
    throw new Error('Deviation group result unavailable; no report was published')
  }
  return body
}

function validatedRows(data) {
  if (!Array.isArray(data.includedCodes) || !Array.isArray(data.byCode) ||
    data.includedCodes.length !== data.byCode.length ||
    !Number.isSafeInteger(data.totalRecords) || data.totalRecords < 0) {
    throw new Error('Incomplete deviation group totals; no report was published')
  }
  const seen = new Set()
  const rows = data.byCode.map((row, index) => {
    if (typeof row.code !== 'string' || row.code !== data.includedCodes[index] ||
      seen.has(row.code) || !Number.isSafeInteger(row.records) || row.records < 0) {
      throw new Error('Invalid deviation group row; no report was published')
    }
    seen.add(row.code)
    return [row.code, String(row.records)]
  })
  if (data.byCode.reduce((total, row) => total + row.records, 0) !== data.totalRecords) {
    throw new Error('Deviation group totals do not reconcile; no report was published')
  }
  return rows
}

export function registerEchoRenderDeviationGroup(ctx, callEchoTool) {
  ctx.tools.register({
    name: 'echo_render_deviation_group',
    description: 'Publish a read-only table of the versioned improper-transfer deviation group. Supply only the group, selected application and exact interval; the signed Echo screen context fixes Journey scope. The Service counts records and this tool validates and renders the rows without model arithmetic.',
    parameters: echoDeviationGroupReportSchema,
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        widgetId: { type: 'string' }, totalRecords: { type: 'integer' }, codesRendered: { type: 'integer' },
        definitionVersion: { type: 'string' }, asOf: { type: 'string' },
        examples: { type: 'array', items: { type: 'object' } }
      }, required: ['widgetId', 'totalRecords', 'codesRendered', 'definitionVersion', 'asOf', 'examples'] },
      render: (_args, value) => [{ type: 'text', text: `Published a read-only deviation-group table: ${value.totalRecords} records across ${value.codesRendered} defined codes (${value.definitionVersion}), as of ${value.asOf}. Do not recalculate or rewrite its total. These are live records within the versioned group, not every possible transfer failure. Examples: ${JSON.stringify(value.examples)}` }]
    },
    execute: async (args, exec) => {
      if (args?.group !== 'improper_transfer') throw new Error('Unknown deviation group')
      const filters = validateEchoDeviationsFilters(Object.fromEntries(Object.entries(args).filter(([key]) => key !== 'group')))
      if (exec.signal?.aborted) throw new Error('Report cancelled before publication')
      const envelope = reportData(await callEchoTool(exec.agent, 'echo_summarize_deviation_group', {
        ...filters, group: args.group
      }, exec.signal))
      const data = envelope.data
      if (data.group !== args.group || typeof data.definitionVersion !== 'string' ||
        typeof envelope.asOf !== 'string' || !Array.isArray(data.examples)) {
        throw new Error('Invalid deviation group result; no report was published')
      }
      const rows = validatedRows(data)
      if (exec.signal?.aborted) throw new Error('Report cancelled before publication')
      const widgetId = 'echo-deviation-group-' + createHash('sha256')
        .update(JSON.stringify({ filters, group: args.group, asOf: envelope.asOf, rows })).digest('hex').slice(0, 20)
      exec.agent.session.append('voidr/widget', { widget: {
        id: widgetId, version: 2, capability: 'voidr-assistant',
        title: `${data.totalRecords} registros de transferências indevidas`, interactive: false, status: 'resolved',
        spec: { root: 'report', elements: { report: { type: 'Table', props: {
          columns: [{ header: 'Classificação' }, { header: 'Registros', align: 'right' }], rows
        } } } }
      } })
      return { widgetId, totalRecords: data.totalRecords, codesRendered: rows.length,
        definitionVersion: data.definitionVersion, asOf: envelope.asOf, examples: data.examples }
    }
  })
}
