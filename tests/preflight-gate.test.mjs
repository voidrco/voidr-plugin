import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { specsAuthenticatingInline } from '../scripts/lib/scaffold.mjs'

function repositoryWith(specs) {
  const root = mkdtempSync(join(tmpdir(), 'voidr-preflight-'))
  for (const [relativePath, source] of Object.entries(specs)) {
    const full = join(root, relativePath)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, source)
  }
  return root
}

const INLINE = `import authFactory from '@/actions/interface/auth/auth.js'
test('x', async ({ page }) => {
  const auth = authFactory(page)
  await auth.login()
})`

const INHERITS = `import { getPreflightArtifactPath } from '@voidrco/playwright/shared/preflight.js'
test.use({ storageState: getPreflightArtifactPath('auth.json') })
test('x', async ({ page }) => {})`

test('counts the specs that log in from scratch', () => {
  const root = repositoryWith({
    'modules/a/s/one.spec.js': INLINE,
    'modules/a/s/two.spec.js': INLINE,
    'modules/b/s/three.spec.js': INHERITS
  })
  // The spec that inherits the session is already doing the right thing, even
  // though it still mentions auth — counting it would make the gate unclearable.
  assert.deepEqual(specsAuthenticatingInline(root), [
    'modules/a/s/one.spec.js',
    'modules/a/s/two.spec.js'
  ])
})

test('a single inline login is legitimate and not counted as a pattern', () => {
  // The case whose subject IS the login has to drive the UI, and so does the
  // one that requires no session. One is expected; the repetition is the smell.
  const root = repositoryWith({ 'modules/a/s/login.spec.js': INLINE })
  assert.equal(specsAuthenticatingInline(root).length, 1)
})

test('a repository with no modules answers empty instead of throwing', () => {
  const root = mkdtempSync(join(tmpdir(), 'voidr-preflight-empty-'))
  assert.deepEqual(specsAuthenticatingInline(root), [])
})
