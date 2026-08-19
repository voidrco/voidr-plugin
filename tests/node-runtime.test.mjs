import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import {
  assertSupportedNodeRuntime,
  declaredNodeVersion,
  describeNodeRuntime,
  detectNodeManagers,
  listCompatibleToolchains,
  nodeVersionGuidance,
  resolveCompatibleToolchain,
  withToolchainPath
} from '../scripts/lib/node-runtime.mjs'

function repositoryWith(packageJson) {
  const repositoryPath = mkdtempSync(join(tmpdir(), 'voidr-node-runtime-'))
  if (packageJson !== undefined) {
    writeFileSync(join(repositoryPath, 'package.json'), packageJson)
  }
  return repositoryPath
}

function nodeRun(version) {
  return async (file, args) => {
    assert.equal(file, 'node')
    assert.deepEqual(args, ['--version'])
    return { stdout: `${version}\n`, stderr: '', exitCode: 0 }
  }
}

test('accepts the supported Node 22 runtime', async () => {
  const repositoryPath = repositoryWith(JSON.stringify({ name: 'tests' }))
  const result = await assertSupportedNodeRuntime({
    repositoryPath,
    run: nodeRun('v22.22.0')
  })
  assert.equal(result.major, 22)
})

test('fails closed on Node 24, which hangs Playwright 1.48', async () => {
  const repositoryPath = repositoryWith(JSON.stringify({ name: 'tests' }))
  await assert.rejects(
    assertSupportedNodeRuntime({
      repositoryPath,
      run: nodeRun('v24.13.1'),
      compatibleToolchain: null
    }),
    /requires Node 22[\s\S]*hangs/i
  )
})

test('enforces the volta pin declared by the repository', async () => {
  const repositoryPath = repositoryWith(
    JSON.stringify({ name: 'tests', volta: { node: '22.22.0' } })
  )
  await assert.rejects(
    assertSupportedNodeRuntime({
      repositoryPath,
      run: nodeRun('v24.13.1'),
      compatibleToolchain: null
    }),
    /pins Node 22\.22\.0 \(volta\)[\s\S]*Activate Node 22/i
  )
  const accepted = await assertSupportedNodeRuntime({
    repositoryPath,
    run: nodeRun('v22.19.0')
  })
  assert.equal(accepted.major, 22)
})

test('fails clearly when the runtime version cannot be determined', async () => {
  const repositoryPath = repositoryWith(JSON.stringify({ name: 'tests' }))
  await assert.rejects(
    assertSupportedNodeRuntime({
      repositoryPath,
      run: async () => ({ stdout: '', stderr: '', exitCode: 1 })
    }),
    /Could not determine the Node\.js version/i
  )
})

test('tells the user to activate a version that is installed but inactive', () => {
  const message = nodeVersionGuidance(22, {
    managers: [
      {
        name: 'nvs',
        versions: [
          { version: '20.19.5', directory: '/nvs/node/20.19.5' },
          { version: '22.23.2', directory: '/nvs/node/22.23.2' }
        ],
        majors: [20, 22],
        install: major => `nvs add ${major}`,
        activate: major => `nvs use ${major}`
      }
    ]
  })

  assert.match(message, /already installed \(nvs 22\.23\.2\)/)
  assert.match(message, /activate it with `nvs use 22`/)
  assert.match(message, /reopen VS Code from it/i)
  assert.equal(/is not installed/.test(message), false)
})

test('gives the install command of the detected manager when the version is absent', () => {
  // Built from the real volta entry, so the suggested commands are the ones
  // users will actually be told to run.
  const managers = detectNodeManagers({
    env: { VOLTA_HOME: 'C:\\Users\\dev\\AppData\\Local\\Volta' },
    home: 'C:\\Users\\dev',
    exists: path => path === 'C:\\Users\\dev\\AppData\\Local\\Volta',
    list: () => ['20.19.5']
  })
  const message = nodeVersionGuidance(22, { managers })

  assert.deepEqual(
    managers.map(manager => manager.name),
    ['volta']
  )
  assert.match(message, /not installed: add it with `volta install node@22`/)
  // `volta pin` would write the pin into the repository's package.json, which is
  // never the fix for a shell that resolves the wrong runtime.
  assert.match(message, /activate it with `volta install node@22`/)
  assert.equal(/volta pin/.test(message), false)
})

