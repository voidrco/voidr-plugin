import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { adaptDshSkill } from './skill-parity.mjs'

const skillsRoot = join(dirname(fileURLToPath(import.meta.url)), 'skills')

export function loadDshPluginSkills() {
  const skills = readdirSync(skillsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => readSkill(join(skillsRoot, entry.name, 'SKILL.md')))
  const originalRoot = join(skillsRoot, '../../../skills')
  const canonical = ['voidr-context', 'voidr-generate', 'voidr-execute'].map(name =>
    adaptDshSkill(readSkill(join(originalRoot, name, 'SKILL.md'))))
  const automate = skills.find(skill => skill.name === 'voidr-automate')
  automate.content += '\n\n## Canonical generation contract\n' + canonical.find(skill => skill.name === 'voidr-generate').content
  return [...skills, ...canonical].sort((left, right) => left.name.localeCompare(right.name))
}

export function registerDshPluginSkills(registry) {
  return loadDshPluginSkills().map(skill => registry.register(skill))
}

function readSkill(path) {
  const source = readFileSync(path, 'utf8')
  const match = source.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!match) throw new Error(`Invalid DSH skill frontmatter: ${path}`)
  const metadata = Object.fromEntries(
    match[1]
      .split('\n')
      .map(line => line.match(/^([a-zA-Z][\w-]*):\s*(.*)$/))
      .filter(Boolean)
      .map(([, key, value]) => [key, value.trim()])
  )
  if (!metadata.name || !metadata.description) {
    throw new Error(`DSH skill requires name and description: ${path}`)
  }
  return {
    name: metadata.name,
    description: metadata.description,
    content: match[2].trim(),
    source: 'bundled',
    path,
    resourceBase: { kind: 'directory', path: dirname(path) },
    provider: 'voidr-plugin'
  }
}
