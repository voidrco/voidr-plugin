import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { basename, join } from 'node:path'
import { runCommand } from './command.mjs'
import { voidrCliEnvironment } from './credentials.mjs'
import {
  assertSupportedNodeRuntime,
  describeNodeRuntime,
  withToolchainPath
} from './node-runtime.mjs'
import {
  findCheckoutByOrigin,
  isInside,
  normalizeGitHubRepositoryUrl,
  resolveWorkspaceRoot,
  validateProvisionedRepositorySelection,
  validateRepositorySelection
} from './workspace.mjs'

export async function prepareTestRepository({
  repositoryPath,
  organizationId,
  applicationId,
  testPlanId,
  environmentSlug,
  cases,
  repositoryUrl,
  workspaceRoot,
  cliEnvironment,
  run = runCommand
}) {
  const resolvedRoot = resolveWorkspaceRoot({ explicit: workspaceRoot })
  const materialized = repositoryUrl
    ? await locateLinkedCheckout({
        workspaceRoot: resolvedRoot,
        repositoryUrl,
        run
      })
    : null
  const selected = repositoryUrl
    ? validateProvisionedRepositorySelection(materialized.path, repositoryUrl)
    : validateRepositorySelection(repositoryPath, resolvedRoot)
  if (!isInside(selected.path, resolvedRoot)) {
    throw new Error(
      `The test repository must live inside the open workspace (${resolvedRoot}), never in a temporary directory. Found: ${selected.path}.`
    )
  }
  const identifiers = validateIdentifiers({
    organizationId,
    applicationId,
    testPlanId,
    environmentSlug
  })
  const selectedCases = validateCases(cases)
  const projectPath = join(selected.path, 'project.json')
  const hadProject = existsSync(projectPath)

  if (hadProject) {
    validateProject(projectPath, identifiers)
  }

  const runtime = await assertSupportedNodeRuntime({
    repositoryPath: selected.path,
    run
  })

  // npm writes `node_modules/.package-lock.json` as the record of what it
  // actually installed. When it is at least as new as the lockfile, the tree
  // already matches — and this is the slowest step of the whole preparation,
  // so re-running it to be told nothing changed is what makes reopening a plan
  // feel stuck.
  const dependenciesInstalled = dependenciesAreCurrent(selected.path)
  if (!dependenciesInstalled) {
    await run('npm', ['install'], {
      cwd: selected.path,
      timeout: 300_000,
      env: withToolchainPath(process.env, runtime.toolchain)
    })
  }

  // The selected plugin Service Account is injected only into Voidr CLI child
  // processes. This deliberately replaces the interactive `voidr login` step.
  const resolvedCliEnvironment =
    cliEnvironment || voidrCliEnvironment()
  if (
    resolvedCliEnvironment.VOIDR_ORG_ID &&
    resolvedCliEnvironment.VOIDR_ORG_ID !== identifiers.organizationId
  ) {
    throw new Error(
      'The selected plugin Service Account belongs to a different organization.'
    )
  }
  // Every child of this gate runs on the runtime the gate approved, which is not
  // always the one this shell resolves.
  const childEnvironment = withToolchainPath(
    {
      ...resolvedCliEnvironment,
      VOIDR_ORG_ID: identifiers.organizationId
    },
    runtime.toolchain
  )

  if (!hadProject) {
    await run(
      'npx',
      [
        '--no-install',
        'voidr',
        'link',
        '--org-id',
        identifiers.organizationId,
        '--app-id',
        identifiers.applicationId,
        '--plan-id',
        identifiers.testPlanId,
        '--yes'
      ],
      {
        cwd: selected.path,
        timeout: 180_000,
        env: childEnvironment
      }
    )
  }

  validateProject(projectPath, identifiers)

  // Scaffolding is idempotent — the CLI skips a spec that exists — but calling
  // it when every selected case already has one spends a process to learn that,
  // and reports `scaffolded: true` for work nobody did. Asking first is cheap
  // and lets the answer say which cases were actually missing.
  const missingSpecs = casesWithoutSpec(join(selected.path, 'modules'), selectedCases)
  if (missingSpecs.length > 0) {
    await run(
      'npx',
      [
        '--no-install',
        'voidr',
        'scaffold',
        '--split-per-case',
        '--cases',
        missingSpecs.join(',')
      ],
      {
        cwd: selected.path,
        timeout: 180_000,
        env: childEnvironment
      }
    )
  }

  await run(
    'npx',
    [
      '--no-install',
      'voidr',
      'env',
      'pull',
      '--env',
      identifiers.environmentSlug,
      '--output',
      '.env'
    ],
    {
      cwd: selected.path,
      timeout: 180_000,
      env: childEnvironment
    }
  )

  const runnerTimeouts = ensureDiagnosableTimeouts(selected.path)

  const specCount = countSpecs(join(selected.path, 'modules'))
  if (specCount === 0) {
    throw new Error(
      'Voidr scaffold completed without creating any Playwright spec under modules/.'
    )
  }
  if (!existsSync(join(selected.path, '.env'))) {
    writeFileSync(join(selected.path, '.env'), '', 'utf8')
  }

  return {
    completed: true,
    repositoryPath: selected.path,
    checkoutSource: materialized?.how || 'given-path',
    organizationId: identifiers.organizationId,
    applicationId: identifiers.applicationId,
    testPlanId: identifiers.testPlanId,
    environmentSlug: identifiers.environmentSlug,
    cases: selectedCases,
    specCount,
    steps: {
      checkoutMaterialized: materialized?.how || 'given-path',
      dependenciesInstalled: !dependenciesInstalled,
      dependenciesAlreadyCurrent: dependenciesInstalled,
      authenticationResolvedFromPluginServiceAccount: true,
      interactiveLoginExecuted: false,
      linked: !hadProject,
      existingProjectValidated: hadProject,
      scaffolded: missingSpecs.length > 0,
      scaffoldedCases: missingSpecs,
      alreadyScaffolded: selectedCases.filter((slug) => !missingSpecs.includes(slug)),
      secretsPulled: true,
      runnerTimeouts,
      nodeRuntime: describeNodeRuntime(runtime)
    }
  }
}

