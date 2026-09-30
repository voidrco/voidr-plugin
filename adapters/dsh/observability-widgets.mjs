const titles = { impact: 'Impacto nas requisições', trace: 'Onde o tempo foi gasto', evidence: 'Evidências correlacionadas', metrics: 'Métricas da aplicação', comparison: 'Antes e depois', changes: 'Mudanças e versões' }

function reportResult(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 6 || value.isError || value.error || value.success === false) return null
  if (value.structuredContent) return reportResult(value.structuredContent, depth + 1)
  if (value.data) return reportResult(value.data, depth + 1)
  if (Array.isArray(value.content)) {
    try { return reportResult(JSON.parse(value.content.filter(item => item.type === 'text').map(item => item.text).join('\n')), depth + 1) }
    catch { return null }
  }
  return /^[a-f\d-]{36}$/i.test(value.reportId ?? '') && Object.hasOwn(titles, value.kind) && Array.isArray(value.entries) ? value : null
}

export function registerObservabilityWidgets(ctx) {
  ctx.on('tools/result', (exec, result) => {
    if (!exec.agent || exec.signal?.aborted || result.isError) return
    const name = exec.name.replace(/^.*(?:__|\.)/, '')
    const requested = name === 'system_call_tool' ? exec.arguments?.tool ?? exec.arguments?.name : name
    if (requested !== 'observability_render' && requested !== 'mcp__voidr__observability_render') return
    const report = reportResult(result.value)
    if (!report) return
    exec.agent.session.append('voidr/widget', { widget: {
      id: `observability-${report.reportId}`, version: 2, capability: 'voidr-assistant', title: titles[report.kind],
      interactive: false, status: 'resolved',
      spec: { root: 'report', elements: { report: { type: 'ObservabilityReport', props: { reportId: report.reportId } } } }
    } })
  })
}
