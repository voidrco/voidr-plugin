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
  assert.match(section, /Nesta m[áa]quina/)
  // The suggested option is not 'the platform': voidr_explore runs here too.
  assert.doesNotMatch(section, /on the same\s+browser, network, and environment/)

  // Local shortens the loop; it does not stand in for the platform verdict.
  assert.match(section, /voidr_build/)
  assert.match(section, /voidr-execute/)
  // The axis is platform vs this machine, not which local tool to use.
  assert.match(section, /voidr_release_deploy_validation/)
  assert.match(section, /never a verdict/)

  // And the report has to say which mode produced the result.
  assert.match(section, /closing report/)
})

test('the probe step defers to that choice instead of picking a path', () => {
  const probes = skill.slice(skill.indexOf('## 4. Exploration probes'))
  assert.match(probes, /the way 0b settled/)
  assert.match(probes, /npx playwright test/)
})

test('validation stops at three runs, whatever the failures look like', () => {
  const section = skill.slice(skill.indexOf('### Three validation runs'))

  // The per-signature limit in /voidr-execute never fires when each run fails
  // differently, which is exactly the cycle that runs longest.
  assert.match(section, /not failure signatures/)
  assert.match(section, /third run is the\s+last one/)
  assert.match(section, /Do not start a\s+fourth/)

  // The count is announced before the budget is spent, not after.
  assert.match(section, /segunda de três/)

  // A fourth round stays available — as the user's decision, not the flow's.
  assert.match(section, /can ask for another round/)
})
