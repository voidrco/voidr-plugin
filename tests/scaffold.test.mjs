import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildTestRepository,
  scaffoldTestCases
} from '../scripts/lib/scaffold.mjs'

test('scaffolds selected cases with credentials confined to the child process', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'voidr-scaffold-'))
  const repositoryPath = join(workspace, 'tests')
  const testPlanId = '0123456789abcdef01234567'
  mkdirSync(repositoryPath)
  writeFileSync(
    join(repositoryPath, 'package.json'),
    JSON.stringify({ scripts: { 'voidr:scaffold': 'voidr scaffold' } })
  )
  writeFileSync(
    join(repositoryPath, 'project.json'),
    JSON.stringify({ testPlanId })
  )

  const secret = 'synthetic-preview-secret'
  const calls = []
  const result = await scaffoldTestCases({
    repositoryPath,
    testPlanId,
    cases: ['LOGIN-001', 'LOGIN-002', 'LOGIN-001'],
    workspaceRoot: workspace,
    cliEnvironment: {
      VOIDR_API_URL: 'https://preview.example.test/v1',
      VOIDR_CLIENT_ID: 'synthetic-preview-client',
      VOIDR_CLIENT_SECRET: secret
    },
    run: async (file, args, options) => {
      calls.push({ file, args, options })
      return { stdout: '' }
    }
  })

  assert.deepEqual(result.cases, ['LOGIN-001', 'LOGIN-002'])
  assert.equal(JSON.stringify(result).includes(secret), false)
  assert.deepEqual(calls[0].args, [
    'run',
    'voidr:scaffold',
    '--',
    '--split-per-case',
    '--cases',
    'LOGIN-001,LOGIN-002'
  ])
  assert.equal(calls[0].options.env.VOIDR_CLIENT_SECRET, secret)
  assert.equal(
    calls[0].options.env.VOIDR_API_URL,
    'https://preview.example.test/v1'
  )
})

test('builds through the same isolated preview CLI environment', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'voidr-build-'))
  const repositoryPath = join(workspace, 'tests')
  const testPlanId = 'abcdef0123456789abcdef01'
  mkdirSync(repositoryPath)
  writeFileSync(
    join(repositoryPath, 'package.json'),
    JSON.stringify({ scripts: { 'voidr:build': 'voidr build' } })
  )
  writeFileSync(
    join(repositoryPath, 'project.json'),
    JSON.stringify({ testPlanId })
  )

  const calls = []
  const result = await buildTestRepository({
    repositoryPath,
    testPlanId,
    workspaceRoot: workspace,
    cliEnvironment: {
      VOIDR_API_URL: 'https://preview.example.test/v1',
      VOIDR_CLIENT_ID: 'synthetic-preview-client',
      VOIDR_CLIENT_SECRET: 'synthetic-preview-secret'
    },
    run: async (file, args, options) => {
      calls.push({ file, args, options })
      return { stdout: '' }
    }
  })

  assert.equal(result.completed, true)
  assert.deepEqual(calls[0].args, ['run', 'voidr:build'])
  assert.equal(
    calls[0].options.env.VOIDR_API_URL,
    'https://preview.example.test/v1'
  )
})