// Locates the platform-linked repository inside the workspace, cloning it when
// it is missing.
//
// `git` runs as the user, on the user's machine, with the user's own
// credentials — the same thing that happens when they type the command
// themselves, which is why doing it for them grants nobody any access they did
// not already have. What it does buy is that the checkout stops depending on
// the model relaying a handover correctly.
//
// Access still has to exist: when git cannot read the repository the clone
// fails, and the handover message takes over with the authorization
// instructions. That failure is the access check, and it is the user's own
// credentials failing it.
async function locateLinkedCheckout({ workspaceRoot, repositoryUrl, run }) {
  const existing = findCheckoutByOrigin(workspaceRoot, repositoryUrl)
  if (existing) return { path: existing, how: 'existing-checkout' }

  const canonical = normalizeGitHubRepositoryUrl(repositoryUrl)
  const destination = join(workspaceRoot, basename(canonical))
  let cloneFailure = ''
  try {
    await run('git', ['clone', `${canonical}.git`, destination], {
      cwd: workspaceRoot,
      timeout: 300_000,
      env: process.env
    })
  } catch (error) {
    // Git's own words, or the reason is lost: "could not be cloned" reads as an
    // authorization problem, and a clone that works in the user's terminal but
    // not here is an environment problem instead — a credential helper this
    // process cannot reach. Telling them apart requires what git said.
    cloneFailure = String(error?.message || error).trim()
    throw new Error(
      cloneRequestMessage({
        workspaceRoot,
        repositoryUrl,
        // The administrator has to authorize an account, so naming it saves a
        // round trip. Best effort only: this is a failure path, and the message
        // stands without it.
        githubAccount: await githubAccountLogin(run),
        cloneFailure
      })
    )
  }

  // Found by origin rather than trusting the destination path: a redirect or a
  // renamed repository lands somewhere else, and the retry looks it up the same
  // way.
  const cloned = findCheckoutByOrigin(workspaceRoot, repositoryUrl)
  if (cloned) return { path: cloned, how: 'cloned' }
  throw new Error(
    cloneRequestMessage({
      workspaceRoot,
      repositoryUrl,
      githubAccount: await githubAccountLogin(run)
    })
  )
}

