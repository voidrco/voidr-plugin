import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runCommand } from './command.mjs'

// Playwright 1.48, pinned by the published Voidr framework, hangs before
// listing or starting workers on newer Node majors (reproduced on 24.x).
const SUPPORTED_NODE_MAJOR = 22

export async function assertSupportedNodeRuntime({
  repositoryPath,
  run = runCommand
}) {
  const declared = declaredNodeVersion(repositoryPath)
  const result = await run('node', ['--version'], {
    cwd: repositoryPath,
    timeout: 15_000,
    env: process.env
  })
  const version = String(result?.stdout || '').trim()
  const major = Number.parseInt(version.replace(/^v/i, ''), 10)
  if (!Number.isInteger(major) || major <= 0) {
    throw new Error(
      'Could not determine the Node.js version that runs inside the selected ' +
        'test repository. Verify that this shell can execute node --version ' +
        'in that directory.'
    )
  }
  if (declared.major && major !== declared.major) {
    throw new Error(
      `The repository pins Node ${declared.raw} (${declared.source}) but this ` +
        `shell resolves ${version}. Playwright 1.48 hangs indefinitely on ` +
        `unsupported Node versions. Activate Node ${declared.major} (for ` +
        'example through volta or nvm) and retry. Do not install ' +
        `dependencies or run Playwright on ${version}.`
    )
  }
  if (!declared.major && major !== SUPPORTED_NODE_MAJOR) {
    throw new Error(
      `This shell resolves Node ${version}, but the Voidr Playwright ` +
        `framework requires Node ${SUPPORTED_NODE_MAJOR}. Playwright 1.48 ` +
        'hangs indefinitely on newer majors. Activate Node ' +
        `${SUPPORTED_NODE_MAJOR} and retry.`
    )
  }
  return { version, major }
}

export function declaredNodeVersion(repositoryPath) {
  const packagePath = join(String(repositoryPath || ''), 'package.json')
  if (!existsSync(packagePath)) return { major: null }
  let parsed
  try {
    parsed = JSON.parse(readFileSync(packagePath, 'utf8'))
  } catch {
    return { major: null }
  }
  const volta = String(parsed?.volta?.node || '').trim()
  if (volta) {
    const major = Number.parseInt(volta, 10)
    if (Number.isInteger(major) && major > 0) {
      return { major, raw: volta, source: 'volta' }
    }
  }
  return { major: null }
}
