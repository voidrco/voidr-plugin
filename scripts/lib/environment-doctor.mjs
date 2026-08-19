import { existsSync } from 'node:fs'
import { join } from 'node:path'

import {
  describeCommandFailure,
  nodeExecutableForToolchain,
  resolveNodeToolchainCommand,
  runCommand
} from './command.mjs'
import { applySystemCaTrust } from './network-trust.mjs'
import {
  assertOutsidePluginInstallation,
  resolveWorkspaceRoot
} from './workspace.mjs'
import {
  declaredNodeVersion,
  describeNodeRuntime,
  detectNodeManagers,
  nodeVersionGuidance,
  resolveCompatibleToolchain,
  withToolchainPath
} from './node-runtime.mjs'

// Kept in step with SUPPORTED_NODE_MAJOR in node-runtime.mjs: the published
// framework pins Playwright 1.48, which hangs before listing or starting
// workers on newer majors.
const SUPPORTED_NODE_MAJOR = 22

// Every check the skill promises to relay. `owner` is what makes the report
// actionable: the user runs what changes the machine, the plugin reports what it
// already confined to its own child processes.
const OWNER_USER = 'user'
const OWNER_PLUGIN = 'plugin'

/**
 * Diagnose the local machine against what the Voidr Playwright framework needs.
 *
 * Read-only by contract: it never installs, switches, or pins anything. Each
 * check carries its own remediation and the owner who may apply it.
 */
export async function environmentDoctor(options = {}) {
  const { run = runCommand } = options
  const target = resolveInspectionTarget(options)
  const repositoryPath = target.path
  const checks = []

  const nodeCheck = await checkNodeRuntime({ repositoryPath, run })
  checks.push(nodeCheck)

  // npm/npx and Playwright are executed on the runtime the flow would actually
  // use, not on whatever the shell resolves — otherwise the report describes a
  // machine the flow never touches.
  const toolchain = nodeCheck.toolchain || null
  const env = toolchain ? withToolchainPath(process.env, toolchain) : process.env

  for (const binary of ['npm', 'npx']) {
    checks.push(await checkNodeCli({ binary, repositoryPath, run, env }))
  }

  checks.push(
    target.scope === 'unresolved'
      ? {
          name: 'playwright-launchable',
          status: 'skip',
          owner: OWNER_PLUGIN,
          detail:
            'No workspace was resolved, so no test repository was inspected. ' +
            'Call the tool again passing repositoryPath (the test repository) ' +
            'or workspaceRoot (the open workspace folder) to verify Playwright.'
        }
      : await checkPlaywright({ repositoryPath, run, env })
  )
  checks.push(checkTlsTrust())

  const failed = checks.filter(check => check.status === 'fail')
  // The machine checks (runtime, npm/npx, TLS) hold wherever they ran, but a
  // verdict must never imply a repository the caller never named: the bridge
  // process starts inside the plugin installation, and reporting APT about it
  // is a green light for the wrong directory.
  const scopeNote =
    target.scope === 'repository'
      ? ''
      : target.scope === 'workspace'
        ? ` Checks ran in the resolved workspace (${repositoryPath}); no test repository was named.`
        : ' Machine checks only: no workspace was resolved, so no test repository was inspected.'
  return {
    apt: failed.length === 0,
    supportedNodeMajor: SUPPORTED_NODE_MAJOR,
    repositoryPath: target.scope === 'repository' ? repositoryPath : null,
    inspectedPath: repositoryPath,
    inspectionScope: target.scope,
    checks,
    failedChecks: failed.map(check => check.name),
    // The skill reports a verdict, so the summary must survive being read alone.
    summary: failed.length
      ? `NOT APT: ${failed.length} of ${checks.length} checks failed (${failed
          .map(check => check.name)
          .join(', ')}).${scopeNote}`
      : `APT: all ${checks.length} environment checks passed.${scopeNote}`
  }
}

