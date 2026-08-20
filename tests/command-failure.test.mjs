import test from 'node:test'
import assert from 'node:assert/strict'
import { describeCommandFailure, selectFailureLines } from '../scripts/lib/command.mjs'

// The shape a CLI that reports progress to stdout actually fails in: the reason
// on stderr, and stdout ending with whatever it managed to do first.
const deployFailure = {
  code: 1,
  stderr: 'Error: manifest upload rejected: status code 400\nValidation failed: preflight.enabled missing',
  stdout: [
    'Voidr Build',
    'Using organization: Blip - Desk',
    'Preflight detected: preflight/preflight.spec.js',
    'Preflight built: preflight/preflight.spec.js',
    'Authenticated via environment client credentials'
  ].join('\n')
}

test('the reason survives, instead of the tail of the successful preamble', () => {
  const message = describeCommandFailure('npx', ['--no-install'], deployFailure)

  // What it used to say: the last three stdout lines, all of them successes.
  assert.match(message, /status code 400/)
  assert.match(message, /Validation failed/)
  assert.doesNotMatch(
    message,
    /^npx --no-install failed \(exit 1\): Preflight detected/
  )
})

test('the tail still travels when nothing looks like a reason', () => {
  const lines = selectFailureLines({
    code: 1,
    stdout: 'step one\nstep two\nstep three\nstep four'
  })
  assert.deepEqual(lines, ['step two', 'step three', 'step four'])
})

test('secrets are still dropped', () => {
  const lines = selectFailureLines({
    code: 1,
    stderr: 'Error: auth failed\nclient_secret=sk_live_abc123'
  })
  assert.ok(lines.some(line => line.includes('auth failed')))
  assert.ok(!lines.some(line => line.includes('sk_live_abc123')))
})

test('a reason repeated in both streams is reported once', () => {
  const lines = selectFailureLines({
    code: 1,
    stderr: 'Error: repository not found',
    stdout: 'Error: repository not found'
  })
  assert.equal(lines.filter(line => line.includes('repository not found')).length, 1)
})
