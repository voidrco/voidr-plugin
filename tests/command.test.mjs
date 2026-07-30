import test from 'node:test'
import assert from 'node:assert/strict'
import {
  describeCommandFailure,
  isNetworkFailure
} from '../scripts/lib/command.mjs'

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