async function githubAccountLogin(run) {
  try {
    const result = await run('gh', ['api', 'user', '--jq', '.login'], {
      timeout: 15_000,
      env: process.env
    })
    const login = String(result?.stdout || '').trim()
    return /^[a-z0-9-]{1,39}$/i.test(login) ? login : ''
  } catch {
    return ''
  }
}

// The message is the whole handover, so it carries the exact commands and the
// one constraint that makes the retry work: the checkout has to land inside the
// open workspace, which is where it is looked for by Git origin.
export function cloneRequestMessage({
  workspaceRoot,
  repositoryUrl,
  githubAccount,
  cloneFailure
}) {
  const canonical = normalizeGitHubRepositoryUrl(repositoryUrl)
  const slug = canonical.replace(/^https:\/\/github\.com\//i, '')
  // An absolute destination, quoted for paths with spaces: a relative one would
  // land wherever the user's terminal happens to be, and a checkout outside the
  // workspace is not found by the retry.
  const destination = `"${join(workspaceRoot, basename(canonical))}"`
  return (
    (cloneFailure ? `git failed: ${cloneFailure}\n` : '') +
    `The Test Plan repository could not be cloned into this workspace with the credentials available to this process. If the same command works in the user's own terminal, the repository is authorized and this process simply cannot reach the credential helper — ask the user to clone it themselves rather than requesting authorization.\n` +
    `Ask the user to clone ${canonical} inside the open workspace (${workspaceRoot}) and to say when it is done, then call this tool again — the checkout is found by its Git origin.\n` +
    `HTTPS: git clone ${canonical}.git ${destination}\n` +
    `SSH: git clone git@github.com:${slug}.git ${destination}\n` +
    `If the clone fails with "Repository not found" or a permission error, the GitHub account${githubAccount ? ` (${githubAccount})` : ''} is not authorized on this repository, which lives in Voidr's organization. The authorization is granted by an administrator of the user's own organization in the Voidr platform — not by GitHub, and not by retrying here. Tell the user to ask their Voidr administrator to authorize ${githubAccount ? `the GitHub account ${githubAccount}` : 'their GitHub account on this repository, telling the administrator which account it is'}${githubAccount ? ' on this repository' : ''}, and stop: no tool and no retry grants access.`
  )
}

function validateIdentifiers({
  organizationId,
  applicationId,
  testPlanId,
  environmentSlug
}) {
  const values = {
    organizationId: String(organizationId || '').trim(),
    applicationId: String(applicationId || '').trim(),
    testPlanId: String(testPlanId || '').trim(),
    environmentSlug: String(environmentSlug || '').trim()
  }
  if (!values.organizationId) throw new Error('organizationId is required.')
  if (!values.applicationId) throw new Error('applicationId is required.')
  if (!/^[a-f0-9]{24}$/i.test(values.testPlanId)) {
    throw new Error('A valid Test Plan ID is required.')
  }
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(values.environmentSlug)) {
    throw new Error('A valid Voidr environment slug is required.')
  }
  return values
}

function validateCases(cases) {
  const values = [...new Set((cases || []).map(value => String(value).trim()))]
  if (
    values.length === 0 ||
    values.some(value => !/^[a-z0-9][a-z0-9._-]*$/i.test(value))
  ) {
    throw new Error('At least one valid Test Plan case slug is required.')
  }
  return values
}

function validateProject(projectPath, identifiers) {
  if (!existsSync(projectPath)) {
    throw new Error('Voidr link completed without creating project.json.')
  }

  let project
  try {
    project = JSON.parse(readFileSync(projectPath, 'utf8'))
  } catch {
    throw new Error('project.json is invalid.')
  }

  const expected = {
    orgId: identifiers.organizationId,
    appId: identifiers.applicationId,
    testPlanId: identifiers.testPlanId
  }
  const mismatches = Object.entries(expected)
    .filter(([field, value]) => String(project?.[field] || '') !== value)
    .map(([field]) => field)
  if (mismatches.length > 0) {
    throw new Error(
      `project.json does not match the selected Voidr context: ${mismatches.join(', ')}.`
    )
  }
}

function countSpecs(directory) {
  if (!existsSync(directory)) return 0
  let count = 0
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) count += countSpecs(path)
    else if (/\.spec\.[cm]?[jt]s$/i.test(entry.name)) count += 1
  }
  return count
}

