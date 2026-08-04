import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { win32 as windowsPath } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

// Windows ships npm and npx only as .cmd shims: CreateProcess completes a bare
// name with .exe, so the shim is invisible here, and Node refuses to run a .cmd
// without a shell. Running through a shell would rebuild the command line by
// interpolating platform-provided arguments, so the shim is located on PATH and
// the JS entry point of that same toolchain is executed directly instead.
const WINDOWS_CLI_ENTRIES = {
  npm: 'npm-cli.js',
  npx: 'npx-cli.js'
}
const WINDOWS_EXECUTABLE_SUFFIXES = ['.exe', '.cmd', '.bat']

const NETWORK_ERROR_MARKERS = [
  'eai_again',
  'enotfound',
  'econnrefused',
  'econnreset',
  'etimedout',
  'ehostunreach',
  'enetunreach',
  'getaddrinfo',
  'fetch failed',
  'network request failed',
  'network is unreachable',
  'could not resolve host',
  'socket hang up'
]

const SENSITIVE_OUTPUT_LINE =
  /(secret|password|senha|token|authorization|client[_-]?secret|api[_-]?key)/i

export async function runCommand(file, args, options = {}) {
  const resolved = resolveNodeToolchainCommand(file, args, {
    env: options.env
  })
  try {
    return await execFileAsync(resolved.file, resolved.args, {
      cwd: options.cwd,
      timeout: options.timeout || 30_000,
      maxBuffer: options.maxBuffer || 10 * 1024 * 1024,
      env: options.env
    })
  } catch (error) {
    throw new Error(describeCommandFailure(file, args, error))
  }
}

// Only npm and npx are rewritten: node, git, and gh are real .exe files that
// resolve normally, and every other platform runs the command as given.
export function resolveNodeToolchainCommand(file, args, options = {}) {
  const platform = options.platform || process.platform
  const entry = WINDOWS_CLI_ENTRIES[String(file || '').toLowerCase()]
  if (platform !== 'win32' || !entry) return { file, args }

  const exists = options.exists || existsSync
  const nodeDirectory = windowsPath.dirname(options.execPath || process.execPath)
  const directories = [
    ...windowsPathEntries(options.env || process.env),
    nodeDirectory
  ]
  const shim = findWindowsCommand(file, directories, exists)
  // A real executable needs no rewriting, only an absolute path.
  if (shim?.suffix === '.exe') return { file: shim.path, args }

  for (const directory of shim ? [shim.directory, nodeDirectory] : directories) {
    const cli = windowsPath.join(
      directory,
      'node_modules',
      'npm',
      'bin',
      entry
    )
    if (!exists(cli)) continue
    // The Node binary that ships with the located toolchain keeps npm and the
    // repository on the same runtime; the bridge's own binary is the fallback.
    const node = windowsPath.join(directory, 'node.exe')
    return {
      file: exists(node) ? node : options.execPath || process.execPath,
      args: [cli, ...args]
    }
  }

  throw new Error(
    shim
      ? `${file} was found at ${shim.path}, but the Node toolchain that owns it ` +
        `does not expose ${entry} next to it, so it cannot run without a shell. ` +
        `Verify the Node installation that provides ${file} and retry.`
      : `${file} is not reachable from this shell: neither ${file}.exe nor ` +
        `${file}.cmd exists in PATH. On Windows the plugin needs the directory ` +
        `of the active Node toolchain — the one that owns ${file} — on the PATH ` +
        'this extension inherits. Activate the Node version this repository ' +
        'requires in a terminal (with the version manager already installed ' +
        'there), open VS Code from that terminal, and retry. Never install a ' +
        'second package manager and never run this step manually in the ' +
        'terminal.'
  )
}

// The runtime gate has to measure the Node that will actually execute Playwright.
// On Windows that is the node.exe of the toolchain that owns the npx shim, which
// is not necessarily the one a bare `node` resolves to; anywhere else, and when
// no toolchain is reachable, the shell's own `node` is the answer and the failure
// surfaces from the step that needs it.
export function nodeExecutableForToolchain(options = {}) {
  try {
    const resolved = resolveNodeToolchainCommand('npx', [], options)
    return resolved.args.length ? resolved.file : 'node'
  } catch {
    return 'node'
  }
}

function windowsPathEntries(env) {
  const key = Object.keys(env || {}).find(
    name => name.toLowerCase() === 'path'
  )
  return String((key && env[key]) || '')
    .split(';')
    .map(entry => entry.trim().replace(/^"|"$/g, ''))
    .filter(Boolean)
}

function findWindowsCommand(file, directories, exists) {
  for (const directory of directories) {
    for (const suffix of WINDOWS_EXECUTABLE_SUFFIXES) {
      const candidate = windowsPath.join(directory, `${file}${suffix}`)
      if (exists(candidate)) return { path: candidate, directory, suffix }
    }
  }
  return null
}

export function describeCommandFailure(file, args, error) {
  const command = `${file} ${args?.[0] || ''}`.trim()
  if (String(error?.code || '') === 'ENOENT') {
    return `${command} failed because the ${file} executable is not available in this shell.`
  }
  if (isNetworkFailure(error)) {
    return (
      `${command} failed because the network is unreachable from this shell ` +
      '(likely a sandbox without network access). Ask the user once to rerun ' +
      'this step with network access. Do not change registry, cache, ' +
      'lockfile, or package manager.'
    )
  }
  const code = Number.isInteger(error?.code) ? ` (exit ${error.code})` : ''
  const tail = sanitizedOutputTail(error)
  return `${command} failed${code}${tail ? `: ${tail}` : '.'}`
}

export function isNetworkFailure(error) {
  const text = [error?.stderr, error?.stdout, error?.message, error?.code]
    .map(value => String(value || ''))
    .join('\n')
    .toLowerCase()
  return NETWORK_ERROR_MARKERS.some(marker => text.includes(marker))
}

function sanitizedOutputTail(error) {
  const lines = `${error?.stderr || ''}\n${error?.stdout || ''}`
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => !SENSITIVE_OUTPUT_LINE.test(line))
  return lines.slice(-3).join(' | ').slice(0, 400)
}
