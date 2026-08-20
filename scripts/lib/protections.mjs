import { homedir } from 'node:os'
import { basename } from 'node:path'

// The acts that stay forbidden through any channel, separated from the workflow
// choreography they used to live beside. Two differences from that origin:
//
// 1. No session state. The old gates opened with `if (state.workflowActive
//    !== true) return`, so a credential read or a legacy deploy was only
//    refused inside a workflow the prompt hook had armed from wording alone.
//    Whether a secret may be printed does not depend on that.
// 2. Pure. Every check takes the request and returns a reason or null, with no
//    I/O and no process exit, so the rules are testable directly instead of
//    only through a subprocess.
//
// The old guard keeps its own copy of these checks. It is unwired and its 93
// tests pin the behaviour it had, so it was left alone rather than refactored
// under them — the duplication is a known follow-up, not an oversight.

function toolNameWords(name) {
  return String(name || '').replace(/([a-z0-9])([A-Z])/g, '$1-$2')
}

// VS Code names its terminal tool run_in_terminal, so matching shell names
// alone would leave these acts unchecked on that host.
export function isShellTool(name) {
  return /(^|[-_/])(bash|shell|powershell|terminal|cmd)$/i.test(String(name))
}

function isEditorTool(name) {
  return /(^|[-_/])(create|edit|write|delete|replace|apply_patch|str_replace_editor|read|read_file|view|open_file|grep|glob)(?:$|[-_/])/i.test(
    toolNameWords(name)
  )
}

export function collectPathArguments(value) {
  if (!value || typeof value !== 'object') return []
  const results = []
  for (const [key, child] of Object.entries(value)) {
    if (
      typeof child === 'string' &&
      /(^|_)(path|file|filename|filePath)$/i.test(key)
    ) {
      results.push(child)
    } else if (child && typeof child === 'object') {
      results.push(...collectPathArguments(child))
    }
  }
  return results
}

export function collectPatchPaths(value) {
  if (typeof value === 'string') {
    const results = []
    for (const pattern of [
      /^\*{3} (?:Add|Update|Delete) File:\s*(.+)$/gm,
      /^\+\+\+\s+(?:b\/)?(.+)$/gm
    ]) {
      for (const match of value.matchAll(pattern)) {
        const path = match[1].trim()
        if (path && path !== '/dev/null') results.push(path)
      }
    }
    return results
  }
  if (!value || typeof value !== 'object') return []
  return Object.values(value).flatMap(collectPatchPaths)
}

export function collectStringValues(value) {
  if (typeof value === 'string') return [value]
  if (!value || typeof value !== 'object') return []
  return Object.values(value).flatMap(collectStringValues)
}

// Anchored on the directory, not on named files: the fragment list spells out
// specific filenames, so anything else under the store was readable. Only the
// one in the user's home — a test repository keeps its own .voidr directory
// for build output, which is not secret material.
const STORE_PATH = '/.voidr/'

function touchesCredentialDirectory(surface) {
  const home = homedir().toLowerCase()
  return (
    surface.includes(`~${STORE_PATH}`) ||
    surface.includes(`$home${STORE_PATH}`) ||
    surface.includes(`${home}${STORE_PATH}`)
  )
}

// Paths and commands only, never file CONTENT. A write carries its whole body
// in the arguments, so scanning everything refused a document that merely
// mentioned the credential path — observed repeatedly while writing about
// these very rules.
function credentialSurface(rawToolName, toolName, toolArgs) {
  const shell = isShellTool(rawToolName)
  return [
    rawToolName,
    toolName,
    ...collectPathArguments(toolArgs),
    ...collectPatchPaths(toolArgs),
    ...(shell ? collectStringValues(toolArgs) : [])
  ]
    .join('\n')
    .toLowerCase()
}

function credentialStore({ rawToolName, toolName, toolArgs, policy }) {
  const surface = credentialSurface(rawToolName, toolName, toolArgs)
  const named = (policy.protectedCredentialFragments || []).find(fragment =>
    surface.includes(fragment.toLowerCase())
  )
  if (!named && !touchesCredentialDirectory(surface)) return null
  return 'Blocked by Voidr policy: Service Account credential files can only be handled by the protected local authentication tools.'
}

