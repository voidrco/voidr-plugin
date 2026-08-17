import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runCommand } from './command.mjs'
import { prepareTestRepository, cloneRequestMessage } from './prepare.mjs'
import { findCheckoutByOrigin, resolveWorkspaceRoot } from './workspace.mjs'

export const CONTEXT_MANIFEST_FILENAME = 'manifest-context.json'
export const CONTEXT_MANIFEST_VERSION = 1

// Session listing is bounded: the manifest carries reference IDs, not an
// archive. Twenty covers the recent recordings a case implementation can
// actually consult without flooding the generate step.
const SESSION_LIMIT = 20

/**
 * Parse the JSON payload of a remote MCP tool result. Remote tools answer
 * with a human preamble on some tools, so the last JSON-parseable line wins —
 * the same convention the bridge uses for remote results.
 */
export function remoteResultJson(result) {
  for (const item of result?.content || []) {
    if (item?.type !== 'text') continue
    const text = String(item.text || '')
    try {
      return JSON.parse(text)
    } catch {
      // Fall through to line-wise parsing below.
    }
    const lines = text
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .reverse()
    for (const line of lines) {
      try {
        return JSON.parse(line)
      } catch {
        // Continue until the last serialized data line is found.
      }
    }
    // Some tools prefix a sentence and then print a JSON block across
    // multiple lines: retry from the first brace.
    const brace = text.indexOf('{')
    if (brace >= 0) {
      try {
        return JSON.parse(text.slice(brace))
      } catch {
        // Give up on this content item.
      }
    }
  }
  return null
}

/**
 * Reduce a full Test Plan document to the ID-only context the manifest
 * carries: plan/application/organization IDs, linked repository, and the
 * module -> suite -> case-slug tree. No AAA content — the generate skill
 * reads cases individually when it needs them.
 */
export function extractPlanContext(planDoc) {
  if (!planDoc || typeof planDoc !== 'object') {
    throw new Error('test_plans_get_test_plan returned no readable plan document.')
  }
  const planId = String(planDoc._id || planDoc.id || '').trim()
  const applicationId = String(planDoc.applicationId || '').trim()
  const organizationId = String(planDoc.createdBy?.organizationId || '').trim()
  const git = planDoc.gitProviderConfig || {}
  const repositoryUrl = String(git.repositoryUrl || '').trim()

  if (!planId || !applicationId) {
    throw new Error(
      'The Test Plan document is missing its plan or application identifier; cannot build a context manifest from it.'
    )
  }
  if (!repositoryUrl) {
    throw new Error(
      'This Test Plan has no linked repository (gitProviderConfig.repositoryUrl). Provision it first with test_plans_provision_repository, then rebuild the context.'
    )
  }

  const modules = (planDoc.modules || []).map(module => ({
    slug: String(module.slug || ''),
    suites: (module.suites || []).map(suite => ({
      slug: String(suite.slug || ''),
      cases: (suite.cases || [])
        .map(testCase => String(testCase.slug || ''))
        .filter(Boolean)
    }))
  }))

  return {
    planId,
    applicationId,
    organizationId,
    repository: {
      url: repositoryUrl,
      defaultBranch: String(git.defaultBranch || 'main')
    },
    modules
  }
}

export function allCaseSlugs(planContext) {
  const slugs = []
  for (const module of planContext.modules || []) {
    for (const suite of module.suites || []) {
      slugs.push(...(suite.cases || []))
    }
  }
  return slugs
}

/**
 * The manifest lives at the ROOT of the test repository so the generate step
 * (and the user) always find it in the same place. It is local by nature —
 * absolute paths and bootstrap state — so it must never be pushed: writing it
 * also guarantees the .gitignore entry.
 */
export function writeContextManifest(repositoryPath, manifest) {
  const manifestPath = join(repositoryPath, CONTEXT_MANIFEST_FILENAME)
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  ensureGitignoreEntry(repositoryPath, CONTEXT_MANIFEST_FILENAME)
  return manifestPath
}

export function readContextManifest(repositoryPath) {
  const manifestPath = join(repositoryPath, CONTEXT_MANIFEST_FILENAME)
  if (!existsSync(manifestPath)) return null
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch {
    return null
  }
}

export function ensureGitignoreEntry(repositoryPath, entry) {
  const gitignorePath = join(repositoryPath, '.gitignore')
  const current = existsSync(gitignorePath)
    ? readFileSync(gitignorePath, 'utf8')
    : ''
  const present = current
    .split(/\r?\n/)
    .some(line => line.trim() === entry)
  if (present) return false
  const separator = current.endsWith('\n') || current === '' ? '' : '\n'
  writeFileSync(gitignorePath, `${current}${separator}${entry}\n`)
  return true
}

/**
 * Atomic context bootstrap for a Test Plan:
 *
 *   1. read the plan from the platform (IDs + linked repository);
 *   2. resolve the platform environment (explicit slug, or the only one);
 *   3. list the application's recorded sessions (reference IDs, best effort);
 *   4. locate the checkout by Git origin — the clone itself is ALWAYS done by
 *      the user (their access to the repository is what the clone proves), so
 *      a missing checkout raises the standard clone handover message;
 *   5. write manifest-context.json at the repository root (gitignored);
 *   6. run the framework preparation (npm install, Service Account auth,
 *      link when project.json is absent, scaffold, env pull) — credentials
 *      are injected only into child processes;
 *   7. stamp the bootstrap state back into the manifest.
 *
 * `callRemote(name, args)` is the bridge's authenticated remote MCP call; the
 * bridge records provenance for these reads exactly as if the model had made
 * them, so downstream tools see a consistent session state.
 */