// An absent path used to fall back to the process cwd, which is the plugin
// installation itself — the doctor then answered APT about the plugin's own
// directory. `voidr_context_bootstrap` already refuses that; the doctor keeps
// running the machine-level checks (they hold anywhere) but says so instead of
// claiming a repository it never saw.
function resolveInspectionTarget({ repositoryPath, workspaceRoot, env, cwd }) {
  if (repositoryPath) {
    return {
      path: assertOutsidePluginInstallation(repositoryPath, 'repository path'),
      scope: 'repository'
    }
  }
  try {
    return {
      path: resolveWorkspaceRoot({ explicit: workspaceRoot, env, cwd }),
      scope: 'workspace'
    }
  } catch {
    return { path: cwd || process.cwd(), scope: 'unresolved' }
  }
}

async function checkNodeRuntime({ repositoryPath, run }) {
  const declared = declaredNodeVersion(repositoryPath)
  const required = declared.major || SUPPORTED_NODE_MAJOR
  const name = 'node-runtime'

  let shellVersion
  try {
    const result = await run(nodeExecutableForToolchain(), ['--version'], {
      cwd: repositoryPath,
      timeout: 15_000,
      env: process.env
    })
    shellVersion = String(result?.stdout || '').trim()
  } catch (error) {
    return {
      name,
      status: 'fail',
      owner: OWNER_USER,
      detail: `Could not run node --version in ${repositoryPath}: ${
        error?.message || error
      }`,
      remediation: nodeVersionGuidance(required)
    }
  }

  const major = Number.parseInt(String(shellVersion).replace(/^v/i, ''), 10)
  if (!Number.isInteger(major) || major <= 0) {
    return {
      name,
      status: 'fail',
      owner: OWNER_USER,
      detail: `node --version returned "${shellVersion}", which is not a version.`,
      remediation: nodeVersionGuidance(required)
    }
  }

  if (major === required) {
    return {
      name,
      status: 'pass',
      owner: OWNER_PLUGIN,
      detail: `Node ${shellVersion} matches the required major (${required})${
        declared.major ? ` pinned by ${declared.source}` : ''
      }.`,
      runtime: { version: shellVersion, major }
    }
  }

  // A wrong PATH is not a missing runtime: when the required major exists in a
  // version manager, the flow runs on it and the report says so instead of
  // stopping on something only a relaunch would fix.
  const compatible = resolveCompatibleToolchain(required)
  if (compatible) {
    return {
      name,
      status: 'pass',
      owner: OWNER_PLUGIN,
      detail:
        `This shell resolves ${shellVersion}, but Node ${required} is available ` +
        `(${compatible.manager} ${compatible.version}). Voidr child processes ` +
        `will run on it; this shell is untouched.`,
      remediation: nodeVersionGuidance(required),
      toolchain: compatible,
      runtime: describeNodeRuntime({
        version: compatible.version,
        toolchain: compatible,
        shellVersion
      })
    }
  }

  return {
    name,
    status: 'fail',
    owner: OWNER_USER,
    detail: declared.major
      ? `The repository pins Node ${declared.raw} (${declared.source}) but this shell resolves ${shellVersion}. Playwright 1.48 hangs indefinitely on unsupported Node versions.`
      : `This shell resolves Node ${shellVersion}, but the Voidr Playwright framework requires Node ${SUPPORTED_NODE_MAJOR}. Playwright 1.48 hangs indefinitely on newer majors.`,
    remediation: nodeVersionGuidance(required),
    managers: detectNodeManagers().map(manager => ({
      name: manager.name,
      majors: manager.majors
    }))
  }
}

async function checkNodeCli({ binary, repositoryPath, run, env }) {
  const name = `${binary}-resolution`
  try {
    const result = await run(binary, ['--version'], {
      cwd: repositoryPath,
      timeout: 20_000,
      env
    })
    const version = String(result?.stdout || '').trim()
    const resolved = resolveNodeToolchainCommand(binary, ['--version'], { env })
    return {
      name,
      status: 'pass',
      owner: OWNER_PLUGIN,
      detail: `${binary} ${version} resolves${
        resolved.file === binary ? '' : ` through ${resolved.file}`
      }.`
    }
  } catch (error) {
    return {
      name,
      status: 'fail',
      owner: OWNER_USER,
      detail: String(error?.message || error),
      remediation:
        process.platform === 'win32'
          ? `${binary} is not resolvable from this shell. On Windows it ships as a .cmd shim: confirm the Node install directory is on PATH, then reopen VS Code from a terminal where \`${binary} --version\` works.`
          : `${binary} is not resolvable from this shell. Reinstall Node ${SUPPORTED_NODE_MAJOR} or repair PATH so \`${binary} --version\` works, then reopen VS Code from that terminal.`
    }
  }
}

