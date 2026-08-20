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

  // The diagnosis reads are part of the contract: a failed run has to be
  // explained from the timeline and the DOM before anything is corrected.
  assert.deepEqual(referencedTools.sort(), [
    'assistant_context_get_step_detail',
    'executions_create_execution',
    'executions_get_execution',
    'failure_analysis_get_context',
    'playwright_get_execution_analytics',
    'playwright_get_step_frames',
    'playwright_get_step_timeline',
    'playwright_get_test_dom',
    'playwright_get_trace_events',
    'playwright_list_execution_failures',
    'test_plans_get_test_counts',
    'test_plans_get_test_plan',
    // Promotion to LIVE closes the flow: a deployed case sits at DEV, outside
    // monitoring and self-healing, until this tool moves its tag.
    'test_plans_update_test_case_tag',
    'voidr_build',
    'voidr_create_validation_execution',
    'voidr_release_deploy_live',
    'voidr_release_deploy_validation',
    'voidr_release_inspect',
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
  assert.match(skill, /create one\s+idempotency key/i)
  assert.match(skill, /Keep that same\s+key if the confirmed\s+call must be retried/)
  assert.match(
    skill,
    /Execution: \[Open execution\]\(<VOIDR_PLATFORM_URL>\/execution\/<executionId>\)/
  )
})

test('validation runs are SHADOW executions pinned to the candidate version', () => {
  assert.match(skill, /voidr_release_deploy_validation/)
  assert.match(skill, /voidr_create_validation_execution/)
  assert.match(skill, /SHADOW/)
  assert.match(skill, /codebaseVersion/)
  // No PR/merge on the validation path; latest stays untouched.
  assert.match(skill.replace(/\n/g, ' '), /No pull\s+request or merge is involved/i)
  assert.match(skill, /never touches\s+`latest`/i)
  assert.match(skill, /Never deploy a\s+repository that did not build/i)
  assert.match(skill, /at least 30 seconds/i)
  assert.match(skill, /never a tight loop/i)
})

test('a validation run pilots the shared preconditions before the whole plan', () => {
  // Every case repeats login/environment: a broken precondition fails all of
  // them, so the plan's runtime buys no information the pilot did not.
  assert.match(skill, /Pilot execution/)
  assert.match(skill, /SINGLE representative target/)
  assert.match(skill, /only after the pilot passes/i)
  // One execution per case pays queue and pod startup again for results the
  // platform already reports per case.
  assert.match(skill, /Never split a plan into one execution per case/i)
})

test('failures are grouped by signature and re-runs are scoped', () => {
  assert.match(skill, /failureSignature/)
  assert.match(skill.replace(/\n/g, ' '), /ONE problem, not N/i)
  assert.match(
    skill.replace(/\n/g, ' '),
    /never open\s*—?\s*one investigation — or one subagent — per case/i
  )
  assert.match(skill.replace(/\n/g, ' '), /only the previously failing targets/i)
})
