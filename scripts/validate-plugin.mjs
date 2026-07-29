#!/usr/bin/env node

import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadPolicy } from './lib/policy.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const errors = []
const manifest = readJson('plugin.json')
const mcp = readJson('.mcp.json')
const hooks = readJson('hooks.json')
const marketplace = readJson('.github/plugin/marketplace.json')
const policy = loadPolicy()

assert(
  typeof manifest.name === 'string' &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest.name),
  'plugin.json name must be kebab-case.'
)
assert(
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version || ''),
  'plugin.json version must be semantic.'
)
assert(manifest.skills === 'skills/', 'plugin.json must load skills/.')
assert(manifest.hooks === 'hooks.json', 'plugin.json must load hooks.json.')
assert(manifest.mcpServers === '.mcp.json', 'plugin.json must load .mcp.json.')
assert(marketplace.name === 'voidrco', 'Marketplace must be named voidrco.')
const marketplaceEntry = marketplace.plugins?.find(
  entry => entry.name === manifest.name
)
assert(
  marketplaceEntry?.version === manifest.version,
  'Marketplace plugin version must match plugin.json.'
)
assert(
  marketplaceEntry?.source === './',
  'Marketplace source must resolve to this plugin root.'
)

const server = mcp.mcpServers?.voidr
assert(server?.type === 'stdio', 'Voidr MCP must use the local stdio bridge.')
assert(server?.command === 'node', 'Voidr MCP bridge must run with Node.')
assert(
  server?.args?.[0] === '${PLUGIN_ROOT}/scripts/voidr-mcp-bridge.mjs',
  'Voidr MCP bridge path must be plugin-relative.'
)

const configuredTools = new Set(server?.tools || [])
const policyTools = new Set([...policy.localTools, ...policy.safeRemoteTools])
assert(
  setsEqual(configuredTools, policyTools),
  '.mcp.json tools must exactly match the policy allowlist.'
)
assert(
  policy.forbiddenTools.every(tool => !configuredTools.has(tool)),
  'A forbidden tool is present in the MCP allowlist.'
)
assert(
  policy.writeRemoteTools.every(tool => policy.safeRemoteTools.includes(tool)),
  'Every write tool must also be an allowed remote tool.'
)
assert(
  (policy.writeLocalTools || []).every(tool => policy.localTools.includes(tool)),
  'Every local write tool must also be an allowed local tool.'
)

assert(hooks.version === 1, 'hooks.json version must be 1.')
const preToolHooks = hooks.hooks?.preToolUse
assert(
  Array.isArray(preToolHooks) && preToolHooks.length > 0,
  'A preToolUse policy hook is required.'
)
assert(
  preToolHooks?.some(item =>
    String(item.bash || item.command || '').includes('guard-hive-tools.mjs')
  ),
  'The Hive guard must run on preToolUse.'
)

const skillFiles = findFiles(join(root, 'skills'), 'SKILL.md')
assert(skillFiles.length >= 4, 'Expected the four MVP skills.')
for (const path of skillFiles) {
  const content = readFileSync(path, 'utf8')
  const frontmatter = parseFrontmatter(content)
  assert(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(frontmatter.name || ''),
    `${relative(path)} has an invalid or missing skill name.`
  )
  assert(
    typeof frontmatter.description === 'string' &&
      frontmatter.description.length >= 20,
    `${relative(path)} needs a useful description.`
  )
  assert(
    /Never call a tool that starts a Hive process/i.test(content),
    `${relative(path)} must state the Hive invariant.`
  )
  for (const forbidden of policy.forbiddenTools) {
    assert(
      !content.includes(forbidden),
      `${relative(path)} references forbidden tool ${forbidden}.`
    )
  }
}

