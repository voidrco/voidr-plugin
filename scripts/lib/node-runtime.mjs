import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { nodeExecutableForToolchain, runCommand } from './command.mjs'

// Playwright 1.48, pinned by the published Voidr framework, hangs before
// listing or starting workers on newer Node majors (reproduced on 24.x).
const SUPPORTED_NODE_MAJOR = 22

// Version managers keep their installs in known roots, so the required major
// can be reported as already installed but inactive — the common case — instead
// of telling the user to install what they already have.
const ARCHITECTURE_SUBDIRECTORIES = ['x64', 'arm64', 'x86']

const NODE_MANAGERS = [
  {
    name: 'nvs',
    variables: ['NVS_HOME'],
    homeDirectories: ['.nvs'],
    localAppData: ['nvs'],
    versionDirectories: root => [join(root, 'node')],
    install: major => `nvs add ${major}`,
    activate: major => `nvs use ${major}`
  },
  {
    name: 'nvm',
    variables: ['NVM_HOME', 'NVM_DIR'],
    homeDirectories: ['.nvm'],
    localAppData: [],
    // nvm-windows keeps the versions in the root, nvm.sh under versions/node.
    versionDirectories: root => [join(root, 'versions', 'node'), root],
    install: major => `nvm install ${major}`,
    activate: major => `nvm use ${major}`
  },
  {
    name: 'volta',
    variables: ['VOLTA_HOME'],
    homeDirectories: ['.volta'],
    localAppData: ['Volta'],
    versionDirectories: root => [join(root, 'tools', 'image', 'node')],
    // `volta install` is also how a version becomes the default one, and it is
    // the only form used here: `volta pin` would write the pin into the
    // repository's package.json, mutating the checkout to fix a shell problem.
    install: major => `volta install node@${major}`,
    activate: major => `volta install node@${major}`
  },
  {
    name: 'fnm',
    variables: ['FNM_DIR'],
    homeDirectories: ['.fnm', join('.local', 'share', 'fnm')],
    localAppData: ['fnm'],
    versionDirectories: root => [join(root, 'node-versions')],
    install: major => `fnm install ${major}`,
    activate: major => `fnm use ${major}`
  }
]

export async function assertSupportedNodeRuntime(options) {
  const {
    repositoryPath,
    run = runCommand,
    guidance,
    nodeExecutable = nodeExecutableForToolchain()
  } = options
  const declared = declaredNodeVersion(repositoryPath)
  const required = declared.major || SUPPORTED_NODE_MAJOR
  // Scanned only when the runtime is rejected: the happy path never touches the
  // version-manager directories.
  const howToGetIt = () =>
    guidance === undefined ? nodeVersionGuidance(required) : guidance
  let result
  try {
    result = await run(nodeExecutable, ['--version'], {
      cwd: repositoryPath,
      timeout: 15_000,
      env: process.env
    })
  } catch (error) {
    // A Node that cannot even report its version is the case where the guidance
    // matters most: the runtime is missing, not merely the wrong major.
    throw new Error(`${error?.message || error} ${howToGetIt()}`)
  }
  const version = String(result?.stdout || '').trim()
  const major = Number.parseInt(version.replace(/^v/i, ''), 10)
  if (!Number.isInteger(major) || major <= 0) {
    throw new Error(
      'Could not determine the Node.js version that runs inside the selected ' +
        'test repository. Verify that this shell can execute node --version ' +
        `in that directory. ${howToGetIt()}`
    )
  }
  if (major !== required) {
    const compatible = await compatibleToolchainRuntime({
      required,
      repositoryPath,
      run,
      declared: options.compatibleToolchain
    })
    // The PATH is wrong, not necessarily the machine: when the required major is
    // installed elsewhere, run the flow on it and report which runtime was used,
    // instead of stopping on something the user can only fix by relaunching the
    // editor.
    if (compatible) return { ...compatible, shellVersion: version }
  }
  if (declared.major && major !== declared.major) {
    throw new Error(
      `The repository pins Node ${declared.raw} (${declared.source}) but this ` +
        `shell resolves ${version}. Playwright 1.48 hangs indefinitely on ` +
        `unsupported Node versions. Activate Node ${declared.major} and ` +
        `retry. ${howToGetIt()} Do not install dependencies or run Playwright ` +
        `on ${version}.`
    )
  }
  if (!declared.major && major !== SUPPORTED_NODE_MAJOR) {
    throw new Error(
      `This shell resolves Node ${version}, but the Voidr Playwright ` +
        `framework requires Node ${SUPPORTED_NODE_MAJOR}. Playwright 1.48 ` +
        'hangs indefinitely on newer majors. Activate Node ' +
        `${SUPPORTED_NODE_MAJOR} and retry. ${howToGetIt()}`
    )
  }
  return { version, major }
}

