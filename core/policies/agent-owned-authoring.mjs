export const AGENT_OWNED_AUTHORING_TOOLS = Object.freeze({
  coverage_generate_from_sessions: 'voidr-journeys',
  coverage_generate_from_documentation: 'voidr-journeys',
  coverage_apply_inferred_cases: 'voidr-journeys',
  recording_interpret_journey: 'voidr-spec',
  test_plan_generation_generate_test_plan_draft: 'voidr-journeys',
  test_plan_generation_apply_test_plan_draft: 'voidr-journeys',
  agent_jobs_trigger_automation: 'voidr-automate',
  agent_jobs_trigger_hive_automation: 'voidr-automate'
})

export function canonicalAuthoringToolName(value) {
  const name = String(value || '')
  return Object.keys(AGENT_OWNED_AUTHORING_TOOLS).find(candidate =>
    name === candidate ||
    name.endsWith(`-${candidate}`) ||
    name.endsWith(`_${candidate}`) ||
    name.endsWith(`__${candidate}`) ||
    name.endsWith(`/${candidate}`)
  )
}

export function agentOwnedAuthoringDenial(value) {
  const tool = canonicalAuthoringToolName(value)
  if (!tool) return null
  const skill = AGENT_OWNED_AUTHORING_TOOLS[tool]
  return `Blocked by Voidr policy: ${tool} delegates authoring outside this agent. Load ${skill} and perform the work directly with the plugin skill.`
}
