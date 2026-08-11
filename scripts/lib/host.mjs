
export const COPILOT = 'copilot'
export const CLAUDE = 'claude'

export function detectHost(payload) {
  const override = String(process.env.VOIDR_PLUGIN_HOST || '')
    .trim()
    .toLowerCase()
  if (override === CLAUDE || override === COPILOT) return override
  if (payload?.hook_event_name) return CLAUDE
  if (payload?.hookEventName) return CLAUDE
  if (process.env.CLAUDE_PLUGIN_ROOT || process.env.CLAUDE_PLUGIN_DATA) {
    return CLAUDE
  }
  return COPILOT
}

// Copilot uses camelCase, Claude uses snake_case
export function normalizeHookPayload(payload) {
  return {
    host: detectHost(payload),
    event: String(payload?.hook_event_name || payload?.hookEventName || ''),
    sessionId: payload?.sessionId || payload?.session_id || null,
    cwd: payload?.cwd || null,
    rawToolName: String(payload?.toolName || payload?.tool_name || ''),
    toolArgs: payload?.toolArgs ?? payload?.tool_input ?? {},
    toolResult: payload?.toolResult ?? payload?.tool_response,
    prompt: payload?.prompt,
    transformedPrompt: payload?.transformedPrompt,
    transcriptPath: payload?.transcriptPath || payload?.transcript_path || null,
    lastAssistantMessage:
      payload?.last_assistant_message ?? payload?.lastAssistantMessage ?? null,
    agentId: payload?.agent_id || payload?.agentId || null,
    agentType: payload?.agent_type || payload?.agentType || null
  }
}

// Claude reports subagents explicitly. Copilot does not
export function isSubagentPayload(payload) {
  return Boolean(payload?.agent_id || payload?.agentId)
}

export function userPromptOutput(host, { transformedPrompt, guidance }) {
  if (!guidance) return {}
  if (host === CLAUDE) {
    return {
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: `Skills named below as /voidr-<name> are this plugin's, invoked as /voidr:voidr-<name>.\n\n${guidance}`
      }
    }
  }
  return {
    modifiedTransformedPrompt: `${String(transformedPrompt || '')}\n\n${guidance}`
  }
}

export function postToolContextOutput(additionalContext) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext
    }
  }
}

export function stopBlockOutput(host, reason) {
  if (host === CLAUDE) {
    // Claude reads decision/reason at the top level of the hook output.
    return { decision: 'block', reason }
  }
  return {
    hookSpecificOutput: {
      hookEventName: 'Stop',
      decision: 'block',
      reason
    }
  }
}
