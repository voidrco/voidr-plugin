import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { loadPolicy } from '../scripts/lib/policy.mjs'

const root = resolve(import.meta.dirname, '..')
const skill = readFileSync(
  join(root, 'skills/voidr-create-execution/SKILL.md'),
  'utf8'
)

test('standalone execution skill exposes one remote action', () => {
  const policy = loadPolicy()
  const allTools = [
    ...policy.localTools,
    ...policy.safeRemoteTools,
    ...policy.forbiddenTools
  ]
  const referencedTools = allTools.filter(tool => skill.includes(tool))

  assert.deepEqual(referencedTools, ['executions_create_execution'])
  assert.equal(
    policy.writeRemoteTools.includes('executions_create_execution'),
    true
  )
})

test('standalone execution requires complete scope and confirmation', () => {
  assert.match(skill, /applicationId/)
  assert.match(skill, /planId/)
  assert.match(skill, /environment/)
  assert.match(skill, /provider: "PLAYWRIGHT"/)
  assert.match(skill, /source: "STORAGE"/)
  assert.match(skill, /For the full Test Plan, omit `targets`/)
  assert.match(skill, /testCaseSlug/)
  assert.match(skill, /suiteSlug/)
  assert.match(skill, /moduleSlug/)
  assert.match(skill, /Do not call another tool to discover/)
  assert.match(skill, /Do not call the tool until the user confirms/)
  assert.match(skill, /exactly once/)
})

test('standalone execution preserves idempotency and returns its URL', () => {
  assert.match(skill, /Create one idempotency key/)
  assert.match(skill, /Keep that same\s+key if the confirmed call must be retried/)
  assert.match(
    skill,
    /Execution: \[Open execution\]\(<VOIDR_PLATFORM_URL>\/execution\/<executionId>\)/
  )
})