// Launchability, not presence: a Playwright that is installed but whose browser
// binaries are missing fails at the first test, which is exactly the late
// failure this doctor exists to prevent.
async function checkPlaywright({ repositoryPath, run, env }) {
  const name = 'playwright-launchable'
  const localBinary = join(
    repositoryPath,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'playwright.cmd' : 'playwright'
  )
  if (!existsSync(localBinary)) {
    return {
      name,
      status: 'skip',
      owner: OWNER_PLUGIN,
      detail: `No local Playwright in ${repositoryPath}. It is installed when a test repository is prepared; nothing to verify yet.`
    }
  }

  try {
    const versionResult = await run(localBinary, ['--version'], {
      cwd: repositoryPath,
      timeout: 30_000,
      env
    })
    const version = String(versionResult?.stdout || '').trim()

    // `install --dry-run` reports missing browser binaries without downloading
    // anything, which keeps this check read-only.
    let browsers = 'not verified'
    try {
      const dryRun = await run(localBinary, ['install', '--dry-run'], {
        cwd: repositoryPath,
        timeout: 60_000,
        env
      })
      browsers = String(dryRun?.stdout || '').includes('Install location')
        ? 'browser binaries resolved'
        : 'browser status inconclusive'
    } catch {
      browsers = 'browser binaries could not be verified'
    }

    return {
      name,
      status: 'pass',
      owner: OWNER_PLUGIN,
      detail: `${version} launches from the test repository (${browsers}).`
    }
  } catch (error) {
    return {
      name,
      status: 'fail',
      owner: OWNER_USER,
      detail: describeCommandFailure(localBinary, ['--version'], error),
      remediation: `Playwright is installed in ${repositoryPath} but did not run. Confirm the repository is on Node ${SUPPORTED_NODE_MAJOR}, then reinstall its dependencies from your own terminal.`
    }
  }
}

// The bridge already applies system CA trust at startup; calling it again only
// reports what that produced. A machine without TLS interception reports `empty`,
// which is normal — only `failed` is an actual problem.
function checkTlsTrust() {
  const trust = applySystemCaTrust()
  const name = 'proxy-tls-trust'
  const allowlist =
    'If a corporate proxy or endpoint-security product blocks Voidr, ask your ' +
    'administrator to allowlist api.voidr.co and platform.voidr.co, or to install ' +
    'the corporate root CA in the system store. Never disable the security product.'

  if (trust.status === 'applied') {
    return {
      name,
      status: 'pass',
      owner: OWNER_PLUGIN,
      detail: `System CA trust applied (${trust.systemCertificates} certificates), for Voidr child processes only.`
    }
  }

  if (trust.status === 'empty') {
    return {
      name,
      status: 'pass',
      owner: OWNER_PLUGIN,
      detail:
        'No system certificate authorities to merge — normal on a machine without TLS interception.'
    }
  }

  // Not a failure on its own: it only means this runtime predates
  // tls.getCACertificates. It matters solely behind TLS interception, and the
  // node-runtime check already reports an unsupported major — reporting both as
  // failures turned one old Node into an invented corporate-proxy problem.
  if (trust.status === 'unsupported') {
    return {
      name,
      status: 'skip',
      owner: OWNER_PLUGIN,
      detail:
        'This Node.js runtime cannot read the system certificate store, so system CAs were not merged. Only matters behind a TLS-inspecting proxy; Node 22 supports it.',
      remediation: allowlist
    }
  }

  return {
    name,
    status: 'fail',
    owner: OWNER_USER,
    detail: `System CA trust failed: ${trust.reason || 'unknown error'}.`,
    remediation: allowlist
  }
}
