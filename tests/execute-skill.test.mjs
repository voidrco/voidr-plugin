import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { loadPolicy } from '../scripts/lib/policy.mjs'

const root = resolve(import.meta.dirname, '..')
const skill = readFileSync(join(root, 'skills/voidr-execute/SKILL.md'), 'utf8')

test('execute skill routes only its execution, release, and sync tools', () => {
  const policy = loadPolicy()
  const allTools = [
    ...policy.localTools,
    ...policy.safeRemoteTools,
    ...policy.forbiddenTools
  ]
  const referencedTools = allTools.filter(tool => skill.includes(tool))

  assert.deepEqual(referencedTools.sort(), [
    'executions_create_execution',
    'executions_get_execution',
    'playwright_get_execution_analytics',
    'test_plans_get_test_counts',
    'test_plans_get_test_plan',
    'voidr_release_deploy_merged_pr',
    'voidr_release_inspect',
    'voidr_smoke_build',
    'voidr_workspace_publish_tests'
  ])
  assert.equal(
    policy.writeRemoteTools.includes('executions_create_execution'),
    true
  )
  assert.equal(
    policy.writeRemoteTools.includes('test_plans_get_test_plan'),
    false
  )
  assert.equal(
    policy.writeRemoteTools.includes('test_plans_get_test_counts'),
    false
  )
})

test('execution requires complete scope and confirmation', () => {
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
  assert.match(skill, /Do not call the tool until the user\s+confirms/)
  assert.match(skill, /exactly once/)
})

test('execution preserves idempotency and returns its URL', () => {
  assert.match(skill, /Create one\s+idempotency key/)
  assert.match(skill, /Keep that same\s+key if the confirmed call must be retried/)
  assert.match(
    skill,
    /Execution: \[Open execution\]\(<VOIDR_PLATFORM_URL>\/execution\/<executionId>\)/
  )
})

test('validation runs are SHADOW executions behind release gates', () => {
  assert.match(skill, /executionType: "SHADOW"/)
  assert.match(skill, /Never deploy code that did not pass/i)
  assert.match(skill, /at least 30 seconds/i)
  assert.match(skill, /never a tight loop/i)
})
