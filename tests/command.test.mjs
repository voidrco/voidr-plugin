import test from 'node:test'
import assert from 'node:assert/strict'
import {
  describeCommandFailure,
  isNetworkFailure,
  resolveNodeToolchainCommand
} from '../scripts/lib/command.mjs'

const NVS_DIRECTORY = 'C:\\Users\\dev\\AppData\\Local\\nvs\\node\\22.23.2\\x64'
const SYSTEM_DIRECTORY = 'C:\\Program Files\\nodejs'

function windowsToolchain(directories) {
  const files = new Set()
  for (const directory of directories) {
    files.add(`${directory}\\npm.cmd`)
    files.add(`${directory}\\npx.cmd`)
    files.add(`${directory}\\node.exe`)
    files.add(`${directory}\\node_modules\\npm\\bin\\npm-cli.js`)
    files.add(`${directory}\\node_modules\\npm\\bin\\npx-cli.js`)
  }
  return path => files.has(path)
}

test('classifies sandbox network failures with fail-closed guidance', () => {
  const error = Object.assign(new Error('command failed'), {
    code: 1,
    stderr:
      'npm error code EAI_AGAIN\nnpm error request to https://registry.npmjs.org/@voidrco%2fplaywright failed'
  })
  assert.equal(isNetworkFailure(error), true)
  const message = describeCommandFailure('npm', ['install'], error)
  assert.match(message, /network is unreachable/i)
  assert.match(message, /sandbox without network access/i)
  assert.match(message, /Do not change registry, cache, lockfile/i)
})

test('reports a missing executable instead of guessing', () => {
  const error = Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' })
  const message = describeCommandFailure('gh', ['pr'], error)
  assert.match(message, /gh executable is not available/i)
})

test('runs the npm of the active Windows toolchain without a shell', () => {
  const resolved = resolveNodeToolchainCommand('npm', ['install'], {
    platform: 'win32',
    // The shim directory comes first, exactly as the user's shell resolves it.
    env: { Path: `${NVS_DIRECTORY};${SYSTEM_DIRECTORY};C:\\Windows\\system32` },
    execPath: `${SYSTEM_DIRECTORY}\\node.exe`,
    exists: windowsToolchain([NVS_DIRECTORY, SYSTEM_DIRECTORY])
  })

  assert.equal(resolved.file, `${NVS_DIRECTORY}\\node.exe`)
  assert.deepEqual(resolved.args, [
    `${NVS_DIRECTORY}\\node_modules\\npm\\bin\\npm-cli.js`,
    'install'
  ])
  // No shell means the arguments are never reinterpreted by cmd.exe.
  assert.equal(Object.hasOwn(resolved, 'shell'), false)
})

test('keeps npx arguments intact when rewriting it on Windows', () => {
  const args = ['--no-install', 'voidr', 'env', 'pull', '--env', 'qa & prod']
  const resolved = resolveNodeToolchainCommand('npx', args, {
    platform: 'win32',
    env: { PATH: NVS_DIRECTORY },
    execPath: `${NVS_DIRECTORY}\\node.exe`,
    exists: windowsToolchain([NVS_DIRECTORY])
  })

  assert.deepEqual(resolved.args, [
    `${NVS_DIRECTORY}\\node_modules\\npm\\bin\\npx-cli.js`,
    ...args
  ])
})

test('falls back to the toolchain of the running Node when PATH omits the shim', () => {
  const resolved = resolveNodeToolchainCommand('npm', ['install'], {
    platform: 'win32',
    env: { PATH: 'C:\\Windows\\system32' },
    execPath: `${NVS_DIRECTORY}\\node.exe`,
    exists: windowsToolchain([NVS_DIRECTORY])
  })

  assert.equal(resolved.file, `${NVS_DIRECTORY}\\node.exe`)
  assert.match(resolved.args[0], /npm-cli\.js$/)
})

test('names the PATH problem when no Windows Node toolchain is reachable', () => {
  assert.throws(
    () =>
      resolveNodeToolchainCommand('npm', ['install'], {
        platform: 'win32',
        env: { PATH: 'C:\\Windows\\system32' },
        execPath: 'C:\\Windows\\system32\\node.exe',
        exists: () => false
      }),
    /neither npm\.exe nor npm\.cmd exists in PATH[\s\S]*nvs use 22[\s\S]*never run this step manually/i
  )
})

test('never rewrites commands that are real executables or other platforms', () => {
  const onWindows = resolveNodeToolchainCommand('git', ['status'], {
    platform: 'win32',
    env: { PATH: NVS_DIRECTORY },
    exists: () => true
  })
  assert.deepEqual(onWindows, { file: 'git', args: ['status'] })

  const onLinux = resolveNodeToolchainCommand('npm', ['install'], {
    platform: 'linux',
    env: { PATH: '/usr/bin' },
    exists: () => {
      throw new Error('the filesystem must not be probed outside Windows')
    }
  })
  assert.deepEqual(onLinux, { file: 'npm', args: ['install'] })
})

test('includes a sanitized output tail without secret-bearing lines', () => {
  const error = Object.assign(new Error('command failed'), {
    code: 2,
    stderr:
      'VOIDR_CLIENT_SECRET=synthetic-leaked-value\nError: scaffold requires a linked project\nRun voidr link first'
  })
  const message = describeCommandFailure('npx', ['--no-install'], error)
  assert.match(message, /exit 2/)
  assert.match(message, /scaffold requires a linked project/)
  assert.equal(message.includes('synthetic-leaked-value'), false)
})