export async function contextBootstrap({
  planId,
  environmentSlug,
  workspaceRoot,
  callRemote,
  run = runCommand,
  prepare = prepareTestRepository
}) {
  const normalizedPlanId = String(planId || '').trim()
  if (!/^[a-fA-F0-9]{24}$/.test(normalizedPlanId)) {
    throw new Error('contextBootstrap requires a 24-hex Test Plan id.')
  }
  const resolvedRoot = resolveWorkspaceRoot({ explicit: workspaceRoot })

  // 1. Plan document -> ID-only context.
  const planResult = await callRemote('test_plans_get_test_plan', {
    planId: normalizedPlanId
  })
  const planContext = extractPlanContext(remoteResultJson(planResult))

  // 2. Environment: explicit slug validated against the platform listing;
  // with a single environment the choice is unambiguous, otherwise the caller
  // has to ask the user and call again.
  const environmentsResult = await callRemote('applications_list_environments', {
    applicationId: planContext.applicationId
  })
  const environmentsDoc = remoteResultJson(environmentsResult)
  const environments = (Array.isArray(environmentsDoc)
    ? environmentsDoc
    : environmentsDoc?.data || []
  ).map(environment => ({
    name: String(environment.name || ''),
    slug: String(environment.slug || ''),
    applicationUrl: String(environment.applicationUrl || '')
  }))
  const requestedSlug = String(environmentSlug || '').trim().toLowerCase()
  let selectedEnvironment = null
  if (requestedSlug) {
    selectedEnvironment =
      environments.find(environment => environment.slug.toLowerCase() === requestedSlug) || null
    if (!selectedEnvironment) {
      throw new Error(
        `Environment "${environmentSlug}" was not returned by the platform for this application. Available: ${environments.map(environment => environment.slug).join(', ') || '(none)'}.`
      )
    }
  } else if (environments.length === 1) {
    selectedEnvironment = environments[0]
  } else {
    return {
      needsEnvironmentSelection: true,
      environments,
      planId: planContext.planId,
      applicationId: planContext.applicationId,
      message:
        'This application has more than one environment. Ask the user to choose one (render the listing with ask_user) and call voidr_context_bootstrap again with environmentSlug.'
    }
  }

  // 3. Recorded sessions: reference IDs only, best effort — an application
  // without recordings still gets a valid manifest.
  let sessionIds = []
  try {
    const sessionsResult = await callRemote('sessions_list_sessions', {
      applicationId: planContext.applicationId,
      limit: SESSION_LIMIT
    })
    const sessionsDoc = remoteResultJson(sessionsResult)
    sessionIds = (sessionsDoc?.data || [])
      .map(session => String(session.sessionId || ''))
      .filter(Boolean)
  } catch {
    sessionIds = []
  }

  // 4. Checkout by Git origin — never clone on the user's behalf.
  const checkout = findCheckoutByOrigin(resolvedRoot, planContext.repository.url)
  if (!checkout) {
    throw new Error(
      cloneRequestMessage({
        workspaceRoot: resolvedRoot,
        repositoryUrl: planContext.repository.url,
        githubAccount: ''
      })
    )
  }

  // 5. Manifest first: the anchor exists even if preparation fails midway,
  // and the retry updates it in place.
  const manifest = {
    version: CONTEXT_MANIFEST_VERSION,
    createdAt: new Date().toISOString(),
    organizationId: planContext.organizationId,
    applicationId: planContext.applicationId,
    planId: planContext.planId,
    environmentSlug: selectedEnvironment.slug,
    repository: {
      url: planContext.repository.url,
      path: checkout,
      defaultBranch: planContext.repository.defaultBranch
    },
    modules: planContext.modules,
    sessions: sessionIds,
    bootstrap: {
      npmInstall: false,
      linked: false,
      scaffolded: false,
      envPulled: false
    }
  }
  const manifestPath = writeContextManifest(checkout, manifest)

  // 6. Framework preparation (install + SA auth + link + scaffold + env pull).
  const prepared = await prepare({
    repositoryPath: checkout,
    organizationId: planContext.organizationId,
    applicationId: planContext.applicationId,
    testPlanId: planContext.planId,
    environmentSlug: selectedEnvironment.slug,
    cases: allCaseSlugs(planContext),
    repositoryUrl: planContext.repository.url,
    workspaceRoot: resolvedRoot,
    run
  })

  // 7. Stamp the bootstrap state.
  manifest.bootstrap = {
    npmInstall: true,
    linked: true,
    scaffolded: true,
    envPulled: true
  }
  manifest.repository.path = prepared.repositoryPath || checkout
  writeContextManifest(manifest.repository.path, manifest)

  return {
    manifestPath,
    manifest,
    environment: selectedEnvironment,
    prepared
  }
}