const entrySkill = readFileSync(
  join(root, 'skills/voidr-develop-tests/SKILL.md'),
  'utf8'
)
const connectSkill = readFileSync(
  join(root, 'skills/voidr-connect/SKILL.md'),
  'utf8'
)
const questionIndex = entrySkill.indexOf(
  'Você quer criar um novo Test Plan ou trabalhar em um Test Plan existente?'
)
const firstToolIndex = entrySkill.indexOf('voidr_auth_status')
assert(questionIndex >= 0, 'Entry skill must ask new versus existing.')
assert(
  questionIndex < firstToolIndex,
  'Entry skill must ask new versus existing before the first tool.'
)
assert(
  /Do not inspect `project\.json`[\s\S]*?before the user answers/i.test(entrySkill),
  'Entry skill must prohibit project.json inference before intent.'
)
assert(
  /first response must ask exactly one decision/i.test(entrySkill),
  'Entry skill must keep plan mode as the only first-turn decision.'
)
const applicationDiscoveryIndex = entrySkill.indexOf(
  'applications_list_applications'
)
const workspaceDiscoveryIndex = entrySkill.indexOf('voidr_workspace_inspect')
assert(
  applicationDiscoveryIndex >= 0 &&
    workspaceDiscoveryIndex >= 0 &&
    applicationDiscoveryIndex < workspaceDiscoveryIndex,
  'Entry skill must discover Voidr applications before workspace repositories.'
)
assert(
  /Build application choices exclusively from that tool response/i.test(
    entrySkill
  ) &&
    /workspace folder is a repository candidate, never an application candidate/i.test(
      entrySkill
    ),
  'Entry skill must separate MCP applications from workspace repositories.'
)
assert(
  /If it returns `authenticated: false`, stop the current workflow and reply[\s\S]*?\/copilot voidr-connect/i.test(
    entrySkill
  ),
  'Entry skill must stop and redirect missing authentication to /copilot voidr-connect.'
)
assert(
  /If `serviceAccountSelectionRequired` is true, ask which local Service Account/i.test(
    connectSkill
  ),
  'Connect skill must ask which locally available Service Account to use.'
)
assert(
  /If `authenticated` is false,[\s\S]*?call `voidr_auth_login`/i.test(
    connectSkill
  ),
  'Connect skill must start the official browser login when authentication is unavailable.'
)
assert(
  /browser flow handles user login and explicit organization selection/i.test(
    connectSkill
  ),
  'Connect skill must delegate organization selection to the browser flow.'
)
assert(
  /Never ask the user to create or edit a credential JSON/i.test(
    connectSkill
  ),
  'Connect skill must prohibit the legacy credential JSON flow.'
)

const allRepositoryText = findFiles(root)
  .filter(path => !path.includes(`${join(root, 'tests')}/`))
  .map(path => {
    try {
      return readFileSync(path, 'utf8')
    } catch {
      return ''
    }
  })
  .join('\n')
assert(
  !/(sa_[A-Za-z0-9]{12,}|sk_[A-Za-z0-9]{12,}|Basic [A-Za-z0-9+/]{24,}={0,2})/.test(
    allRepositoryText
  ),
  'Repository appears to contain a credential.'
)

if (errors.length) {
  for (const error of errors) process.stderr.write(`- ${error}\n`)
  process.exit(1)
}

process.stdout.write(
  `Validated ${skillFiles.length} skills, ${configuredTools.size} MCP tools, and the Hive guard.\n`
)

function readJson(path) {
  try {
    return JSON.parse(readFileSync(join(root, path), 'utf8'))
  } catch (error) {
    errors.push(`${path} is missing or invalid JSON: ${error.message}`)
    return {}
  }
}

function assert(condition, message) {
  if (!condition) errors.push(message)
}

function setsEqual(left, right) {
  return (
    left.size === right.size && [...left].every(value => right.has(value))
  )
}

function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return {}
  const values = {}
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(':')
    if (separator < 0) continue
    const key = line.slice(0, separator).trim()
    let value = line.slice(separator + 1).trim()
    value = value.replace(/^['"]|['"]$/g, '')
    values[key] = value
  }
  return values
}

function findFiles(directory, fileName = null) {
  if (!existsSync(directory)) return []
  const results = []
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) {
      if (['.git', 'node_modules'].includes(entry)) continue
      results.push(...findFiles(path, fileName))
    } else if (!fileName || entry === fileName) {
      results.push(path)
    }
  }
  return results
}

function relative(path) {
  return path.slice(root.length + 1)
}
