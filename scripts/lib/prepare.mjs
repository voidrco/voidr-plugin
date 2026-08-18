import {
  existsSync,
  readdirSync,
  readFileSync,
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

  await run('npm', ['install'], {
    cwd: selected.path,
    timeout: 300_000,
    env: withToolchainPath(process.env, runtime.toolchain)
  })

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

  await run(
    'npx',
    [
      '--no-install',
      'voidr',
      'scaffold',
      '--split-per-case',
      '--cases',
      selectedCases.join(',')
    ],
    {
      cwd: selected.path,
      timeout: 180_000,
      env: childEnvironment
    }
  )

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
      dependenciesInstalled: true,
      authenticationResolvedFromPluginServiceAccount: true,
      interactiveLoginExecuted: false,
      linked: !hadProject,
      existingProjectValidated: hadProject,
      scaffolded: true,
      secretsPulled: true,
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
  try {
    await run('git', ['clone', `${canonical}.git`, destination], {
      cwd: workspaceRoot,
      timeout: 300_000,
      env: process.env
    })
  } catch {
    throw new Error(
      cloneRequestMessage({
        workspaceRoot,
        repositoryUrl,
        // The administrator has to authorize an account, so naming it saves a
        // round trip. Best effort only: this is a failure path, and the message
        // stands without it.
        githubAccount: await githubAccountLogin(run)
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
  githubAccount
}) {
  const canonical = normalizeGitHubRepositoryUrl(repositoryUrl)
  const slug = canonical.replace(/^https:\/\/github\.com\//i, '')
  // An absolute destination, quoted for paths with spaces: a relative one would
  // land wherever the user's terminal happens to be, and a checkout outside the
  // workspace is not found by the retry.
  const destination = `"${join(workspaceRoot, basename(canonical))}"`
  return (
    `The Test Plan repository could not be cloned into this workspace with the credentials on this machine. Ask the user to clone ${canonical} inside the open workspace (${workspaceRoot}) and to say when it is done, then call this tool again — the checkout is found by its Git origin.\n` +
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
