// A narrow cost profile for factual questions about an already selected case.
// It changes neither tools, authorization nor the provider/model chosen by the user.
const EVENT = 'voidr/monitor-read-effort'
const QUESTIONS = new Set([
  'o que aconteceu', 'o que aconteceu aqui', 'o que aconteceu nessa execucao',
  'o que aconteceu nesse caso', 'o que aconteceu com esse teste',
  'esse caso passou', 'esse teste passou', 'o caso selecionado passou nessa execucao',
  'qual o resultado', 'qual o status', 'qual o resultado desse caso',
  'what happened', 'what happened here', 'did this test pass', 'did the selected case pass',
])

function latestUser(events, incoming) {
  const messages = [...events.filter(event => event.type === 'user/message').map(event => event.data), ...incoming]
  const index = messages.findLastIndex(message => message?.source?.kind === 'user')
  if (messages.slice(index + 1).some(message => message?.source?.kind === 'skill-invocation')) return null
  return messages[index]
}

export function simpleMonitorRead(events = [], incoming = []) {
  const hint = events.findLast(event => event.type === 'voidr/project-context-hint')?.data
  if (hint?.surface !== 'monitor' || !hint.testPlanId || !hint.testCaseSlug) return false
  const message = latestUser(events, incoming)
  if (!message?.content?.length || message.content.some(block => block.type !== 'text')) return false
  // Only the user's own first block is the request; appended reminders are not intent.
  const text = message.content[0]?.text
  if (typeof text !== 'string' || text.length > 160) return false
  const normalized = text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()
    .replace(/[?!.,]+$/g, '').replace(/[?!.,;\s]+resuma$/g, '').trim()
  return QUESTIONS.has(normalized)
}

function flashConfig(config) {
  let provider = config.provider, model = config.model
  if (provider === 'voidr-assistant' && model?.startsWith('assistant--')) {
    try { [provider, model] = JSON.parse(Buffer.from(model.slice(11), 'base64url').toString()) }
    catch { return false }
  }
  return provider === 'deepseek-official' && ['deepseek-flash-latest', 'deepseek-flash'].includes(model)
}

function needsFullReasoning(events, turn) {
  return events.some(event => event.data?.turn === turn && (
    (event.type === 'tool/call' && event.data.name !== 'mcp__voidr__playwright_get_case_summary') ||
    (event.type === 'tool/result' && event.data.message?.content?.some(block => block.isError))
  ))
}

export function registerMonitorReadProfile(ctx) {
  ctx.on('agent/pre-step', async ({ agent, turn }, next) => {
    const decision = await next()
    if (decision.kind === 'reject' || !simpleMonitorRead(agent.session.events, decision.messages ?? []) ||
      needsFullReasoning(agent.session.events, turn)) return decision
    // The catalog is deferred, not erased from existing history. A later task
    // change publishes the full native catalog through the normal skill plugin.
    return { ...decision, messages: decision.messages.filter(message => message.source?.kind !== 'skill-catalog') }
  }, { prepend: true })
  ctx.on('agent/request', async ({ agent, turn }, next) => {
    const config = await next()
    const events = agent.session.events
    const prior = events.findLast(event => event.type === EVENT)?.data
    const active = prior?.state === 'active' ? prior : null
    const fast = simpleMonitorRead(events) && !needsFullReasoning(events, turn) && flashConfig(config)
    const sameModel = active?.provider === config.provider && active?.model === config.model
    if (active && (!fast || !sameModel || config.reasoningEffort !== 'low')) {
      agent.session.append(EVENT, { state: 'restored', turn })
      // Preserve a model/effort change made elsewhere instead of overwriting it.
      if (sameModel && config.reasoningEffort === 'low') return { ...config, reasoningEffort: active.reasoningEffort }
      return config
    }
    if (!fast || config.reasoningEffort !== 'high') return config
    // Persist the original setting so resuming on another process restores it too.
    agent.session.append(EVENT, { state: 'active', turn, provider: config.provider, model: config.model,
      reasoningEffort: config.reasoningEffort })
    return { ...config, reasoningEffort: 'low' }
  })
}