// The directory name is evidence, not proof: every candidate is executed before
// the flow commits to it, newest first. One broken install — a binary that
// cannot run, or a directory whose name does not match what it reports — must not
// hide an older one that works.
async function compatibleToolchainRuntime({
  required,
  repositoryPath,
  run,
  declared
}) {
  const candidates =
    declared === undefined
      ? listCompatibleToolchains(required)
      : [declared].flat().filter(Boolean)
  for (const toolchain of candidates) {
    let version
    try {
      const result = await run(toolchain.node, ['--version'], {
        cwd: repositoryPath,
        timeout: 15_000,
        env: process.env
      })
      version = String(result?.stdout || '').trim()
    } catch {
      continue
    }
    if (Number.parseInt(version.replace(/^v/i, ''), 10) !== required) continue
    return { version, major: required, toolchain }
  }
  return null
}

// The message has to distinguish "installed but not active" from "not installed
// at all": both look identical from node --version, and the wrong one sends the
// user to install a runtime they already have.
export function nodeVersionGuidance(major, options = {}) {
  const managers = options.managers || detectNodeManagers(options)
  const installed = managers.find(manager => manager.majors.includes(major))
  const shellNote =
    'Do this in your own terminal and then reopen VS Code from it, so the ' +
    'extension inherits that PATH — the agent must never install, switch, or ' +
    'pin a Node runtime.'
  if (installed) {
    return (
      `Node ${major} is already installed (${installed.name} ` +
      `${installed.versions.find(entry => entry.version.startsWith(`${major}.`))?.version || major}), ` +
      `it is just not the version this shell resolves: activate it with ` +
      `\`${installed.activate(major)}\`. ${shellNote}`
    )
  }
  if (managers.length) {
    const manager = managers[0]
    return (
      `Node ${major} is not installed: add it with \`${manager.install(major)}\` and ` +
      `activate it with \`${manager.activate(major)}\`. ${shellNote}`
    )
  }
  return (
    `Node ${major} is not installed and no version manager was found. ` +
    `Install Node ${major} from nodejs.org, or install a manager (nvs, nvm, ` +
    `volta, or fnm) and add Node ${major} with it. ${shellNote}`
  )
}

// The report has to name the runtime the flow actually used, and say when it was
// not the one the shell resolves: otherwise a user whose terminal stays on the
// wrong major has no way to explain why the same command behaves differently
// there.
export function describeNodeRuntime(runtime) {
  if (!runtime?.version) return null
  const toolchain = runtime.toolchain
  return {
    version: runtime.version,
    source: toolchain
      ? `${toolchain.manager} ${toolchain.version} (${toolchain.directory})`
      : 'this shell',
    ...(toolchain ? { toolchain } : {}),
    ...(runtime.shellVersion && runtime.shellVersion !== runtime.version
      ? {
          note: `This shell resolves ${runtime.shellVersion}; the flow ran on ${runtime.version} from ${toolchain?.manager}. Activate that version in your terminal before running Playwright there by hand.`
        }
      : {})
  }
}

