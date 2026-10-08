import { execFile } from 'node:child_process'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'
import { recordPreparedCodebase } from './third-party-discovery.mjs'

const executeFile = promisify(execFile)
const gitOptions = ['-c', 'core.hooksPath=/dev/null', '-c', 'credential.helper=', '-c', 'http.followRedirects=false',
  '-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always']

function cloneTarget(response) {
  try {
    const url = new URL(response.repoUrl)
    if (url.protocol !== 'https:' || url.search || url.hash || !url.username || !url.password) throw new Error()
    const credentials = { VOIDR_GIT_USERNAME: decodeURIComponent(url.username), VOIDR_GIT_TOKEN: decodeURIComponent(url.password) }
    url.username = ''
    url.password = ''
    return { url: url.href, credentials, branch: response.defaultBranch }
  } catch { throw new Error('Repository inspection requires an authenticated HTTPS clone target') }
}

async function cloneCodebase({ root, target, branch, signal }) {
  const askpass = join(root, 'askpass.sh')
  const checkout = join(root, 'source')
  await writeFile(askpass, '#!/bin/sh\ncase "$1" in\n*Username*) printf "%s\\n" "$VOIDR_GIT_USERNAME" ;;\n*) printf "%s\\n" "$VOIDR_GIT_TOKEN" ;;\nesac\n', { mode: 0o700 })
  const env = { PATH: process.env.PATH, HOME: root, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0', GIT_LFS_SKIP_SMUDGE: '1', GIT_ASKPASS: askpass, ...target.credentials }
  const run = args => executeFile('git', [...gitOptions, ...args], { cwd: root, env, signal, timeout: 180000, maxBuffer: 1024 * 1024 })
  try {
    await run(['clone', '--depth', '1', '--single-branch', '--no-tags', '--branch', branch, '--', target.url, checkout])
    const revision = (await run(['-C', checkout, 'rev-parse', 'HEAD'])).stdout.trim()
    await run(['-C', checkout, 'remote', 'remove', 'origin'])
    return { workspacePath: checkout, revision, branch, repository: target.url }
  } catch {
    throw new Error('Could not prepare the selected codebase. Check repository access and branch; no credentials were exposed.')
  } finally {
    await rm(askpass, { force: true })
  }
}

export function registerThirdPartyCodebase(ctx, callTool) {
  ctx.tools.register({
    name: 'third_party_prepare_codebase',
    description: 'Prepare an isolated source checkout for Third Parties discovery, using an authorized repositoryId from voidr_gate_list_repositories. Returns the local path and exact commit for read/grep tools. Credentials stay inside this tool. Does not install dependencies, run application code, create partners or call third parties.',
    parameters: { type: 'object', additionalProperties: false, required: ['repositoryId'], properties: {
      repositoryId: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' },
      branch: { type: 'string', minLength: 1, maxLength: 250 }
    } },
    output: { schema: { type: 'object', additionalProperties: false, properties: {
      workspacePath: { type: 'string' }, revision: { type: 'string' }, branch: { type: 'string' }, repository: { type: 'string' }
    }, required: ['workspacePath', 'revision', 'branch', 'repository'] },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: async (args, exec) => {
      if (!/^[a-f\d]{24}$/i.test(args.repositoryId ?? '')) throw new Error('Select a registered repository')
      const cwd = exec.agent?.session?.header?.cwd
      if (!cwd || !isAbsolute(cwd)) throw new Error('An isolated Assistant session workspace is required')
      const target = cloneTarget(await callTool(exec.agent, 'voidr_gate_get_clone_url', { repositoryId: args.repositoryId }, exec.signal))
      const branch = args.branch ?? target.branch
      if (typeof branch !== 'string' || !branch || branch.length > 250 || branch.startsWith('-') || /[\x00-\x20]/.test(branch))
        throw new Error('Select a valid repository branch')
      const root = await mkdtemp(join(await realpath(cwd), `third-party-${args.repositoryId}-`))
      try {
        const source = await cloneCodebase({ root, target, branch, signal: exec.signal })
        await recordPreparedCodebase(root, { ...source, repositoryId: args.repositoryId })
        return source
      }
      catch (error) { await rm(root, { recursive: true, force: true }); throw error }
    }
  })
}
