import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const generateSkill = await readFile(
  new URL('../skills/voidr-generate/SKILL.md', import.meta.url),
  'utf8'
)

const echoReportSkill = await readFile(
  new URL('../skills/voidr-echo-report/SKILL.md', import.meta.url),
  'utf8'
)

test('generate skill preserves deployed runtime API configuration', () => {
  assert.match(generateSkill, /load the selected frontend URL first/i)
  assert.match(generateSkill, /read the value that the deployed page actually exposes/i)
  assert.match(generateSkill, /Never use `page\.addInitScript` or another override to replace product runtime/is)
  assert.match(generateSkill, /Never infer that an API is\s+same-origin/is)
  assert.match(generateSkill, /Do not overwrite that value before reading it/i)
})

test('generate skill cannot infer a missing environment', () => {
  assert.match(generateSkill, /Every precondition must come from an explicit selection in the current\s+workflow/i)
  assert.match(generateSkill, /a `baseUrl` does not select a Voidr environment/is)
  assert.match(generateSkill, /list environments\s+through Voidr MCP and ask the user to choose/is)
  assert.match(generateSkill, /do not call any setup tool from this skill/i)
})

test('Echo report skill is authenticated, closed-period, and confirmation gated', () => {
  assert.match(echoReportSkill, /Call `voidr_auth_status`[\s\S]*first platform action/i)
  assert.match(echoReportSkill, /previous complete Monday-to-Sunday/i)
  assert.match(echoReportSkill, /previous complete calendar month/i)
  assert.match(echoReportSkill, /Do not call `echo_generate_monitoring_report` in this turn/i)
  assert.match(echoReportSkill, /Never ask for,[\s\S]*pass a recipient address/i)
  assert.match(echoReportSkill, /timeout is not proof of failure or success/i)
})
