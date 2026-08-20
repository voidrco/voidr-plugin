// The one act that stays forbidden through any channel: starting a worker
// process from here. Automation runs and healing runs are requested from the
// platform, which owns their scheduling, their credentials, and their audit
// trail — a job started from a developer session has none of that.
//
// Nothing else is enforced here. The credential store, .env contents, and the
// legacy mutable deploy were part of this set and were removed on purpose:
// they are the developer's own machine and the developer's own call.
//
// No session state is read. A protection that only applies once a workflow is
// "active" is not a protection: the flag is armed from prompt wording alone.

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

function workerDispatch({ rawToolName, toolName, toolArgs, policy }) {
  const searchable = `${rawToolName}\n${toolName}\n${collectStringValues(
    toolArgs
  ).join('\n')}`.toLowerCase()

  const forbiddenTool = (policy.forbiddenTools || []).find(name =>
    searchable.includes(name.toLowerCase())
  )
  if (forbiddenTool) {
    return `Blocked by Voidr policy: ${forbiddenTool} starts a Hive job. Automation and healing runs are requested from the platform, which owns their scheduling and audit trail.`
  }

  const forbiddenRequest = (policy.forbiddenRequestFragments || []).find(
    fragment => searchable.includes(fragment.toLowerCase())
  )
  if (forbiddenRequest) {
    return `Blocked by Voidr policy: ${forbiddenRequest} is a job-dispatch endpoint. Request the run from the platform instead.`
  }

  // Shell only past this point: an MCP tool call cannot smuggle a command.
  if (!isShellTool(rawToolName)) return null
  const fragment = (policy.forbiddenShellFragments || []).find(value =>
    searchable.includes(value.toLowerCase())
  )
  if (fragment) {
    return `Blocked by Voidr policy: this command starts a Hive job (${fragment}). Request the run from the platform instead.`
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
