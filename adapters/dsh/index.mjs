import { platformExecutionDenial } from '../../core/policies/platform-execution.mjs'
import { agentOwnedAuthoringDenial } from '../../core/policies/agent-owned-authoring.mjs'
import { interactiveTestDevelopmentPrompt } from '../../core/workflow/interactive-test-development.mjs'
import { loadDshPluginSkills } from './plugin-skills.mjs'

const CONTEXT_EVENT_TYPE = 'voidr/project-context-hint'

function contextHint(events) {
  return events.findLast(event => event.type === CONTEXT_EVENT_TYPE)?.data
}

export function registerKnownEvents(knownEventTypes) {
  knownEventTypes.add(CONTEXT_EVENT_TYPE)
}

export const name = 'voidr-agent-plugin-dsh'
export const inject = ['commands', 'skills', 'systemPrompt', 'tools']

export function apply(ctx) {
  const skills = loadDshPluginSkills()
  for (const skill of skills) ctx.skills.register(skill)
  // DSH does not re-interpolate variable values, preserving skill examples and UI hint literals.
  ctx.systemPrompt.variable('voidr_interactive_test_development', context => {
    const events = context.agent?.session?.events ?? []
    const hint = contextHint(events)
    const skillName = { spec: 'voidr-spec', journeys: 'voidr-journeys', automate: 'voidr-automate' }[hint?.surface]
    const skill = skills.find(candidate => candidate.name === skillName)
    return [
      interactiveTestDevelopmentPrompt({ hint }),
      ...(skill ? [`Active surface skill: ${skill.name}\nThese instructions are already loaded for this surface.\n${skill.content}`] : [])
    ].join('\n\n')
  })
  ctx.systemPrompt.section({
    name: 'voidr:interactive-test-development',
    order: 116,
    text: '{{voidr_interactive_test_development}}'
  })
  ctx.commands.register({
    name: 'assistant-context',
    description: 'Attach an untrusted Platform context hint to this session',
    recordInput: false,
    handler: ({ agent, rawInput }) => {
      try {
        const value = JSON.parse(Buffer.from(rawInput.trim(), 'base64url').toString('utf8'))
        const hint = Object.fromEntries(
          [
            'assistantSessionId', 'applicationId', 'testPlanId', 'testCaseSlug', 'moduleSlug',
            'suiteSlug', 'executionId', 'journeyName', 'productType', 'environment', 'severity',
            'hasSpec', 'specVersion', 'specUpdatedAt', 'suiteCount', 'caseCount', 'sessionIds',
            'intent', 'surface'
          ]
            .filter(key => value[key] !== undefined && value[key] !== null)
            .map(key => [key, value[key]])
        )
        if (Object.keys(hint).length > 0) agent.session.append(CONTEXT_EVENT_TYPE, hint)
        return { kind: 'success', text: 'Assistant context registered' }
      } catch {
        return { kind: 'error', text: 'Invalid assistant context' }
      }
    }
  })
  ctx.on('tools/pre-execute', async (exec, next) => {
    const decision = await next()
    if (decision.kind !== 'allow') return decision
    const authoringDenial = agentOwnedAuthoringDenial(exec.name)
    if (authoringDenial) return { kind: 'deny', reason: authoringDenial }
    if (exec.name !== 'bash') return decision
    const denial = platformExecutionDenial({
      command: typeof exec.args?.command === 'string' ? exec.args.command : '',
      platformValidation: true,
      guidance:
        'Use assistant_workspace_deploy_validation followed by assistant_workspace_run_validation.'
    })
    return denial ? { kind: 'deny', reason: denial } : decision
  })
}