test('asks for an install without a manager, and never for the agent to do it', () => {
  const message = nodeVersionGuidance(22, { managers: [] })

  assert.match(message, /no version manager was found/i)
  assert.match(message, /nodejs\.org/)
  assert.match(message, /agent must never install, switch, or pin a Node runtime/i)
})

test('asks for the version the repository pins, not the plugin default', () => {
  const message = nodeVersionGuidance(18, {
    managers: [
      {
        name: 'nvm',
        versions: [{ version: '22.23.2', directory: '/nvm/v22.23.2' }],
        majors: [22],
        install: major => `nvm install ${major}`,
        activate: major => `nvm use ${major}`
      }
    ]
  })

  assert.match(message, /Node 18 is not installed: add it with `nvm install 18`/)
})

test('carries the install guidance into every runtime rejection', async () => {
  const repositoryPath = repositoryWith(JSON.stringify({ name: 'tests' }))
  await assert.rejects(
    assertSupportedNodeRuntime({
      repositoryPath,
      run: nodeRun('v24.13.1'),
      compatibleToolchain: null,
      guidance: 'SYNTHETIC-GUIDANCE'
    }),
    /requires Node 22[\s\S]*SYNTHETIC-GUIDANCE/
  )
  await assert.rejects(
    assertSupportedNodeRuntime({
      repositoryPath,
      run: async () => ({ stdout: '', stderr: '', exitCode: 1 }),
      guidance: 'SYNTHETIC-GUIDANCE'
    }),
    /Could not determine[\s\S]*SYNTHETIC-GUIDANCE/
  )
  // A Node that cannot even be executed is exactly when the guidance matters.
  await assert.rejects(
    assertSupportedNodeRuntime({
      repositoryPath,
      run: async () => {
        throw new Error(
          'node --version failed because the node executable is not available in this shell.'
        )
      },
      guidance: 'SYNTHETIC-GUIDANCE'
    }),
    /node executable is not available[\s\S]*SYNTHETIC-GUIDANCE/
  )
})

test('measures the Node binary that will run the toolchain, when given one', async () => {
  const repositoryPath = repositoryWith(JSON.stringify({ name: 'tests' }))
  const measured = []
  await assert.rejects(
    assertSupportedNodeRuntime({
      repositoryPath,
      nodeExecutable: 'C:\\tools\\node24\\node.exe',
      run: async file => {
        measured.push(file)
        return { stdout: 'v24.13.1\n', stderr: '', exitCode: 0 }
      },
      compatibleToolchain: null,
      guidance: 'SYNTHETIC-GUIDANCE'
    }),
    /requires Node 22/
  )
  assert.deepEqual(measured, ['C:\\tools\\node24\\node.exe'])
})

test('detects installed majors from the layout of each version manager', () => {
  const managers = detectNodeManagers({
    env: {
      NVS_HOME: 'C:\\nvs',
      NVM_HOME: 'C:\\nvm4w',
      LOCALAPPDATA: 'C:\\Users\\dev\\AppData\\Local'
    },
    home: 'C:\\Users\\dev',
    exists: path => ['C:\\nvs', 'C:\\nvm4w'].includes(path),
    list: path => {
      // nvs keeps <root>/node/<version>/<arch>, nvm-windows keeps <root>/v<version>.
      if (path === join('C:\\nvs', 'node')) return ['22.23.2', '20.19.5']
      if (path === 'C:\\nvm4w') return ['v18.19.0', 'settings.txt']
      return []
    }
  })

  assert.deepEqual(
    managers.map(manager => [manager.name, manager.majors]),
    [
      ['nvs', [22, 20]],
      ['nvm', [18]]
    ]
  )
})

