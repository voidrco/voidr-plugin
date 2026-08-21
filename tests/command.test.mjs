import test from 'node:test'
import assert from 'node:assert/strict'
import {
  describeCommandFailure,
  isNetworkFailure,
  nodeExecutableForToolchain,
  resolveNodeToolchainCommand,
  resolveWindowsGhCommand
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

test('resolves gh from the Windows PATH before known install locations', () => {
  const pathGh = 'C:\\tools\\github-cli\\gh.exe'
  const programFilesGh = 'C:\\Program Files\\GitHub CLI\\gh.exe'
  const resolved = resolveWindowsGhCommand(['pr', 'view'], {
    env: {
      Path: 'C:\\tools\\github-cli;C:\\Windows\\system32',
      ProgramFiles: 'C:\\Program Files'
    },
    exists: path => path === pathGh || path === programFilesGh
  })

  assert.deepEqual(resolved, { file: pathGh, args: ['pr', 'view'] })
})

test('resolves gh from the standard Windows machine installation', () => {
  const expected = 'C:\\Program Files\\GitHub CLI\\gh.exe'
  const resolved = resolveNodeToolchainCommand('gh', ['auth', 'status'], {
    platform: 'win32',
    env: {
      PATH: 'C:\\Windows\\system32',
      PROGRAMFILES: 'C:\\Program Files'
    },
    exists: path => path === expected
  })

  assert.deepEqual(resolved, { file: expected, args: ['auth', 'status'] })
})

test('resolves gh from a standard Windows per-user installation', () => {
  const expected =
    'C:\\Users\\dev\\AppData\\Local\\Programs\\GitHub CLI\\gh.exe'
  const resolved = resolveWindowsGhCommand(['repo', 'view'], {
    env: {
      PATH: 'C:\\Windows\\system32',
      LOCALAPPDATA: 'C:\\Users\\dev\\AppData\\Local'
    },
    exists: path => path === expected
  })

  assert.deepEqual(resolved, { file: expected, args: ['repo', 'view'] })
})

test('honors VOIDR_GH_PATH and preserves gh arguments', () => {
  const expected = 'D:\\portable tools\\gh.exe'
  const args = ['pr', 'create', '--title', 'QA & release']
  const resolved = resolveWindowsGhCommand(args, {
    env: { voidr_gh_path: expected },
    exists: path => path === expected
  })

  assert.deepEqual(resolved, { file: expected, args })
})

test('explains how to install or configure gh when Windows cannot find it', () => {
  assert.throws(
    () =>
      resolveWindowsGhCommand(['pr', 'view'], {
        env: {
          PATH: 'C:\\Windows\\system32',
          ProgramFiles: 'C:\\Program Files',
          LOCALAPPDATA: 'C:\\Users\\dev\\AppData\\Local'
        },
        exists: () => false
      }),
    /winget install --id GitHub\.cli[\s\S]*gh auth login[\s\S]*VOIDR_GH_PATH[\s\S]*Get-Command gh/i
  )
})

test('reports a stale VOIDR_GH_PATH instead of silently ignoring it', () => {
  assert.throws(
    () =>
      resolveWindowsGhCommand([], {
        env: { VOIDR_GH_PATH: 'C:\\missing\\gh.exe' },
        exists: () => false
      }),
    /VOIDR_GH_PATH points to C:\\missing\\gh\.exe[\s\S]*Correct or remove/i
  )
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

test('measures the Node that will actually run npx, not the one PATH resolves', () => {
  // A directory carrying only node.exe comes first; the npx shim belongs to
  // another toolchain, and that is the runtime Playwright will run under.
  const BARE_22 = 'C:\\tools\\node22'
  const OWNS_NPX_24 = 'C:\\tools\\node24'
  const present = new Set([
    `${BARE_22}\\node.exe`,
    `${OWNS_NPX_24}\\node.exe`,
    `${OWNS_NPX_24}\\npx.cmd`,
    `${OWNS_NPX_24}\\node_modules\\npm\\bin\\npx-cli.js`
  ])
  const options = {
    platform: 'win32',
    env: { PATH: `${BARE_22};${OWNS_NPX_24}` },
    execPath: `${BARE_22}\\node.exe`,
    exists: path => present.has(path)
  }

  const resolved = resolveNodeToolchainCommand('npx', ['playwright', 'test'], options)
  assert.equal(resolved.file, `${OWNS_NPX_24}\\node.exe`)
  // The runtime gate receives that same binary, so it can reject Node 24 before
  // Playwright hangs on it.
  assert.equal(nodeExecutableForToolchain(options), `${OWNS_NPX_24}\\node.exe`)
})

test('falls back to the shell node when no toolchain can be resolved', () => {
  assert.equal(
    nodeExecutableForToolchain({
      platform: 'win32',
      env: { PATH: 'C:\\Windows\\system32' },
      execPath: 'C:\\Windows\\system32\\node.exe',
      exists: () => false
    }),
    'node'
  )
  assert.equal(
    nodeExecutableForToolchain({ platform: 'linux', env: { PATH: '/usr/bin' } }),
    'node'
  )
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
    /neither npm\.exe nor npm\.cmd exists in PATH[\s\S]*version this repository requires[\s\S]*never run this step manually/i
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
