const TOOLS = new Set(['echo_summarize_regulatory_controls', 'echo_summarize_deviation_group'])

export function regulatoryScopeArguments(tool, args, hint) {
  if (!TOOLS.has(tool)) return args
  if (!hint || hint.surface !== 'echo' || !args || typeof args !== 'object' || Array.isArray(args)) {
    throw new Error('Echo screen context unavailable; send a new message from the selected screen')
  }
  const nested = hint.echoContext ?? {}
  for (const key of ['applicationId', 'moduleSlug']) {
    if (hint[key] != null && nested[key] != null && hint[key] !== nested[key]) {
      throw new Error('Conflicting Echo screen context; refresh the selected screen')
    }
  }
  const applicationId = hint.applicationId ?? nested.applicationId
  const moduleSlug = hint.moduleSlug ?? nested.moduleSlug ?? null
  if (typeof applicationId !== 'string' || !/^[a-f\d]{24}$/i.test(applicationId) ||
      (moduleSlug !== null && (typeof moduleSlug !== 'string' || !moduleSlug.trim() || moduleSlug.length > 200))) {
    throw new Error('Invalid Echo screen context; no regulatory query was sent')
  }
  if (args.applicationId !== undefined && args.applicationId !== applicationId) {
    throw new Error('Application differs from the selected Echo screen')
  }
  const scope = args.scope === undefined
    ? moduleSlug === null ? { type: 'application' } : { type: 'journey', moduleSlug }
    : args.scope
  if (!scope || typeof scope !== 'object' || Array.isArray(scope) ||
      !['journey', 'application'].includes(scope.type) ||
      (scope.type === 'journey' && (typeof scope.moduleSlug !== 'string' || !scope.moduleSlug.trim()))) {
    throw new Error('Use scope {type: "journey", moduleSlug} or {type: "application"}')
  }
  if (moduleSlug !== null && (scope.type !== 'journey' || scope.moduleSlug !== moduleSlug)) {
    throw new Error('Keep the selected Echo Journey. To query all Journeys, remove the Journey filter on the screen and send a new message.')
  }
  return { ...args, applicationId, scope }
}
