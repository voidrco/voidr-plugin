import { createHash } from 'node:crypto'

export const failureHypotheses = {
  navigation_timing: 'Estado ou sincronização da navegação/carregamento: hipótese não confirmada.',
  locator_accessibility: 'Correspondência do localizador, nome acessível ou visibilidade: hipótese não confirmada.',
  frame_document: 'Frame ou documento consultado: hipótese não confirmada.',
  integration_test_data: 'Integração, autenticação ou dados: hipótese não confirmada; um status HTTP isolado não estabelece causalidade.',
  console_origin: 'Origem dos erros de script, na aplicação ou na instrumentação: ainda não correlacionada à falha.',
}
export const failureChecks = {
  trace_assertion_window: 'Associar o trace ao registro correto e conferir toda a janela da asserção, com origem temporal conhecida.',
  locator_accessible_tree: 'Conferir nome acessível, visibilidade e frame/documento no instante da consulta; uma captura pontual não elimina essas alternativas.',
  network_expected_behavior: 'Comparar o contrato e as respostas das requisições relevantes com uma execução saudável equivalente.',
  console_source_mapping: 'Localizar a origem dos erros de console e correlacionar seus horários com o passo afetado.',
  controlled_reproduction: 'Propor uma reprodução controlada do mesmo caso antes de confirmar a causa; executar exige confirmação separada.',
  history_same_scope: 'Avaliar a recorrência no mesmo escopo; um passe posterior não elimina uma falha intermitente.',
}
const escape = value => String(value ?? 'não informado').replace(/[\\`*_[\]<>|]/g, char => `&#${char.charCodeAt(0)};`).replace(/[\r\n]+/g, ' ')

function hypothesisRefs(kind, bundle) {
  const rows = bundle.failures.selected.map(row => `rows:${row.sourceRow}`)
  const section = key => bundle.evidence[key] ? [key] : []
  return kind === 'console_origin' ? section('timeline') : kind === 'integration_test_data'
    ? [...section('timeline'), ...section('trace')] : [...rows, ...section(kind === 'navigation_timing' ? 'timeline' : 'dom')]
}

export function validateFailureReport(args, bundle) {
  if (!args || Object.keys(args).sort().join(',') !== 'executionId,hypotheses,nextChecks,testCaseSlug' ||
    args.executionId !== bundle.scope.executionId || args.testCaseSlug !== bundle.scope.testCaseSlug)
    throw new Error('Supply only the exact selected scope, hypothesis kinds and proposed checks; facts and references are computed from the authorized bundle')
  if (!bundle.failures.complete || !bundle.failures.selected.length) throw new Error('Complete selected failure records are required')
  if (!Array.isArray(args.hypotheses) || args.hypotheses.length > 5 || new Set(args.hypotheses).size !== args.hypotheses.length ||
    args.hypotheses.some(kind => !Object.hasOwn(failureHypotheses, kind) || !hypothesisRefs(kind, bundle).length))
    throw new Error('Choose distinct hypothesis kinds with available evidence: ' + Object.keys(failureHypotheses).filter(kind => hypothesisRefs(kind, bundle).length).join(', ') + '; use [] when evidence is insufficient')
  if (!Array.isArray(args.nextChecks) || !args.nextChecks.length || args.nextChecks.length > 3 ||
    new Set(args.nextChecks).size !== args.nextChecks.length || args.nextChecks.some(key => !Object.hasOwn(failureChecks, key)))
    throw new Error('Choose one to three distinct proposed checks: ' + Object.keys(failureChecks).join(', ') + '; no check is executed')
}

export function renderFailureReport(args, bundle) {
  validateFailureReport(args, bundle)
  const rows = bundle.failures.recordLedger
  if (!Array.isArray(rows) || rows.length !== bundle.failures.selected.length) throw new Error('Verified record ledger unavailable')
  const output = [
    `**${escape(bundle.scope.testCaseSlug)}: causa ainda não confirmada.** Os registros mostram o erro observado; não comprovam sua causa raiz nem eliminam explicações alternativas.`, '',
    `A execução contém ${bundle.failures.totalRecords} registros de falha em ${bundle.failures.distinctCases} casos distintos; ${rows.length} registros pertencem ao caso selecionado.`, '',
    '| Registro | Início UTC | Duração (ms) | Classe de errorMessage | Timeout (ms) |', '|---|---|---:|---|---:|',
    ...rows.map(row => `| rows[${row.sourceRow}] | ${escape(row.startedAt)} | ${escape(row.durationMs)} | ${escape(row.errorMessage.kind)} | ${escape(row.errorMessage.timeoutMs)} |`), '',
    'Erros registrados (prefixos; textos completos nas fontes):', '',
    ...bundle.failures.selected.map(row => `- rows[${row.sourceRow}]: ${escape(String(row.errorMessage ?? '').split('\n')[0].slice(0, 350))}`), '',
  ]
  for (const row of rows) if (row.errorMessage.kind !== row.errorStack.kind || row.errorMessage.timeoutMs !== row.errorStack.timeoutMs)
    output.push(`Em rows[${row.sourceRow}], errorStack indica ${escape(row.errorStack.kind)} / ${escape(row.errorStack.timeoutMs)} ms, diferente de errorMessage. Os campos permanecem separados.`, '')
  const timeline = bundle.evidence.timeline
  if (timeline) {
    output.push(`Amostra da timeline: ${timeline.console.sampledMessages} mensagens de console e ${timeline.network.sampledRequests} requisições. Contagens da amostra, sem inferência causal:`, '',
      ...Object.entries(timeline.console.byMessage).map(([message, count]) => `- Console: ${count} × ${escape(message.slice(0, 180))}${message.length > 180 ? ' (prefixo)' : ''}.`),
      ...Object.entries(timeline.network.byStatus).map(([status, count]) => `- Status ${escape(status)}: ${count}.`), '')
  }
  const history = bundle.evidence.history
  if (history) output.push(`Histórico no escopo consultado: ${history.returnedRecords} registros; ${Object.entries(history.byStatus).map(([key, count]) => `${escape(key)}: ${count}`).join(', ')}. Um passe posterior não exclui falha intermitente.`, '')
  const trace = bundle.evidence.trace?.steps
  if (trace) output.push(`Trace: ${trace.failedSteps} passos retornados com falha/timeout entre ${trace.sampledSteps} passos amostrados. Passos intermediários podem ter sido tratados pelo teste; não foram atribuídos como causa da falha final.`, '',
    ...trace.rows.filter(row => /fail|error|timed.?out/i.test(row.status ?? '') || row.error).map(row =>
      `- Passo ${escape(row.stepIndex ?? row.sourceRow)}: ${escape(row.name)} — ${escape(row.status)}; ${escape(row.durationMs)} ms; ${escape(String(row.error ?? '').slice(0, 220))} (prefixo).`), '')
  if (bundle.evidence.testCase) output.push('Comportamento esperado: existe um caso no Test Plan consultado, disponível na fonte test_plans_get_case. Sua existência não comprova a causa da divergência observada.', '')
  output.push('Hipóteses não confirmadas:', '', ...(args.hypotheses.length ? args.hypotheses.map(kind => `- ${failureHypotheses[kind]} Referências: ${hypothesisRefs(kind, bundle).map(escape).join(', ')}.`) : ['- Evidência insuficiente para priorizar uma hipótese.']), '',
    'Próximas verificações propostas:', '', ...args.nextChecks.map(key => `- ${failureChecks[key]}`), '',
    'Uma captura de DOM não prova visibilidade contínua, contexto de frame ou associação temporal a cada registro. Os registros de falha não fornecem índices de retry/projeto; não foram inferidos. Esta coleta não realiza uma reprodução controlada nem confirma BUG de produto. Problemas do código de automação são uma classificação separada.', '',
    `Lacunas explícitas: ${bundle.gaps.length ? bundle.gaps.map(gap => escape(gap.name)).join(', ') : 'nenhuma falha de leitura no pacote inicial'}. A ausência de falha de leitura não prova causa nem cobertura integral das fontes. A visão é compacta; há ${bundle.view.omissions.length} reduções de detalhe declaradas, e stdout/stderr não foram incluídos.`, '',
    'Fontes autorizadas nesta coleta:', '', ...bundle.sources.map(source => `- ${escape(source.name)} — SHA256 ${source.sha256}.`), '',
    `Escopo: execução ${bundle.scope.executionId}, aplicação ${bundle.scope.applicationId}, plano ${bundle.scope.planId}, caso ${escape(bundle.scope.testCaseSlug)}.`)
  return output.join('\n')
}

export function registerFailureReport(ctx, window) {
  ctx.tools.register({
    name: 'failure_analysis_render_report',
    description: 'Publish an optional initial evidence panel and continue the investigation. This does not end the turn or answer the user by itself. Supply unconfirmed hypothesis kinds and proposed checks only. Every selected record and all source references are included automatically; never supply row indices or evidence references. All panel facts, counts, timestamps, independent error fields and uncertainty are rendered from the authorized bundle; never supply panel prose, a classification, a confirmed cause or widget JSON. Complete the user’s answer from the evidence and any necessary authorized detail reads. This does not prove a root cause, execute checks, mutate tags or open defects.',
    parameters: { type: 'object', additionalProperties: false, properties: {
      executionId: { type: 'string' }, testCaseSlug: { type: 'string' },
      hypotheses: { type: 'array', maxItems: 5, uniqueItems: true, items: { type: 'string', enum: Object.keys(failureHypotheses) } },
      nextChecks: { type: 'array', minItems: 1, maxItems: 3, uniqueItems: true, items: { type: 'string', enum: Object.keys(failureChecks) } },
    }, required: ['executionId', 'testCaseSlug', 'hypotheses', 'nextChecks'] },
    output: { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: `Initial evidence panel published for ${value.selectedRecords} records. This is not the final answer. Complete the user's analysis using the collected evidence and bounded reads for concrete gaps. The panel does not confirm a cause or execute proposed checks.` }] },
    execute: async (args, exec) => {
      exec.signal?.throwIfAborted()
      const state = window.forReport(exec.agent, args)
      const content = renderFailureReport(args, state.bundle)
      if (content.length > 30_000) throw new Error('Report exceeds the bounded presentation limit; no report published')
      exec.signal?.throwIfAborted()
      const id = 'failure-report-' + createHash('sha256').update(content).digest('hex').slice(0, 20)
      exec.agent.session.append('voidr/widget', { widget: { id, version: 2, capability: 'voidr-assistant',
        title: 'Diagnóstico inicial com evidências', interactive: false, status: 'resolved',
        spec: { root: 'report', elements: { report: { type: 'Markdown', props: { content } } } } } })
      state.reported = true
      return { widgetId: id, selectedRecords: state.bundle.failures.selected.length, causeStatus: 'inconclusive' }
    },
  })
}
