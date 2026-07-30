import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

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
  try {
    return await execFileAsync(file, args, {
      cwd: options.cwd,
      timeout: options.timeout || 30_000,
      maxBuffer: options.maxBuffer || 10 * 1024 * 1024,
      env: options.env
    })
  } catch (error) {
    throw new Error(describeCommandFailure(file, args, error))
  }
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