// A version manager keeps every installed runtime in a known directory, so an
// incompatible PATH is not the same as a missing runtime. The binary is located
// instead of assumed, because the layout differs per manager and platform
// (`<version>/bin/node` on Unix, `<version>\node.exe` on Windows).
export function resolveCompatibleToolchain(major, options = {}) {
  return listCompatibleToolchains(major, options)[0] || null
}

// Every install of the required major, newest first, with the binary located
// rather than assumed: `<version>/bin/node` on Unix, `<version>\node.exe` on
// Windows, and `<version>/<arch>/node.exe` under nvs, which keeps one folder per
// architecture inside each version.
export function listCompatibleToolchains(major, options = {}) {
  const exists = options.exists || existsSync
  const managers = options.managers || detectNodeManagers(options)
  const resolved = []
  const candidates = managers
    .flatMap(manager =>
      manager.versions
        .filter(entry => Number.parseInt(entry.version, 10) === major)
        .map(entry => ({ ...entry, manager: manager.name }))
    )
    .sort((left, right) => compareVersions(right.version, left.version))
  for (const candidate of candidates) {
    const roots = [
      candidate.directory,
      ...ARCHITECTURE_SUBDIRECTORIES.map(architecture =>
        join(candidate.directory, architecture)
      )
    ]
    for (const root of roots) {
      let located = null
      for (const directory of [root, join(root, 'bin')]) {
        for (const binary of ['node.exe', 'node']) {
          const node = join(directory, binary)
          if (!exists(node)) continue
          located = {
            directory,
            node,
            version: candidate.version,
            manager: candidate.manager
          }
          break
        }
        if (located) break
      }
      if (located) {
        resolved.push(located)
        break
      }
    }
  }
  return resolved
}

// Prepending the toolchain keeps every child process — npm, the Voidr CLI, and
// the Playwright workers they spawn — on the runtime the framework requires,
// without touching the shell the user launched VS Code from.
export function withToolchainPath(environment, toolchain) {
  const directory = toolchain?.directory || toolchain
  if (!directory || typeof directory !== 'string') return environment
  const source = environment || {}
  const key =
    Object.keys(source).find(name => name.toLowerCase() === 'path') || 'PATH'
  const current = String(source[key] || '')
  return {
    ...source,
    [key]: current ? `${directory}${delimiter}${current}` : directory
  }
}

function compareVersions(left, right) {
  const parse = value =>
    String(value)
      .split('.')
      .map(part => Number.parseInt(part, 10) || 0)
  const first = parse(left)
  const second = parse(right)
  for (let index = 0; index < Math.max(first.length, second.length); index += 1) {
    const difference = (first[index] || 0) - (second[index] || 0)
    if (difference !== 0) return difference
  }
  return 0
}

export function detectNodeManagers(options = {}) {
  const env = options.env || process.env
  const home = options.home || homedir()
  const localAppData = env.LOCALAPPDATA || ''
  const exists = options.exists || existsSync
  const list = options.list || safeReadDirectory
  const detected = []
  for (const manager of NODE_MANAGERS) {
    const roots = [
      ...manager.variables.map(variable => env[variable]),
      ...manager.homeDirectories.map(directory => join(home, directory)),
      ...(localAppData
        ? manager.localAppData.map(directory => join(localAppData, directory))
        : [])
    ].filter(root => root && exists(root))
    if (!roots.length) continue
    const versions = []
    for (const root of roots) {
      for (const directory of manager.versionDirectories(root)) {
        for (const entry of list(directory)) {
          const normalized = entry.replace(/^v/i, '')
          if (!/^\d+\.\d+/.test(normalized)) continue
          versions.push({ version: normalized, directory: join(directory, entry) })
        }
      }
    }
    detected.push({
      name: manager.name,
      versions,
      majors: [
        ...new Set(versions.map(entry => Number.parseInt(entry.version, 10)))
      ],
      install: manager.install,
      activate: manager.activate
    })
  }
  return detected
}

function safeReadDirectory(directory) {
  try {
    return readdirSync(directory)
  } catch {
    return []
  }
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
