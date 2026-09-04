import { platformExecutionDenial } from '../../core/policies/platform-execution.mjs'
import { agentOwnedAuthoringDenial } from '../../core/policies/agent-owned-authoring.mjs'
import { interactiveTestDevelopmentPrompt } from '../../core/workflow/interactive-test-development.mjs'
import { loadDshPluginSkills } from './plugin-skills.mjs'

const CONTEXT_EVENT_TYPE = 'voidr/project-context-hint'
const SPEND_CONTEXTS_KEY = Symbol.for('voidr.dsh.litellm-contexts.v1')
const SPEND_CONTEXT_LIMIT = 10_000
const SPEND_SUBACTION_BY_SURFACE = {
  home: 'dsh-general',
  spec: 'dsh-spec',
  journeys: 'dsh-journeys',
  'journey-overview': 'dsh-journey-overview',
  automate: 'dsh-automate',
  monitor: 'dsh-failure-analysis'
}

function registerSpendContext(sessionId, surface) {
  const subaction = SPEND_SUBACTION_BY_SURFACE[surface]
  if (!subaction) return
  const root = globalThis
  const registry = root[SPEND_CONTEXTS_KEY] ??= new Map()
  registry.delete(String(sessionId))
  registry.set(String(sessionId), { surface, subaction })
  if (registry.size > SPEND_CONTEXT_LIMIT) registry.delete(registry.keys().next().value)
}

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
    const skillName = {
      spec: 'voidr-spec',
      journeys: 'voidr-journeys',
      automate: 'voidr-automate',
      monitor: 'voidr-failure-analysis'
    }[hint?.surface]
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
            'suiteSlug', 'executionId', 'journeyId', 'journeyName', 'testName', 'productType',
            'environment', 'errorType', 'errorMessage', 'stackTrace', 'filePath', 'line',
            'browser', 'os', 'branch', 'commitSha', 'currentState', 'severity', 'targetType', 'analysisMode',
            'hasSpec', 'specVersion', 'specUpdatedAt', 'suiteCount', 'caseCount', 'sessionIds',
            'intent', 'surface'
          ]
            .filter(key => value[key] !== undefined && value[key] !== null)
            .map(key => [key, value[key]])
        )
        if (Object.keys(hint).length > 0) agent.session.append(CONTEXT_EVENT_TYPE, hint)
        registerSpendContext(agent.id, hint.surface)
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
    const command = typeof exec.args?.command === 'string' ? exec.args.command : ''
    const manualSetup = command.split(/\|\||&&|[;|&\n]/).some(stage =>
      /(?:^|\s)(?:\S*\/)?voidr(?:\.js)?\s+(?:login|link|scaffold|env\s+pull)\b/i.test(stage.trim()) &&
      !/^(?:cat|echo|printf|rg|grep|sed|head|tail|git\s+(?:diff|show))\b/.test(stage.trim()))
    if (manualSetup) return { kind: 'deny', reason:
      'DSH setup uses the organization Service Account supplied by the Service. Call assistant_workspace_prepare with sessionId and environmentSlug; never run interactive voidr login or request credentials from the user.' }
    const denial = platformExecutionDenial({
      command,
      platformValidation: true,
      guidance:
        'Use assistant_workspace_deploy_validation followed by assistant_workspace_run_validation.'
    })
    return denial ? { kind: 'deny', reason: denial } : decision
  })
}
