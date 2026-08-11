// Host adapter for the two agent hosts this plugin ships to: GitHub Copilot
// CLI and Claude Code.
//
// The two hosts agree on almost everything that matters here — the plugin
// layout, the MCP stdio wire format, and the shape of a tool call. They
// disagree on exactly three things:
//
//   1. how a hook event is named and where its config file lives;
//   2. what a hook is allowed to return (Claude's UserPromptSubmit cannot
//      rewrite the prompt, and its Stop decision is read at the top level);
//   3. which variable expands to the plugin root.
//
// Every one of those differences is resolved in this module, so the policy
// engine, the skills, and the MCP bridge stay host-agnostic.

export const COPILOT = 'copilot'
export const CLAUDE = 'claude'

// Claude Code stamps hook_event_name on every hook payload it sends; Copilot
// never does. That makes the payload itself the most reliable signal, and it
// keeps detection working when both CLIs run on the same machine.
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

// One payload shape for both hosts. Copilot uses camelCase, Claude uses
// snake_case, and a few fields exist on only one side.
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
    // Claude hands the Stop hook the final assistant text directly, which
    // removes the need to parse a host-specific transcript format.
    lastAssistantMessage:
      payload?.last_assistant_message ?? payload?.lastAssistantMessage ?? null,
    agentId: payload?.agent_id || payload?.agentId || null,
    agentType: payload?.agent_type || payload?.agentType || null
  }
}

// Claude reports subagents explicitly. Copilot does not, so the gate hooks
// keep inferring it from the absence of recorded user messages.
export function isSubagentPayload(payload) {
  return Boolean(payload?.agent_id || payload?.agentId)
}

export function userPromptOutput(host, { transformedPrompt, guidance }) {
  if (!guidance) return {}
  if (host === CLAUDE) {
    // UserPromptSubmit cannot rewrite the prompt. additionalContext reaches
    // the model alongside the prompt, which is the same effect the Copilot
    // rewrite produced by appending the note to the transformed prompt.
    return {
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: guidance
      }
    }
  }
  return {
    modifiedTransformedPrompt: `${String(transformedPrompt || '')}\n\n${guidance}`
  }
}

// Both hosts read PostToolUse context from the same place, so this one takes
// no host. Give it one the day they diverge.
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
