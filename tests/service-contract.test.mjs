import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { loadPolicy } from '../scripts/lib/policy.mjs'

const serviceRoot = resolve(import.meta.dirname, '../../service')
const toolsRoot = join(serviceRoot, 'src/modules/mcp-server/tools')

test(
  'policy tool names match the checked-out Voidr service contract',
  { skip: !existsSync(toolsRoot) },
  () => {
    const registered = discoverRegisteredTools(toolsRoot)
    const policy = loadPolicy()
    for (const name of [...policy.safeRemoteTools, ...policy.forbiddenTools]) {
      assert.equal(
        registered.has(name),
        true,
        `${name} is not registered by the checked-out service`
      )
    }
  }
)

test(
  'each forbidden process-starting tool has concrete dispatch evidence',
  { skip: !existsSync(toolsRoot) },
  () => {
    const evidence = {
      agent_jobs_trigger_automation: [
        'agent-jobs.tools.ts',
        'triggerAutomationGeneration'
      ],
      agent_jobs_trigger_hive_automation: [
        'agent-jobs.tools.ts',
        'automationSessionService.create'
      ],
      test_plan_generation_generate_test_plan_draft: [
        'test-plan-generation.tools.ts',
        'hive.triggerAction'
      ],
      failure_reports_self_healing_trigger: [
        'failure-reports.tools.ts',
        'triggerSelfHealingBypass'
      ],
      system_batch_execute: ['batch-execute.tools.ts', 'registry.callTool']
    }

    for (const [tool, [file, fragment]] of Object.entries(evidence)) {
      const content = readFileSync(join(toolsRoot, file), 'utf8')
      assert.match(content, new RegExp(escapeRegex(fragment)), `${tool} evidence changed`)
    }
  }
)

function discoverRegisteredTools(directory) {
  const names = new Set()
  for (const file of readdirSync(directory).filter(name =>
    name.endsWith('.tools.ts')
  )) {
    const content = readFileSync(join(directory, file), 'utf8')
    const prefix = content.match(/const PREFIX = '([^']+)'/)?.[1]
    if (!prefix) continue
    for (const match of content.matchAll(/\bname:\s*'([a-zA-Z0-9_]+)'/g)) {
      names.add(`${prefix}_${match[1]}`)
    }
  }
  return names
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