function envFileThroughEditor({ rawToolName, toolArgs }) {
  if (!isEditorTool(rawToolName)) return null
  const paths = [
    ...collectPathArguments(toolArgs),
    ...collectPatchPaths(toolArgs)
  ]
  const touches = paths.some(value => {
    const base = basename(String(value))
    return /^\.env(?:\..+)?$/.test(base) && base !== '.env.example'
  })
  if (!touches) return null
  return 'Blocked by Voidr policy: .env files are opaque secret material — never read, create, or edit them with editor tools. Check only that the file exists; voidr env pull provisions its values.'
}

function normalizedShellText(toolArgs) {
  return collectStringValues(toolArgs)
    .join('\n')
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function envFileThroughShell({ rawToolName, toolArgs }) {
  if (!isShellTool(rawToolName)) return null
  const shell = normalizedShellText(toolArgs)
  const referencesEnvFile =
    /(?:^|[\s"'`=(:])(?:\.\/|[~$\w./{}-]*\/)?\.env(?:\.[\w.-]+)?(?=$|[\s"'`);|&<])/.test(
      shell
    )
  if (!referencesEnvFile) return null
  // `ls` and `test -f` answer existence, which the rule allows. Only reading
  // or printing the contents is refused.
  const readsOrPrints =
    /(?:^|[;|&(]\s*|\b)(?:cat|bat|less|more|head|tail|tac|nl|strings|xxd|od|hexdump|grep|egrep|fgrep|rg|ag|sed|awk|cut|paste|column|vi|vim|nano|emacs|code|open)\b/.test(
      shell
    ) || /(?:^|[;|&]\s*)(?:source|\.)\s+\S*\.env\b/.test(shell)
  if (!readsOrPrints) return null
  return 'Blocked by Voidr policy: never read or print .env contents. Validate only file existence, permissions, and key names. If a value was already exposed, recommend rotating it.'
}

function legacyMutableDeploy({ rawToolName, toolArgs, policy }) {
  if (!isShellTool(rawToolName)) return null
  const shell = normalizedShellText(toolArgs)
  const fragment = (policy.forbiddenDeployShellFragments || []).find(value =>
    shell.includes(value.toLowerCase())
  )
  const pattern =
    /\bvoidr\s+deploy-latest\b/.test(shell) ||
    /\bnpm\b[^;&|\n]*\brun\b[^;&|\n]*\bvoidr:deploy(?:-latest)?\b/.test(shell)
  if (!fragment && !pattern) return null
  return 'Blocked by Voidr policy: legacy mutable deployment bypasses the immutable latest release gate. Deploy through voidr_release_deploy_live or voidr_release_deploy_validation, which publish a verifiable codebaseVersion.'
}

function processDispatch({ rawToolName, toolName, toolArgs, policy }) {
  const searchable = `${rawToolName}\n${toolName}\n${collectStringValues(
    toolArgs
  ).join('\n')}`.toLowerCase()
  const forbiddenTool = (policy.forbiddenTools || []).find(name =>
    searchable.includes(name.toLowerCase())
  )
  if (forbiddenTool) {
    return `Blocked by Voidr policy: ${forbiddenTool} can reach a Hive process.`
  }
  const forbiddenRequest = (policy.forbiddenRequestFragments || []).find(
    fragment => searchable.includes(fragment.toLowerCase())
  )
  if (forbiddenRequest) {
    return `Blocked by Voidr policy: ${forbiddenRequest} is a process-dispatch endpoint.`
  }
  if (!isShellTool(rawToolName)) return null
  const fragment = (policy.forbiddenShellFragments || []).find(value =>
    searchable.includes(value.toLowerCase())
  )
  if (fragment) {
    return `Blocked by Voidr policy: this command reaches a Hive process (${fragment}). Automation and healing runs are requested from the platform, never from here.`
  }
  return null
}

// Ordered so the most specific reason wins: a command that both prints .env and
// deploys should name the act being refused, not the broadest rule it trips.
const PROTECTIONS = [
  credentialStore,
  envFileThroughEditor,
  envFileThroughShell,
  legacyMutableDeploy,
  processDispatch
]

export function findProtectionDenial(request) {
  for (const protection of PROTECTIONS) {
    const reason = protection(request)
    if (reason) return reason
  }
  return null
}