test('runs on a compatible installed toolchain instead of stopping the flow', async () => {
  const repositoryPath = repositoryWith(JSON.stringify({ name: 'tests' }))
  const toolchain = {
    directory: 'C:\\nvs\\node\\22.23.2\\x64',
    node: 'C:\\nvs\\node\\22.23.2\\x64\\node.exe',
    version: '22.23.2',
    manager: 'nvs'
  }
  const measured = []

  const result = await assertSupportedNodeRuntime({
    repositoryPath,
    compatibleToolchain: toolchain,
    run: async file => {
      measured.push(file)
      // The shell is on Node 20; the toolchain binary is the required major.
      return file === toolchain.node
        ? { stdout: 'v22.23.2\n', stderr: '', exitCode: 0 }
        : { stdout: 'v20.20.0\n', stderr: '', exitCode: 0 }
    }
  })

  assert.equal(result.major, 22)
  assert.equal(result.shellVersion, 'v20.20.0')
  assert.deepEqual(result.toolchain, toolchain)
  assert.deepEqual(measured, ['node', toolchain.node])

  // The report names the runtime used and warns that the shell disagrees.
  const described = describeNodeRuntime(result)
  assert.match(described.source, /nvs 22\.23\.2/)
  assert.match(described.note, /shell resolves v20\.20\.0[\s\S]*ran on v22\.23\.2/)
})

test('skips a broken newest install and falls back to an older one', async () => {
  const repositoryPath = repositoryWith(JSON.stringify({ name: 'tests' }))
  const broken = {
    directory: '/managers/22.23.2',
    node: '/managers/22.23.2/bin/node',
    version: '22.23.2',
    manager: 'nvm'
  }
  const mismatched = {
    directory: '/managers/22.20.0',
    node: '/managers/22.20.0/bin/node',
    version: '22.20.0',
    manager: 'nvm'
  }
  const working = {
    directory: '/managers/22.9.0',
    node: '/managers/22.9.0/bin/node',
    version: '22.9.0',
    manager: 'nvm'
  }
  const attempted = []

  const result = await assertSupportedNodeRuntime({
    repositoryPath,
    compatibleToolchain: [broken, mismatched, working],
    run: async file => {
      attempted.push(file)
      // The shell is on Node 20, the newest install cannot even execute, and the
      // next one lies about its version.
      if (file === broken.node) throw new Error('spawn EACCES')
      if (file === mismatched.node) {
        return { stdout: 'v20.19.6\n', stderr: '', exitCode: 0 }
      }
      if (file === working.node) {
        return { stdout: 'v22.9.0\n', stderr: '', exitCode: 0 }
      }
      return { stdout: 'v20.20.0\n', stderr: '', exitCode: 0 }
    }
  })

  assert.equal(result.major, 22)
  assert.deepEqual(result.toolchain, working)
  assert.deepEqual(attempted, [
    'node',
    broken.node,
    mismatched.node,
    working.node
  ])
})

test('keeps failing when no install of the required major qualifies', async () => {
  const repositoryPath = repositoryWith(JSON.stringify({ name: 'tests' }))

  await assert.rejects(
    assertSupportedNodeRuntime({
      repositoryPath,
      compatibleToolchain: [
        { node: '/a/node', version: '22.1.0', manager: 'nvm', directory: '/a' },
        { node: '/b/node', version: '22.0.0', manager: 'nvm', directory: '/b' }
      ],
      guidance: 'SYNTHETIC-GUIDANCE',
      run: async file => {
        if (file === 'node') {
          return { stdout: 'v20.20.0\n', stderr: '', exitCode: 0 }
        }
        throw new Error('spawn EACCES')
      }
    }),
    /requires Node 22[\s\S]*SYNTHETIC-GUIDANCE/
  )
})

test('refuses a toolchain whose binary reports another version', async () => {
  const repositoryPath = repositoryWith(JSON.stringify({ name: 'tests' }))

  await assert.rejects(
    assertSupportedNodeRuntime({
      repositoryPath,
      // The directory name says 22, the binary says otherwise: the directory is
      // evidence, not proof.
      compatibleToolchain: {
        directory: '/managers/22.23.2',
        node: '/managers/22.23.2/bin/node',
        version: '22.23.2',
        manager: 'nvm'
      },
      guidance: 'SYNTHETIC-GUIDANCE',
      run: async () => ({ stdout: 'v20.20.0\n', stderr: '', exitCode: 0 })
    }),
    /requires Node 22[\s\S]*SYNTHETIC-GUIDANCE/
  )
})

