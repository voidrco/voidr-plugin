// The one act that stays forbidden through any channel: starting a worker job
// from here. Automation runs and healing runs are requested from the platform,
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

const PROTECTIONS = [workerDispatch]

export function findProtectionDenial(request) {
  for (const protection of PROTECTIONS) {
    const reason = protection(request)
    if (reason) return reason
  }
  return null
}
