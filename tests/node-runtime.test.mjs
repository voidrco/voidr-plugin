import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  assertSupportedNodeRuntime,
  declaredNodeVersion
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
