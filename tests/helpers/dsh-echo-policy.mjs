import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadDshPluginSkills } from '../../adapters/dsh/plugin-skills.mjs'
import { qualifyDshVoidrTools } from '../../adapters/dsh/skill-parity.mjs'

// Detailed rules are packaged resources, not eagerly injected startup text.
// Check their reachable resource base before asserting workflow contracts.
export function loadEchoWorkflowPolicy() {
  const skill = loadDshPluginSkills().find(item => item.name === 'voidr-echo-analysis')
  assert.ok(skill, 'Echo entry skill must be bundled')
  assert.equal(skill.resourceBase?.kind, 'directory')
  assert.match(skill.content, /references\/detailed-workflows\.md/)
  const workflow = readFileSync(join(skill.resourceBase.path, 'references/detailed-workflows.md'), 'utf8')
  return { ...skill, content: skill.content + '\n\n' + qualifyDshVoidrTools(workflow) }
}
