import test from 'node:test'
import assert from 'node:assert/strict'
import { findRunModeDenial } from '../scripts/lib/run-mode.mjs'
import { extractCheckMode } from '../scripts/lib/session-state.mjs'

const shell = (command, state) =>
  findRunModeDenial({ rawToolName: 'Bash', toolArgs: { command }, state })

test('the answer to 0b is read off the ask_user selection', () => {
  assert.equal(
    extractCheckMode('Modo de check', 'Na plataforma (sugerido)'),
    'platform'
  )
  assert.equal(extractCheckMode('Modo de check', 'Local'), 'local')
  // A sentence mentioning local under an unrelated header sets nothing.
  assert.equal(extractCheckMode('Ambiente', 'Local'), null)
  assert.equal(extractCheckMode('Modo de check', 'nenhuma das duas'), null)
})

test('platform mode refuses a local test run', () => {
  // Observed: the answer was "Na plataforma (sugerido)" at 19:12 and
  // `npx playwright test modules/_smoke/...` ran at 19:16, no platform step between.
  const verdict = shell('npx playwright test modules/_smoke/x.spec.js', {
    checkMode: 'platform'
  })
  assert.match(verdict, /voidr_explore/)
  assert.match(verdict, /returns stdout and\s*traces as evidence/)
})

test('local mode, and no answer at all, refuse nothing', () => {
  const command = 'npx playwright test modules/_smoke/x.spec.js'
  assert.equal(shell(command, { checkMode: 'local' }), null)
  assert.equal(shell(command, {}), null)
  assert.equal(shell(command, undefined), null)
})

test('platform mode does not get in the way of ordinary work', () => {
  const state = { checkMode: 'platform' }
  for (const command of [
    'git status --short',
    'npm run check',
    'ls -la modules/',
    'cat playwright.config.js',
    'grep -rn "playwright test" docs/',
    'echo "rodar playwright test local" >> notas.md'
  ]) {
    assert.equal(shell(command, state), null, `should allow: ${command}`)
  }
})

test('an allowed verb in front is not a way through', () => {
  assert.ok(
    shell('echo ok && npx playwright test modules/x.spec.js', {
      checkMode: 'platform'
    })
  )
})
