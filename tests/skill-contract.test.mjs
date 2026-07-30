import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const implementSkill = await readFile(
  new URL('../skills/voidr-implement-tests/SKILL.md', import.meta.url),
  'utf8'
)

test('implementation skill preserves deployed runtime API configuration', () => {
  assert.match(implementSkill, /load the selected frontend URL first/i)
  assert.match(implementSkill, /read the value that the deployed page actually exposes/i)
  assert.match(implementSkill, /Never use `page\.addInitScript` or another override to replace product runtime/is)
  assert.match(implementSkill, /Never infer that an API is\s+same-origin/is)
  assert.match(implementSkill, /Do not overwrite that value before reading it/i)
})

test('implementation skill cannot infer a missing environment', () => {
  assert.match(implementSkill, /Every precondition must come from an explicit selection in the current\s+workflow/i)
  assert.match(implementSkill, /a `baseUrl` does not select a Voidr\s+environment/i)
  assert.match(implementSkill, /If the selected environment slug is absent.*ask the user to choose/is)
  assert.match(implementSkill, /do not call any setup tool/i)
})
