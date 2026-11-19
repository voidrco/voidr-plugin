export const TOOL_SCOPE_EVENT = 'voidr/tool-scope-expanded'

export function usesCentralHomeContext(hint, providerVersion) {
  return hint?.surface === 'home' && !hint.channel && hint.contextVersion === 1 && providerVersion === 1
}

// Visibility is a prompt-size optimization. Service authorization and the
// existing DSH approval policy still decide whether a call may execute.
const CORE = new Set([
  'skill', 'read', 'todo_write', 'ask_user_question', 'render_widget',
  'load_capability_context',
  'mcp__voidr__system_search_tools', 'mcp__voidr__system_call_tool',
  'mcp__voidr__system_batch_execute',
  'mcp__voidr__artifacts_read', 'mcp__voidr__artifacts_query',
  'mcp__voidr__artifacts_aggregate', 'mcp__voidr__files_analyze_uploaded_file',
  'mcp__voidr__assistant_help_request', 'mcp__voidr__custom_connectors_list',
])
const HOME_CORE = new Set([
  'skill', 'ask_user_question', 'load_capability_context', 'expand_tool_scope',
  'mcp__voidr__system_search_tools', 'mcp__voidr__system_call_tool',
  'mcp__voidr__system_batch_execute',
])
const DOMAINS = {
  kod: ['kod_workspace_', 'kod_desktop_', 'kod_windows_command', 'kod_ask_user', 'kod_record_result'],
  diagnosis: [
    'playwright_get_case_summary',
    'playwright_get_test_history', 'test_plans_get_case', 'executions_get_execution', 'executions_list_executions',
    'playwright_get_execution_analytics', 'playwright_list_execution_failures',
    'playwright_get_test_timeline', 'defects_list_defects', 'defects_get_defect',
  ],
  radar: [
    'preventive_monitor_',
    'monitor_', 'custom_connectors_list',
    'custom_connectors_list_mcp_tools', 'custom_connectors_read_mcp_tool',
    'source_control_list_repositories', 'source_control_search_code',
    'source_control_read_file', 'source_control_read_deployment_evidence',
    'applications_list_linked_repositories',
    'observability_',
  ],
  tickets: [
    'custom_connectors_list', 'custom_connectors_zendesk_evidence',
    'custom_connectors_zendesk_live', 'custom_connectors_search_tickets',
    'custom_connectors_ticket_attachment', 'custom_connectors_ticket_metrics',
    'issue_tracker_', 'hero_',
  ],
  telemetry: [
    'custom_connectors_list', 'custom_connectors_list_mcp_tools',
    'custom_connectors_read_mcp_tool', 'observability_', 'monitor_',
    'betterstack_', 'datadog_', 'prometheus_', 'dynatrace_',
  ],
  code: ['source_control_', 'git_connector_', 'connector_code_search_', 'voidr_gate_'],
  plans: [
    'applications_list_applications', 'applications_get_application',
    'applications_list_environments', 'applications_list_journeys',
    'applications_list_documentation', 'applications_get_api_contract',
    'test_plans_', 'coverage_', 'recording_',
    'sessions_list_sessions', 'sessions_get_session_summary',
    'sessions_get_session_actions', 'sessions_get_session_action_effects',
    'sessions_get_session_digest', 'sessions_get_session_screenmap',
    'sessions_get_session_selectors', 'file_embeddings_search_documents',
  ],
  execution: [
    'executions_', 'execution_contexts_', 'failure_analysis_',
    'failure_reports_', 'test_failures_', 'playwright_',
    'assistant_context_', 'defects_',
    'applications_list_applications', 'test_plans_get_case',
    'test_plans_get_tag_history', 'test_plans_update_test_case_tag',
  ],
  authoring: [
    'assistant_workspace_', 'test_plans_', 'coverage_',
    'applications_list_applications', 'applications_get_application',
    'applications_list_environments', 'sessions_list_sessions',
    'sessions_get_session_summary', 'sessions_get_session_actions',
  ],
  echo: ['echo_'],
  reports: ['evidence_reports_'],
  performance: [
    'performance_', 'applications_list_applications', 'applications_get_application',
    'applications_list_environments', 'sessions_list_sessions',
    'sessions_get_session_digest', 'sessions_get_session_network',
  ],
  'third-party': ['third_party_', 'data_management_', 'applications_list_applications'],
  knowledge: [
    'ontology_', 'knowledge_', 'applications_list_applications',
    'applications_get_application', 'monitor_get_overview',
    'sessions_list_sessions', 'sessions_get_session_digest',
    'executions_list_executions', 'executions_get_execution',
    'defects_list_defects', 'defects_get_defect',
  ],
}

