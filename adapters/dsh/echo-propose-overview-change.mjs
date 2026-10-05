const OBJECT_ID = '^[a-fA-F0-9]{24}$'
const BLOCK_ID = '^[a-z][a-z0-9_]{1,39}$'
const SERVICE_TOOL = 'echo_preview_overview_change'
const COLORS = ['white', 'gray', 'cyan', 'blue', 'violet', 'pink', 'amber', 'yellow', 'sand', 'green', 'red']
const COLOR_CHOICES = [...COLORS, 'default']
const CRITERIA = [
  'intent_understanding', 'procedural_adherence', 'information_and_action_accuracy', 'task_completion',
  'recovery_and_progression', 'escalation_correctness', 'privacy_and_safety', 'clarity_and_naturalness',
  'content_utility_and_conciseness', 'responsiveness', 'appropriate_closure'
]
export const ECHO_OVERVIEW_PROPOSAL_WIDGET_PREFIX = 'echo-overview-proposal-'

const conditionSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    field: { type: 'string', minLength: 3, maxLength: 60, description: 'Field from catalog.metricModel for the metric subject.' },
    op: { type: 'string', enum: ['in', 'not_in', 'gte', 'lte'] },
    values: { type: 'array', maxItems: 30, items: { type: 'string', minLength: 1, maxLength: 200 }, description: 'Values for in and not_in, from catalog.metricModel.' },
    value: { type: 'number', description: 'Number for gte and lte.' }
  },
  required: ['field', 'op']
}

const customMetricSchema = {
  type: 'object',
  additionalProperties: false,
  description: 'Custom metric definition for metric "custom", built only from catalog.metricModel returned by mcp__voidr__echo_get_overview_view with metricModel true.',
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 60, description: 'Metric name in the user language.' },
    subject: { type: 'string', enum: ['session', 'criterion', 'deviation', 'knowledge', 'regulatory', 'hallucination'] },
    kind: { type: 'string', enum: ['count', 'rate', 'mean'] },
    base: { type: 'string', enum: ['all', 'valid', 'evaluated', 'conclusive'] },
    where: { type: 'array', maxItems: 8, items: conditionSchema, description: 'Conditions every counted record meets (the denominator of a rate).' },
    match: { type: 'array', maxItems: 8, items: conditionSchema, description: 'Conditions of the numerator of a rate.' },
    value: { type: 'string', minLength: 3, maxLength: 60, description: 'Numeric field averaged by a mean.' },
    favorable: { type: 'string', enum: ['high', 'low', 'neutral'] }
  },
  required: ['name', 'subject', 'kind']
}

const operationSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', enum: ['show', 'hide', 'move', 'resize', 'rename', 'update', 'remove', 'style', 'add_chart', 'add_kpi', 'add_ranking', 'reset'] },
    blockId: { type: 'string', pattern: BLOCK_ID, description: 'Block id returned by mcp__voidr__echo_get_overview_view.' },
    position: { type: 'string', enum: ['top', 'bottom', 'before', 'after'] },
    anchorBlockId: { type: 'string', pattern: BLOCK_ID },
    width: { type: 'integer', enum: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12], description: 'Columns out of 12.' },
    height: { type: 'integer', minimum: 3, maximum: 24, description: 'Rows of 34 px for KPI, chart and ranking blocks; Voidr blocks keep their height.' },
    title: { type: 'string', minLength: 1, maxLength: 80, description: 'Title of a new block only, in the user language.' },
    metric: { type: 'string', description: 'Metric id from the catalog returned by mcp__voidr__echo_get_overview_view, or custom with a custom definition.' },
    criterion: { type: 'string', enum: CRITERIA, description: 'Judge criterion for metric criterion_fail_rate (share of evaluated sessions whose official judge verdict for that criterion is FAIL), e.g. appropriate_closure for incorrect or improper closings. Required with that metric and ignored by others.' },
    custom: customMetricSchema,
    chartType: { type: 'string', enum: ['line', 'area', 'bar', 'stacked_bar'] },
    bucket: { type: 'string', enum: ['day', 'week'] },
    breakdown: { type: 'string', minLength: 4, maxLength: 60, description: 'none, journey, persona, environment, or a dimension from catalog.metricModel such as session.termination_reason.' },
    seriesLimit: { type: 'integer', minimum: 2, maximum: 8 },
    window: { type: 'string', enum: ['page', '24h', '7d', '14d', '30d', '90d', 'all'] },
    compare: { type: 'boolean' },
    limit: { type: 'integer', minimum: 3, maximum: 15 },
    sort: { type: 'string', enum: ['desc', 'asc'] },
    journey: { type: 'string', maxLength: 200, description: 'Journey key from mcp__voidr__echo_get_overview_view entities; an empty string clears the filter.' },
    persona: { type: 'string', maxLength: 200, description: 'Persona key from mcp__voidr__echo_get_overview_view entities; an empty string clears the filter.' },
    picker: { type: 'string', enum: ['journey', 'persona', 'none'], description: 'Selector in the block header that lets the reader choose ONE journey (or persona) at a time. Use it instead of one block per journey. journey/persona above becomes the starting choice. none removes it. A chart or ranking cannot also break down by the picked dimension.' },
    color: { type: 'string', enum: COLOR_CHOICES, description: 'Palette color of a KPI number, ranking bars or a single-series chart. default removes the override.' },
    seriesColors: {
      type: 'array',
      maxItems: 9,
      description: 'One palette color per chart or ranking series: a journey, persona or environment key from entities, total, or __others__. default removes one.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { key: { type: 'string', minLength: 1, maxLength: 200 }, color: { type: 'string', enum: COLOR_CHOICES } },
        required: ['key', 'color']
      }
    },
    thresholds: {
      type: 'array',
      maxItems: 3,
      description: 'Rules that color a KPI number or ranking value and draw reference lines on charts; the first matching rule wins. Values use the metric unit: rates are fractions (25% = 0.25), scores 0-100, times in milliseconds, counts in sessions. An empty list removes them.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { operator: { type: 'string', enum: ['gt', 'gte', 'lt', 'lte'] }, value: { type: 'number' }, color: { type: 'string', enum: COLORS } },
        required: ['operator', 'value', 'color']
      }
    }
  },
  required: ['action']
}

export const echoProposeOverviewChangeSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    intent: { type: 'string', enum: ['edit', 'rename', 'delete'] },
    base: { type: 'string', pattern: '^(current|voidr|preset:[a-fA-F0-9]{24})$', description: 'Starting view for edit. Defaults to current.' },
    saveAs: { type: 'string', enum: ['auto', 'new'], description: 'auto updates a preset base and creates a new preset from the Voidr view; new always creates.' },
    presetId: { type: 'string', pattern: OBJECT_ID, description: 'Preset to rename or delete; defaults to the selected preset.' },
    name: { type: 'string', minLength: 1, maxLength: 60, description: 'Preset name (new preset or rename), in the user language.' },
    summary: { type: 'string', minLength: 1, maxLength: 280, description: 'One sentence in the user language describing the proposed change.' },
    operations: { type: 'array', maxItems: 12, items: operationSchema },
    applicationId: { type: 'string', pattern: OBJECT_ID, description: 'Defaults to the product on screen.' },
    assumptions: {
      type: 'array',
      maxItems: 6,
      items: { type: 'string', minLength: 1, maxLength: 200 },
      description: 'Every choice in this proposal that the person neither stated nor confirmed and that changes what they will read: a metric standing in for what they asked, the period, the breakdown, the block form (KPI, ranking or chart), a filter, or which of several readings of their words you picked. Leave out layout details they can adjust in a second (position, width, title wording). Pass [] only when every such choice was stated or confirmed. A non-empty list publishes nothing: ask first.'
    }
  },
  required: ['intent', 'summary', 'assumptions']
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
  const { assumptions: _assumptions, ...serviceArgs } = args
  return { ...serviceArgs, applicationId, operations: (args.operations ?? []).map(serviceOperation) }
}

export function pendingAssumptions(args) {
  return Array.isArray(args?.assumptions)
    ? args.assumptions.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim())
    : []
}

