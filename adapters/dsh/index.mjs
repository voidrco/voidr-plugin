import { platformExecutionDenial } from '../../core/policies/platform-execution.mjs'
import { interactiveTestDevelopmentPrompt } from '../../core/workflow/interactive-test-development.mjs'

const CONTEXT_EVENT_TYPE = 'voidr/project-context-hint'

function contextHint(events) {
  return events.findLast(event => event.type === CONTEXT_EVENT_TYPE)?.data
}

export function registerKnownEvents(knownEventTypes) {
  knownEventTypes.add(CONTEXT_EVENT_TYPE)
}

export const name = 'voidr-agent-plugin-dsh'
export const inject = ['commands', 'systemPrompt', 'tools']

export function apply(ctx) {
  ctx.systemPrompt.section({
    name: 'voidr:interactive-test-development',
    order: 114,
    text: context => {
      const events = context.agent?.session?.events ?? []
      return interactiveTestDevelopmentPrompt({ hint: contextHint(events) })
    }
  })
  ctx.commands.register({
    name: 'assistant-context',
    description: 'Attach an untrusted Platform context hint to this session',
    recordInput: false,
    handler: ({ agent, rawInput }) => {
      try {
        const value = JSON.parse(Buffer.from(rawInput.trim(), 'base64url').toString('utf8'))
        const hint = Object.fromEntries(
          ['assistantSessionId', 'applicationId', 'testPlanId', 'testCaseSlug']
            .filter(key => typeof value[key] === 'string' && value[key].length > 0)
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
    if (decision.kind !== 'allow' || exec.name !== 'bash') return decision
    const denial = platformExecutionDenial({
      command: typeof exec.args?.command === 'string' ? exec.args.command : '',
      platformValidation: true,
      guidance:
        'Use assistant_workspace_deploy_validation followed by assistant_workspace_run_validation.'
    })
    return denial ? { kind: 'deny', reason: denial } : decision
  })
}
