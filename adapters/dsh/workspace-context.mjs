import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { contextBootstrap, readContextManifest, remoteResultJson, ensureGitignoreEntry } from '../../scripts/lib/context.mjs'
import { prepareTestRepository } from '../../scripts/lib/prepare.mjs'
import { buildRepository } from '../../scripts/lib/scaffold.mjs'

const normalizeRepository = value => String(value).replace(/\.git$/i, '').replace(/\/$/, '').toLowerCase()

export function assertContextFiles(root) {
  for (const name of ['project.json', 'manifest-context.json', '.gitignore', '.env']) {
    const path = join(root, name)
    try {
      if (lstatSync(path).isSymbolicLink()) throw new Error(`Context file must not be a symbolic link: ${name}`)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
}

export function workspaceContextReady(root, binding) {
  try {
    assertContextFiles(root)
    const project = JSON.parse(readFileSync(join(root, 'project.json'), 'utf8'))
    const manifest = readContextManifest(root)
    return Boolean(binding && manifest &&
      project.orgId === binding.organizationId && project.appId === binding.applicationId &&
      project.testPlanId === binding.testPlanId && manifest.organizationId === binding.organizationId &&
      manifest.applicationId === binding.applicationId && manifest.planId === binding.testPlanId &&
      manifest.environmentSlug && manifest.repository.path === root &&
      normalizeRepository(manifest.repository.url) === normalizeRepository(binding.repositoryUrl) &&
      ['npmInstall', 'linked', 'scaffolded', 'envPulled'].every(key => manifest.bootstrap?.[key] === true))
  } catch {
    return false
  }
}

export async function prepareDshContext({ root, binding, environmentSlug, refreshOnly = false, cliEnvironment, callRemote, run }) {
  assertContextFiles(root)
  if (realpathSync(root) !== root) throw new Error('The session workspace must not be a symbolic link')
  if (execFileSync('git', ['ls-files', '--cached', '--', '.env'], { cwd: root, encoding: 'utf8' }).trim()) {
    throw new Error('Remove .env from Git tracking before preparing environment secrets')
  }
  if (refreshOnly && !workspaceContextReady(root, binding)) {
    throw new Error('Complete assistant_workspace_prepare before refreshing this context')
  }
  const selectedEnvironment = environmentSlug || readContextManifest(root)?.environmentSlug
  if (refreshOnly && selectedEnvironment !== readContextManifest(root)?.environmentSlug) {
    throw new Error('Changing environment requires assistant_workspace_prepare before context refresh')
  }
  const scopedRemote = async (name, args) => {
    const result = await callRemote(name, args)
    if (name === 'test_plans_get_test_plan') {
      const plan = remoteResultJson(result)
      if (String(plan?._id || plan?.id) !== binding.testPlanId ||
          String(plan?.applicationId) !== binding.applicationId ||
          plan?.createdBy?.organizationId !== binding.organizationId ||
          normalizeRepository(plan?.gitProviderConfig?.repositoryUrl) !== normalizeRepository(binding.repositoryUrl)) {
        throw new Error('Platform context does not match the authorized session binding')
      }
    }
    return result
  }
  return contextBootstrap({
    planId: binding.testPlanId, environmentSlug: selectedEnvironment, workspaceRoot: root,
    refreshOnly, callRemote: scopedRemote, run,
    locate: async () => ({ path: root, how: 'dsh-session' }),
    prepare: input => {
      ensureGitignoreEntry(root, '.env')
      ensureGitignoreEntry(root, '.npm-cache/')
      return prepareTestRepository({ ...input, repositoryUrl: undefined, cliEnvironment, run })
    }
  })
}

export async function buildDshWorkspace({ root, binding, cliEnvironment, run }) {
  if (!workspaceContextReady(root, binding)) throw new Error('Complete assistant_workspace_prepare: the workspace context is missing or invalid')
  if (existsSync(join(root, 'modules', '_probe'))) throw new Error('Remove temporary probes before building a validation candidate')
  return buildRepository({ repositoryPath: root, repositoryUrl: binding.repositoryUrl, testPlanId: binding.testPlanId, cliEnvironment, run })
}
