import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  assertSupportedNodeRuntime,
  declaredNodeVersion,
  detectNodeManagers,
  nodeVersionGuidance
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
    assertSupportedNodeRuntime({ repositoryPath, run: nodeRun('v24.13.1') }),
    /requires Node 22[\s\S]*hangs/i
  )
})

test('enforces the volta pin declared by the repository', async () => {
  const repositoryPath = repositoryWith(
    JSON.stringify({ name: 'tests', volta: { node: '22.22.0' } })
  )
  await assert.rejects(
    assertSupportedNodeRuntime({ repositoryPath, run: nodeRun('v24.13.1') }),
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
        versions: ['20.19.5', '22.23.2'],
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
  const message = nodeVersionGuidance(22, {
    managers: [
      {
        name: 'volta',
        versions: ['20.19.5'],
        majors: [20],
        install: major => `volta install node@${major}`,
        activate: major => `volta pin node@${major}`
      }
    ]
  })

  assert.match(message, /not installed: add it with `volta install node@22`/)
  assert.match(message, /activate it with `volta pin node@22`/)
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
        versions: ['22.23.2'],
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