export const TOOL_DOMAINS = Object.freeze(Object.keys(DOMAINS))
const NATIVE_DEVELOPMENT = new Set([
  'bash', 'write', 'edit', 'read', 'glob', 'grep', 'apply_patch',
  'read_image', 'inspect_session_images', 'materialize_session_image',
])

function matches(name, entries) {
  const raw = name.startsWith('mcp__voidr__') ? name.slice('mcp__voidr__'.length) : name
  return entries.some(entry => entry.endsWith('_') ? raw.startsWith(entry) : raw === entry)
}

export const isSelectedMonitor = hint => hint?.surface === 'monitor' &&
  Boolean(hint.testPlanId || hint.testCaseSlug || hint.executionId)

export function initialToolDomains(hint) {
  if (isSelectedMonitor(hint)) return ['diagnosis']
  if (!hint || typeof hint.surface !== 'string') return ['knowledge']
  if (hint.surface === 'slack') return hint.radarSituationId ? ['radar'] : ['knowledge']
  // Echo keeps its existing member and Studio policies; tool profiles are
  // intentionally scoped to the other DSH surfaces.
  if (hint.surface === 'echo') return null
  return {
    'preventive-monitor': ['radar'], monitor: ['execution'],
    home: ['knowledge'], 'context-graph': ['knowledge'],
    spec: ['plans'], journeys: ['plans'], 'journey-overview': ['plans'],
    automate: ['authoring'], performance: ['performance'],
    'voidr-gate': ['code'], teams: ['knowledge'],
    'third-party-management': ['third-party'],
  }[hint.surface] ?? null
}

export function profileToolVisible(name, domains, { development = false, extraTools = [], centralHome = false, capabilityDomains = [], profileTools = [] } = {}) {
  if (centralHome) {
    if (HOME_CORE.has(name) || extraTools.includes(name)) return true
    if (matches(name, profileTools)) return true
    if (development && (NATIVE_DEVELOPMENT.has(name) || name === 'todo_write')) return true
    if (capabilityDomains.length && name === 'render_widget') return true
    if (capabilityDomains.includes('kod') && matches(name, DOMAINS.kod)) return true
    return domains.some(domain => matches(name, DOMAINS[domain] ?? []))
  }
  if (/^mcp__voidr__kod_/.test(name)) return true
  if (name === 'expand_tool_scope') return true
  if (CORE.has(name)) return true
  if (development && NATIVE_DEVELOPMENT.has(name)) return true
  if (extraTools.includes(name)) return true
  return domains.some(domain => matches(name, DOMAINS[domain] ?? []))
}

function scopeEvents(events, { persistent = false } = {}) {
  const history = events ?? []
  if (persistent) {
    const reset = history.findLastIndex(event => event.type === TOOL_SCOPE_EVENT && event.data?.reset === true)
    return history.slice(reset + 1).filter(event => event.type === TOOL_SCOPE_EVENT)
  }
  const currentTurn = history.findLastIndex(event => event.type === 'turn/start')
  return history.slice(currentTurn + 1).filter(event => event.type === TOOL_SCOPE_EVENT)
}

export function expandedDomains(events, options) {
  return scopeEvents(events, options)
    .map(event => event.data?.domain).filter(domain => TOOL_DOMAINS.includes(domain))
}

export function expandedToolNames(events, options) {
  return scopeEvents(events, options)
    .map(event => event.data?.toolName)
    .filter(name => typeof name === 'string' && name.length > 0)
}
