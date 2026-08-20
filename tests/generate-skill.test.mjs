import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const skill = readFileSync(join(root, 'skills/voidr-generate/SKILL.md'), 'utf8')
test('where the checking loop runs is the user\'s choice, asked once', () => {
  const section = skill.slice(
    skill.indexOf('## 0b.'),
    skill.indexOf('## 1.')
  )

  // Observed: a session went straight to `npx playwright test` on a smoke spec
  // it wrote itself, never touching voidr_explore or any platform step. The
  // terminal is allowed, so nothing objected — the choice had simply never
  // been put to the user.
  assert.match(section, /ask_user/)
  assert.match(section, /voidr_explore/)
  assert.match(section, /\bLocal\b/)

  // Local shortens the loop; it does not stand in for the platform verdict.
  assert.match(section, /voidr_build/)
  assert.match(section, /voidr-execute/)
  assert.match(section, /not evidence of a pass on\s+the platform/)

  // And the report has to say which mode produced the result.
  assert.match(section, /closing report/)
})

test('the probe step defers to that choice instead of picking a path', () => {
  const probes = skill.slice(skill.indexOf('## 4. Exploration probes'))
  assert.match(probes, /the way 0b settled/)
  assert.match(probes, /npx playwright test/)
})