function serviceOperation(operation) {
  const cleared = { ...operation }
  for (const key of ['journey', 'persona']) if (cleared[key] === '') cleared[key] = null
  if (cleared.picker === 'none') cleared.picker = null
  if (Array.isArray(cleared.seriesColors)) cleared.seriesColors = Object.fromEntries(cleared.seriesColors.map(entry => [entry.key, entry.color]))
  return cleared
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
  if (value.status === 'needs_confirmation') {
    return 'Nothing was published. These choices were not stated or confirmed by the person:\n' +
      value.assumptions.map(item => '- ' + item).join('\n') +
      '\nAsk them now with one ask_user_question in their language: at most three questions, each with two to four concrete options grounded in the catalog, your recommendation first and marked as recommended, and say plainly when what they asked does not exist and which option comes closest. End the turn after asking and propose only after they answer.'
  }
  if (value.status === 'invalid') {
    return 'The change was not accepted and no preview was published. Fix these issues and call the tool again, or ask the user when the choice is theirs:\n' +
      value.issues.map(item => '- ' + (item.operation === null ? '' : 'operation ' + item.operation + ': ') + item.message).join('\n')
  }
  const target = value.kind === 'create' ? 'new preset "' + value.name + '"' : 'preset "' + value.presetName + '"'
  return 'Published a preview card (' + value.kind + ', ' + target + ', ' + value.changes + ' change(s)). Nothing changed yet: the page changes only if the person clicks Aplicar in the card. Describe what the card proposes in one or two sentences of product language, name the metric it uses, and end the turn: no questions, no other tools. Do not claim it was applied.' +
    (value.warnings.length ? '\nTell the person: ' + value.warnings.join(' ') : '')
}

export function proposalPublishedThisTurn(events) {
  const start = events.findLastIndex(event => event.type === 'turn/start')
  return events.slice(start + 1).some(event =>
    event.type === 'voidr/widget' &&
    String(event.data?.widget?.id ?? '').startsWith(ECHO_OVERVIEW_PROPOSAL_WIDGET_PREFIX))
}

export function echoOverviewQuestionDenial(name, events) {
  if (name !== 'ask_user_question' || !proposalPublishedThisTurn(events ?? [])) return null
  return 'A proposal card is already waiting for the person in this turn and it carries the decision (apply, save as new, see on the page, discard). Do not ask anything now: describe the card in one or two sentences and end the turn. Ask open questions before proposing, never after.'
}

export function registerEchoProposeOverviewChange(ctx, callEchoTool) {
  ctx.tools.register({
    name: 'echo_propose_overview_change',
    description: 'Propose a change to the Echo overview ("Visão Geral") and show a preview card the person can apply or discard. Supports editing blocks (show, hide, move, resize, add charts, KPIs and rankings from the metric catalog or custom metrics from its metric model, including the failure rate of one judge criterion, and palette or threshold colors on those blocks), creating presets from the Voidr view, and renaming or deleting presets. Not for the overview studio: when the person has a studio draft open, edit it with mcp__voidr__echo_edit_overview_draft. Call mcp__voidr__echo_get_overview_view first and align with the person before calling: the card is the last step of the turn. Never changes the page by itself; backgrounds, logo, fonts, free hex colors and formulas are not configurable.',
    parameters: echoProposeOverviewChangeSchema,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', enum: ['ready', 'invalid', 'needs_confirmation'] },
          assumptions: { type: 'array', items: { type: 'string' } },
          proposalId: { type: 'string' },
          kind: { type: 'string' },
          name: { type: 'string' },
          presetName: { type: 'string' },
          changes: { type: 'integer' },
          warnings: { type: 'array', items: { type: 'string' } },
          issues: { type: 'array', items: { type: 'object', additionalProperties: true } }
        },
        required: ['status']
      },
      render: (_args, value) => [{ type: 'text', text: renderOutcome(value) }]
    },
    execute: async (args, exec) => {
      const assumptions = pendingAssumptions(args)
      if (assumptions.length) return { status: 'needs_confirmation', assumptions }
      const input = buildPreviewArguments(args, screenHint(exec.agent))
      const data = parseEnvelope(await callEchoTool(exec.agent, SERVICE_TOOL, input, exec.signal, { allowError: true }))
      if (data.status === 'invalid') return { status: 'invalid', issues: data.issues ?? [] }
      if (exec.signal?.aborted) throw new Error('Preview cancelled before publication')
      publishPreview(exec.agent, data)
      return {
        status: 'ready',
        proposalId: data.proposalId,
        kind: data.kind,
        ...(data.name ? { name: data.name } : {}),
        ...(data.presetName ? { presetName: data.presetName } : {}),
        changes: Array.isArray(data.changes) ? data.changes.length : 0,
        warnings: data.warnings ?? []
      }
    }
  })
}
