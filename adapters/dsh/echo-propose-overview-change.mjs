const OBJECT_ID = '^[a-fA-F0-9]{24}$'
const BLOCK_ID = '^[a-z][a-z0-9_]{1,39}$'
const SERVICE_TOOL = 'echo_preview_overview_change'

const operationSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', enum: ['show', 'hide', 'move', 'resize', 'rename', 'update', 'remove', 'add_chart', 'add_kpi', 'add_ranking', 'reset'] },
    blockId: { type: 'string', pattern: BLOCK_ID, description: 'Block id returned by echo_get_overview_view.' },
    position: { type: 'string', enum: ['top', 'bottom', 'before', 'after'] },
    anchorBlockId: { type: 'string', pattern: BLOCK_ID },
    width: { type: 'integer', enum: [3, 4, 5, 6, 7, 8, 9, 12], description: 'Columns out of 12.' },
    title: { type: 'string', minLength: 1, maxLength: 80, description: 'Title of a new block only, in the user language.' },
    metric: { type: 'string', description: 'Metric id from the catalog returned by echo_get_overview_view.' },
    chartType: { type: 'string', enum: ['line', 'area', 'bar', 'stacked_bar'] },
    bucket: { type: 'string', enum: ['day', 'week'] },
    breakdown: { type: 'string', enum: ['none', 'journey', 'persona', 'environment'] },
    seriesLimit: { type: 'integer', minimum: 2, maximum: 8 },
    window: { type: 'string', enum: ['page', '24h', '7d', '14d', '30d', '90d', 'all'] },
    compare: { type: 'boolean' },
    limit: { type: 'integer', minimum: 3, maximum: 15 },
    sort: { type: 'string', enum: ['desc', 'asc'] },
    journey: { type: ['string', 'null'], description: 'Journey key from echo_get_overview_view entities; null clears the filter.' },
    persona: { type: ['string', 'null'], description: 'Persona key from echo_get_overview_view entities; null clears the filter.' }
  },
  required: ['action']
}

export const echoProposeOverviewChangeSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    intent: { type: 'string', enum: ['edit', 'rename', 'delete'] },
    base: { type: 'string', pattern: '^(current|voidr|template:[a-z][a-z0-9_]{1,39}|preset:[a-fA-F0-9]{24})$', description: 'Starting view for edit. Defaults to current.' },
    saveAs: { type: 'string', enum: ['auto', 'new'], description: 'auto updates a preset base and creates a new preset from Voidr views or templates; new always creates.' },
    presetId: { type: 'string', pattern: OBJECT_ID, description: 'Preset to rename or delete; defaults to the selected preset.' },
    name: { type: 'string', minLength: 1, maxLength: 60, description: 'Preset name (new preset or rename), in the user language.' },
    summary: { type: 'string', minLength: 1, maxLength: 280, description: 'One sentence in the user language describing the proposed change.' },
    operations: { type: 'array', maxItems: 12, items: operationSchema },
    applicationId: { type: 'string', pattern: OBJECT_ID, description: 'Defaults to the product on screen.' }
  },
  required: ['intent', 'summary']
}

function screenHint(agent) {
  return agent?.session.events.findLast(event => event.type === 'voidr/project-context-hint')?.data
}

export function buildPreviewArguments(args, hint) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Arguments must be an object')
  const unknown = Object.keys(args).filter(key => !Object.hasOwn(echoProposeOverviewChangeSchema.properties, key))
  if (unknown.length) throw new Error('Unsupported fields: ' + unknown.join(', ') + '. Use only the documented overview operations.')
  const applicationId = args.applicationId ?? hint?.applicationId ?? hint?.echoContext?.applicationId
  if (!new RegExp(OBJECT_ID).test(applicationId ?? '')) throw new Error('No product is selected. Ask the user which product the overview change is for.')
  return { ...args, applicationId, operations: args.operations ?? [] }
}

function parseEnvelope(response) {
  const text = (response.content ?? []).filter(item => item.type === 'text').map(item => item.text).join('\n')
  if (response.isError) throw new Error('Overview change rejected: ' + text)
  const data = response.structuredContent?.data ?? JSON.parse(text)?.data
  if (!data || (data.status !== 'ready' && data.status !== 'invalid')) throw new Error('Invalid overview preview response; no preview was published')
  return data
}

function publishPreview(agent, data) {
  agent.session.append('voidr/widget', { widget: {
    id: 'echo-overview-proposal-' + data.proposalId,
    version: 2,
    capability: 'voidr-assistant',
    title: 'Proposta para a Visão Geral',
    interactive: false,
    status: 'resolved',
    spec: { root: 'proposal', elements: { proposal: { type: 'EchoOverviewProposal', props: { proposalId: data.proposalId, applicationId: data.applicationId } } } }
  } })
}

function renderOutcome(value) {
  if (value.status === 'invalid') {
    return 'The change was not accepted and no preview was published. Fix these issues and call the tool again, or ask the user when the choice is theirs:\n' +
      value.issues.map(item => '- ' + (item.operation === null ? '' : 'operation ' + item.operation + ': ') + item.message).join('\n')
  }
  const target = value.kind === 'create' ? 'new preset "' + value.name + '"' : 'preset "' + value.presetName + '"'
  return 'Published a preview card (' + value.kind + ', ' + target + ', ' + value.changes + ' change(s)). Nothing changed yet: the page changes only if the person clicks Aplicar in the card. Briefly describe what the card proposes in product language and do not claim it was applied.' +
    (value.warnings.length ? '\nTell the person: ' + value.warnings.join(' ') : '')
}

export function registerEchoProposeOverviewChange(ctx, callEchoTool) {
  ctx.tools.register({
    name: 'echo_propose_overview_change',
    description: 'Propose a change to the Echo overview ("Visão Geral") and show a preview card the person can apply or discard. Supports editing blocks (show, hide, move, resize, add charts, KPIs and rankings from the metric catalog), creating presets from the Voidr view or templates, and renaming or deleting presets. Call echo_get_overview_view first. Never changes the page by itself; colors, logo, fonts and formulas are not configurable.',
    parameters: echoProposeOverviewChangeSchema,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', enum: ['ready', 'invalid'] },
          proposalId: { type: 'string' },
          kind: { type: 'string' },
          name: { type: ['string', 'null'] },
          presetName: { type: ['string', 'null'] },
          changes: { type: 'integer' },
          warnings: { type: 'array', items: { type: 'string' } },
          issues: { type: 'array', items: { type: 'object', additionalProperties: true } }
        },
        required: ['status']
      },
      render: (_args, value) => [{ type: 'text', text: renderOutcome(value) }]
    },
    execute: async (args, exec) => {
      const input = buildPreviewArguments(args, screenHint(exec.agent))
      const data = parseEnvelope(await callEchoTool(exec.agent, SERVICE_TOOL, input, exec.signal, { allowError: true }))
      if (data.status === 'invalid') return { status: 'invalid', issues: data.issues ?? [] }
      if (exec.signal?.aborted) throw new Error('Preview cancelled before publication')
      publishPreview(exec.agent, data)
      return {
        status: 'ready',
        proposalId: data.proposalId,
        kind: data.kind,
        name: data.name ?? null,
        presetName: data.presetName ?? null,
        changes: Array.isArray(data.changes) ? data.changes.length : 0,
        warnings: data.warnings ?? []
      }
    }
  })
}
