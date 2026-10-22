export const TOOL_SCOPE_EVENT = 'voidr/tool-scope-expanded'

// Visibility is a prompt-size optimization. Service authorization and the
// existing DSH approval policy still decide whether a call may execute.
const CORE = new Set([
  'skill', 'read', 'todo_write', 'ask_user_question', 'render_widget',
  'mcp__voidr__system_search_tools', 'mcp__voidr__system_call_tool',
  'mcp__voidr__system_batch_execute',
  'mcp__voidr__artifacts_read', 'mcp__voidr__artifacts_query',
  'mcp__voidr__artifacts_aggregate', 'mcp__voidr__files_analyze_uploaded_file',
  'mcp__voidr__assistant_help_request', 'mcp__voidr__custom_connectors_list',
])
const DOMAINS = {
  failure: [
    'failure_analysis_read_bundle', 'failure_analysis_read_detail', 'failure_analysis_render_report', 'playwright_get_execution_analytics',
    'playwright_list_execution_failures', 'playwright_get_test_timeline',
    'playwright_get_trace_events', 'playwright_get_test_history',
    'playwright_get_test_dom', 'playwright_list_test_results',
    'test_plans_get_case', 'test_plans_get_tag_history',
    'applications_list_applications', 'applications_get_application',
    'connectors_context_list_active_integrations',
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

export function initialToolDomains(hint) {
  if (!hint || typeof hint.surface !== 'string') return ['knowledge']
  if (hint.surface === 'slack') return hint.radarSituationId ? ['radar'] : ['knowledge']
  // Echo keeps its existing member and Studio policies; tool profiles are
  // intentionally scoped to the other DSH surfaces.
  if (hint.surface === 'echo') return null
  return {
    'preventive-monitor': ['radar'], monitor: ['failure'],
    home: ['knowledge'], 'context-graph': ['knowledge'],
    spec: ['plans'], journeys: ['plans'], 'journey-overview': ['plans'],
    automate: ['authoring'], performance: ['performance'],
    'voidr-gate': ['code'], teams: ['knowledge'],
    'third-party-management': ['third-party'],
  }[hint.surface] ?? null
}

export function profileToolVisible(name, domains, { development = false, extraTools = [] } = {}) {
  if (name === 'expand_tool_scope') return true
  if (CORE.has(name)) return true
  if (development && NATIVE_DEVELOPMENT.has(name)) return true
  if (extraTools.includes(name)) return true
  return domains.some(domain => matches(name, DOMAINS[domain] ?? []))
}

function currentTurnEvents(events) {
  const history = events ?? []
  const currentTurn = history.findLastIndex(event => event.type === 'turn/start')
  return history.slice(currentTurn + 1).filter(event => event.type === TOOL_SCOPE_EVENT)
}

export function expandedDomains(events) {
  return currentTurnEvents(events)
    .map(event => event.data?.domain).filter(domain => TOOL_DOMAINS.includes(domain))
}

export function expandedToolNames(events) {
  return currentTurnEvents(events)
    .map(event => event.data?.toolName)
    .filter(name => typeof name === 'string' && name.length > 0)
}