const RUNNER_CONFIG_FILENAME = 'voidr.runner.config.mjs'
const TEST_TIMEOUT_PATTERN = /^([ \t]*timeout:[ \t]*)(\d+)/m
const ACTION_TIMEOUT_PATTERN = /actionTimeout:[ \t]*(\d+)/
const NAVIGATION_TIMEOUT_PATTERN = /navigationTimeout:[ \t]*(\d+)/

// Playwright aborts the worker the instant the test budget expires, and an
// aborted worker never finalizes trace.zip. When the action budget equals the
// test budget the two expire together: the trace is lost, the step timeline and
// the DOM snapshots come back empty, and the failure degrades to the generic
// "Test timeout exceeded" instead of the call log naming the locator that never
// became actionable. Raising the test budget above the longest step budget is
// what makes a failed run diagnosable — it is never the action budgets that
// give way, so no step is left with less room than the repository asked for.
function ensureDiagnosableTimeouts(repositoryPath) {
  const configPath = join(repositoryPath, RUNNER_CONFIG_FILENAME)
  if (!existsSync(configPath)) return { adjusted: false, reason: 'runner-config-absent' }

  const source = readFileSync(configPath, 'utf8')
  const testTimeoutMatch = source.match(TEST_TIMEOUT_PATTERN)
  if (!testTimeoutMatch) return { adjusted: false, reason: 'test-timeout-not-a-literal' }

  const longestStep = Math.max(
    Number(source.match(ACTION_TIMEOUT_PATTERN)?.[1] || 0),
    Number(source.match(NAVIGATION_TIMEOUT_PATTERN)?.[1] || 0)
  )
  if (longestStep === 0) return { adjusted: false, reason: 'step-timeouts-absent' }

  const testTimeout = Number(testTimeoutMatch[2])
  if (testTimeout > longestStep) return { adjusted: false, reason: 'already-diagnosable' }

  const raised = longestStep * 2
  writeFileSync(
    configPath,
    source.replace(TEST_TIMEOUT_PATTERN, `$1${raised}`),
    'utf8'
  )
  return {
    adjusted: true,
    reason: 'test-budget-tied-to-step-budget',
    previousTestTimeout: testTimeout,
    testTimeout: raised,
    longestStepTimeout: longestStep
  }
}

/**
 * Which of the selected cases have no spec yet.
 *
 * A generated spec carries its case slug in the test title (`[TROCA-02] ...`),
 * which survives the file being implemented, renamed or moved between suites —
 * unlike a path convention, which only holds until someone reorganises the
 * tree. Anything unreadable counts as missing: scaffolding again is harmless
 * (the CLI skips what exists), while wrongly declaring a case scaffolded would
 * leave it without a spec.
 */
function casesWithoutSpec(modulesDirectory, caseSlugs) {
  if (!existsSync(modulesDirectory)) return [...caseSlugs]
  const specs = []
  const collect = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) collect(path)
      else if (/\.spec\.[cm]?[jt]s$/i.test(entry.name)) specs.push(path)
    }
  }
  try {
    collect(modulesDirectory)
  } catch {
    return [...caseSlugs]
  }

  const covered = new Set()
  for (const spec of specs) {
    let content = ''
    try {
      content = readFileSync(spec, 'utf8')
    } catch {
      continue
    }
    for (const slug of caseSlugs) {
      if (content.includes(`[${slug}]`)) covered.add(slug)
    }
  }
  return caseSlugs.filter(slug => !covered.has(slug))
}
/**
 * Is the installed tree already the one the lockfile describes?
 *
 * npm records what it installed in `node_modules/.package-lock.json`; when that
 * record is no older than the lockfile, nothing has changed since. Both files
 * missing means nothing was ever installed.
 *
 * Unreadable state counts as NOT current: installing again costs time, while
 * skipping a needed install leaves the repository unable to build.
 */
function dependenciesAreCurrent(repositoryPath) {
  const lockfile = join(repositoryPath, 'package-lock.json')
  const installed = join(repositoryPath, 'node_modules', '.package-lock.json')
  if (!existsSync(installed)) return false
  if (!existsSync(lockfile)) return true
  try {
    return statSync(installed).mtimeMs >= statSync(lockfile).mtimeMs
  } catch {
    return false
  }
}