test('locates the newest install of the required major across layouts', () => {
  const unix = resolveCompatibleToolchain(22, {
    managers: [
      {
        name: 'nvm',
        majors: [20, 22],
        versions: [
          { version: '22.9.0', directory: '/home/dev/.nvm/versions/node/v22.9.0' },
          { version: '22.23.2', directory: '/home/dev/.nvm/versions/node/v22.23.2' },
          { version: '20.19.5', directory: '/home/dev/.nvm/versions/node/v20.19.5' }
        ]
      }
    ],
    // Unix keeps the binary under bin/, and 22.23.2 must win over 22.9.0.
    exists: path => path === '/home/dev/.nvm/versions/node/v22.23.2/bin/node'
  })
  assert.equal(unix.node, '/home/dev/.nvm/versions/node/v22.23.2/bin/node')
  assert.equal(unix.version, '22.23.2')

  // nvs, from detection to resolution: it keeps one architecture folder inside
  // each version, so the binary is a level below what detection enumerates.
  const nvsRoot = 'C:\\nvs'
  const nvsBinary = join(nvsRoot, 'node', '22.23.2', 'x64', 'node.exe')
  const options = {
    env: { NVS_HOME: nvsRoot },
    home: 'C:\\Users\\dev',
    exists: path => path === nvsRoot || path === nvsBinary,
    list: path => (path === join(nvsRoot, 'node') ? ['22.23.2'] : [])
  }
  const windows = resolveCompatibleToolchain(22, {
    ...options,
    managers: detectNodeManagers(options)
  })
  assert.equal(windows.node, nvsBinary)
  assert.equal(windows.manager, 'nvs')

  assert.equal(
    resolveCompatibleToolchain(22, { managers: [], exists: () => true }),
    null
  )
})

test('prepends the toolchain to the PATH the children inherit', () => {
  const windows = withToolchainPath(
    { Path: 'C:\\Program Files\\nodejs', OTHER: 'keep' },
    { directory: 'C:\\nvs\\node\\22.23.2\\x64' }
  )
  // The existing key casing is preserved, so Windows does not end up with two.
  assert.equal(
    windows.Path,
    `C:\\nvs\\node\\22.23.2\\x64${delimiter}C:\\Program Files\\nodejs`
  )
  assert.equal(windows.OTHER, 'keep')
  assert.equal(Object.hasOwn(windows, 'PATH'), false)

  const untouched = { PATH: '/usr/bin' }
  assert.equal(withToolchainPath(untouched, null), untouched)
  assert.equal(withToolchainPath(untouched, undefined), untouched)
})

test('reads only a valid volta pin from package.json', () => {
  assert.deepEqual(
    declaredNodeVersion(
      repositoryWith(JSON.stringify({ volta: { node: '22.22.0' } }))
    ),
    { major: 22, raw: '22.22.0', source: 'volta' }
  )
  assert.deepEqual(
    declaredNodeVersion(repositoryWith(JSON.stringify({ engines: { node: '>=22' } }))),
    { major: null }
  )
  assert.deepEqual(declaredNodeVersion(repositoryWith('{invalid')), {
    major: null
  })
  assert.deepEqual(declaredNodeVersion(repositoryWith(undefined)), {
    major: null
  })
})


test('locates the runtime in every manager layout, fnm nesting included', () => {
  // fnm keeps it one level deeper than the others
  // (`<version>/installation/bin/node`), on every platform — not just macOS.
  // Probing only the version directory found the install and then failed to
  // locate its binary, so a machine with Node 22 installed was reported as
  // unusable and the whole flow stopped on it.
  const layouts = {
    'fnm unix': '/fake/v22.22.3/installation/bin/node',
    'fnm windows': '/fake/v22.22.3/installation/node.exe',
    'nvm unix': '/fake/v22.22.3/bin/node',
    'volta': '/fake/v22.22.3/node',
    'nvs windows': '/fake/v22.22.3/x64/node.exe'
  }
  for (const [layout, nodePath] of Object.entries(layouts)) {
    const found = listCompatibleToolchains(22, {
      managers: [
        {
          name: 'test',
          majors: [22],
          versions: [{ version: '22.22.3', directory: '/fake/v22.22.3' }]
        }
      ],
      exists: candidate => candidate === nodePath
    })
    assert.equal(found.length, 1, layout)
    assert.equal(found[0].node, nodePath, layout)
  }
})
