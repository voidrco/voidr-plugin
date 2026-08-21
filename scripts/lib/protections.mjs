// Two rules. The first is about consequence: a worker job is not started from
// here. The second is about mechanism: an MCP tool is called by calling it, not
// through the shell and not through a subagent.
//
// Starting a worker job from here is forbidden because Automation runs and healing runs are requested from the platform,
// which owns their scheduling, their credentials, and their audit trail — a job
// started from a developer session has none of that.
//
// Nothing else is enforced. The credential store, .env contents, and the legacy
// mutable deploy were part of this set and were removed on purpose: those are
// the developer's own machine and the developer's own call.
//
// No session state is read. A rule that only applies once a workflow is
// "active" is not a rule: that flag is armed from prompt wording alone.

// VS Code names its terminal tool run_in_terminal, so matching shell names
// alone would leave the shell path unchecked on that host.
export function isShellTool(name) {
  return /(^|[-_/])(bash|shell|powershell|terminal|cmd)$/i.test(String(name))
}

export function collectStringValues(value) {
  if (typeof value === 'string') return [value]
  if (!value || typeof value !== 'object') return []
  return Object.values(value).flatMap(collectStringValues)
}

// Naming a job trigger is not requesting one. An earlier version searched every
// string in the arguments, so `grep -rn "<trigger tool>" scripts/` and a note
// that documented a fragment were refused exactly like a real request — the
// same content-versus-intent mistake that got the previous gates removed. What
// follows separates the two by looking at WHO the command runs, not at which
// words appear in it.

// Commands that read, search, print, or record text. A fragment reaching one of
// these is being inspected or written down; none of them can start a process
// from it. `git` is here because a commit message describing this rule is not
// an attempt to break it.
const INSPECTION_COMMANDS = new Set([
  'ack', 'awk', 'bat', 'cat', 'code', 'comm', 'cut', 'diff', 'echo', 'egrep',
  'fd', 'fgrep', 'find', 'git', 'grep', 'head', 'jq', 'less', 'ls', 'man',
  'more', 'nl', 'open', 'printf', 'rg', 'sed', 'sort', 'tail', 'tee', 'tr',
  'type', 'uniq', 'wc', 'which', 'yq'
])

const NETWORK_CLIENTS = /\b(?:curl|wget|http|httpie|xh|fetch)\b/

// One command per pipeline stage, so `cat x | grep y` is judged stage by stage
// and a real request cannot hide behind a leading `echo`.
function commandStages(shellText) {
  return String(shellText)
    .split(/\|\||&&|[;|&\n]/)
    .map(stage => stage.trim())
    .filter(Boolean)
}

function leadingCommand(stage) {
  // Skip env assignments and `sudo`/`npx`-style prefixes to reach the verb.
  const words = stage.split(/\s+/).filter(word => !/^\w+=/.test(word))
  const first = (words[0] || '').replace(/^.*\//, '')
  return first.toLowerCase()
}

function stagesThatRun(shellText, fragment) {
  const needle = fragment.toLowerCase()
  return commandStages(shellText).filter(
    stage =>
      stage.toLowerCase().includes(needle) &&
      !INSPECTION_COMMANDS.has(leadingCommand(stage))
  )
}

function workerDispatch({ rawToolName, toolName, toolArgs, policy }) {
  // A tool name is matched against the tool being CALLED. The same name sitting
  // in an argument is a mention.
  const calledTool = `${rawToolName}\n${toolName}`.toLowerCase()
  const forbiddenTool = (policy.forbiddenTools || []).find(name =>
    calledTool.includes(name.toLowerCase())
  )
  if (forbiddenTool) {
    return `Blocked by Voidr policy: ${forbiddenTool} starts a Hive job. Automation and healing runs are requested from the platform, which owns their scheduling and audit trail.`
  }

  if (!isShellTool(rawToolName)) return null
  const shellText = collectStringValues(toolArgs).join('\n')

  // A route is a request only when something is there to send it.
  if (NETWORK_CLIENTS.test(shellText.toLowerCase())) {
    const forbiddenRequest = (policy.forbiddenRequestFragments || []).find(
      fragment => stagesThatRun(shellText, fragment).length > 0
    )
    if (forbiddenRequest) {
      return `Blocked by Voidr policy: ${forbiddenRequest} is a job-dispatch endpoint. Request the run from the platform instead.`
    }
  }

  const fragment = (policy.forbiddenShellFragments || []).find(
    value => stagesThatRun(shellText, value).length > 0
  )
  if (fragment) {
    return `Blocked by Voidr policy: this command starts a Hive job (${fragment}). Request the run from the platform instead. Searching for the name or writing it into a file is fine — this refusal is about running it.`
  }
  return null
}


// Observed with a smaller model, three minutes into its first request: it
// loaded voidr_context_bootstrap through ToolSearch, then ran `mcp call
// voidr_context_bootstrap` in the shell, then wrapped that same missing binary
// in `node -e`, then concluded "MCP tools have to be reached through an agent"
// and delegated. Seven tool calls, zero MCP calls, and it reported the
// subagent's answer as if it had read the result itself.
//
// `command not found: mcp` was true and precise and taught it nothing, because
// the model was not disobeying an instruction — it had the wrong theory of how
// invocation works and read each failure as needing another wrapper. No skill
// text covers this: none of them imagine having to say that a tool is called by
// calling it. So the correction has to arrive at the moment of the attempt.
// Any MCP tool, not only this plugin's. The mistake is about how invocation
// works, and the answer is the same whichever server owns the tool.
const MCP_TOOL = /\bmcp__[a-z0-9_]+__[a-z0-9_]+|\bmcp\s+call\b/i
const INVOCATION_INTENT =
  /\b(?:use|using|call|calling|invoke|invoking|run|running|execute|chame|chamar|usar|use a|invoque|invocar|execute|executar|rode|rodar)\b/i

function isDelegationTool(name) {
  return /(^|[-_/])(agent|task|subagent)$/i.test(String(name))
}

function invocationPath({ rawToolName, toolArgs }) {
  const text = collectStringValues(toolArgs).join('\n')

  if (isDelegationTool(rawToolName)) {
    if (!MCP_TOOL.test(text) || !INVOCATION_INTENT.test(text)) return null
    return 'Blocked by Voidr policy: call the Voidr tool yourself instead of asking a subagent to call it. A subagent has the same tools and no more, so delegating adds a step and hides the result behind a report. Emit the tool call directly.'
  }

  if (!isShellTool(rawToolName)) return null
  // Same stage test the job rule uses: naming a tool in a grep or a note is
  // not an attempt to call it.
  const attempts = commandStages(text).filter(
    stage =>
      MCP_TOOL.test(stage) &&
      !INSPECTION_COMMANDS.has(leadingCommand(stage))
  )
  if (!attempts.length) return null
  return 'Blocked by Voidr policy: there is no `mcp` command and no shell path to a Voidr tool. These are MCP tools: emit the tool call directly, with its arguments as JSON. If the tool is not in your list, load it with ToolSearch first — but ToolSearch only makes it available, it does not call it.'
}

const PROTECTIONS = [workerDispatch, invocationPath]

export function findProtectionDenial(request) {
  for (const protection of PROTECTIONS) {
    const reason = protection(request)
    if (reason) return reason
  }
  return null
}
