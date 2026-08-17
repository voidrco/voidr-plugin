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
const packageManifest = readJson('package.json')
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
  packageManifest.version === manifest.version &&
    marketplace.metadata?.version === manifest.version,
  'Package and marketplace metadata versions must match plugin.json.'
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
assert(
  !server?.env?.VOIDR_CREDENTIAL_PROFILE,
  'Production must reuse the default Voidr Service Account store.'
)
assert(
  server?.env?.VOIDR_PLATFORM_URL === 'https://platform.voidr.co',
  'Voidr platform links must use production.'
)
assert(
  server?.env?.VOIDR_AUTH_CALLBACK_URL ===
    'https://platform.voidr.co/auth/cli-connect',
  'Browser authentication must use the Auth0-allowlisted production callback.'
)
assert(
  server?.env?.VOIDR_API_URL === 'https://api.voidr.co/v1' &&
    server?.env?.VOIDR_MCP_URL === 'https://api.voidr.co/v1/mcp' &&
    server?.env?.VOIDR_MCP_ORIGIN === 'https://platform.voidr.co' &&
    server?.env?.VOIDR_TOKEN_URL ===
      'https://api.voidr.co/v1/service-accounts/token',
  'Voidr API, MCP, origin, and token endpoints must use production.'
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
const guardScript = readFileSync(
  join(root, 'scripts/guard-hive-tools.mjs'),
  'utf8'
)
assert(
  /enforcePlanModeGate/.test(guardScript) &&
    /enforceTestPlanWriteApproval/.test(guardScript) &&
    /Aprovo este Test Plan/.test(guardScript) &&
    /Confirmar insumos do planejamento/.test(guardScript),
  'The runtime hook must enforce plan-mode, planning-input, and explicit Test Plan approval gates.'
)
const promptHooks = hooks.hooks?.userPromptTransformed
assert(
  Array.isArray(promptHooks) &&
    promptHooks.some(item =>
      String(item.bash || item.command || '').includes(
        'route-voidr-prompt.mjs'
      )
    ),
  'Natural Voidr testing requests must be routed before model execution.'
)
const postToolHooks = hooks.hooks?.postToolUse
assert(
  Array.isArray(postToolHooks) &&
    postToolHooks.some(item =>
      String(item.bash || item.command || '').includes(
        'post-tool-execution-links.mjs'
      )
    ),
  'Execution evidence must be propagated after tool use.'
)
const stopHooks = hooks.hooks?.stop
assert(
  Array.isArray(stopHooks) &&
    stopHooks.some(item =>
      String(item.bash || item.command || '').includes(
        'require-execution-links.mjs'
      )
    ),
  'Responses backed by executions must be blocked until they include links.'
)

// --- Claude Code host -------------------------------------------------------
// The same skills, bridge, and policy serve both hosts. Only the manifest, the
// hook wiring, and the plugin-root variable differ

const claudeManifest = readJson('.claude-plugin/plugin.json')
const claudeMarketplace = readJson('.claude-plugin/marketplace.json')
const claudeHooks = readJson('hooks/hooks.json')
const claudeMcp = readJson('mcp/claude.json')

assert(
  claudeManifest.name === 'voidr',
  '.claude-plugin/plugin.json must name the plugin "voidr" so skills resolve as /voidr:<skill>.'
)
assert(
  claudeManifest.version === manifest.version,
  'Claude and Copilot manifests must ship the same version.'
)
assert(
  claudeManifest.skills === './skills/' &&
    claudeManifest.hooks === './hooks/hooks.json' &&
    claudeManifest.mcpServers === './mcp/claude.json',
  '.claude-plugin/plugin.json must point at the shared skills and the Claude hook and MCP configs.'
)
const claudeMarketplaceEntry = claudeMarketplace.plugins?.find(
  entry => entry.name === claudeManifest.name
)
assert(
  claudeMarketplace.name === 'voidrco' &&
    claudeMarketplaceEntry?.source === './' &&
    claudeMarketplaceEntry?.version === manifest.version &&
    claudeMarketplace.metadata?.version === manifest.version,
  'The Claude marketplace entry must resolve to this plugin root at the shared version.'
)

const claudeHookEvents = {
  UserPromptSubmit: 'route-voidr-prompt.mjs',
  PreToolUse: 'guard-hive-tools.mjs',
  PostToolUse: 'post-tool-execution-links.mjs',
  Stop: 'require-execution-links.mjs'
}
for (const [event, script] of Object.entries(claudeHookEvents)) {
  const entries = (claudeHooks.hooks?.[event] || []).flatMap(
    entry => entry.hooks || []
  )
  const commands = entries.map(item => String(item.command || ''))
  // A PreToolUse hook that Claude cancels on timeout fails OPEN
  assert(
    entries.every(item => Number(item.timeout) >= 15),
    `hooks/hooks.json ${event} needs a timeout of at least 15s; a canceled gate hook fails open.`
  )
  assert(
    commands.some(command => command.includes(script)),
    `hooks/hooks.json must run ${script} on ${event}.`
  )
  assert(
    commands.every(command => command.includes('${CLAUDE_PLUGIN_ROOT}')),
    `hooks/hooks.json ${event} commands must resolve through \${CLAUDE_PLUGIN_ROOT}.`
  )
}

const claudeServer = claudeMcp.mcpServers?.voidr
assert(
  claudeServer?.args?.[0] ===
    '${CLAUDE_PLUGIN_ROOT}/scripts/voidr-mcp-bridge.mjs',
  'The Claude MCP bridge path must resolve through ${CLAUDE_PLUGIN_ROOT}.'
)
// Copilot filters tools through the .mcp.json allowlist; Claude has no such field.
const hostOnlyMcpKeys = new Set(['tools', 'disableToolCache', 'args'])
for (const key of new Set([
  ...Object.keys(server || {}),
  ...Object.keys(claudeServer || {})
])) {
  if (hostOnlyMcpKeys.has(key)) continue
  assert(
    JSON.stringify(server?.[key]) === JSON.stringify(claudeServer?.[key]),
    `.mcp.json and mcp/claude.json disagree on "${key}"; the two hosts must reach the same Voidr endpoints.`
  )
}
assert(
  !JSON.stringify(claudeMcp).includes('${PLUGIN_ROOT}'),
  'mcp/claude.json must not use the Copilot ${PLUGIN_ROOT} variable.'
)

// ---------------------------------------------------------------------------

const skillFiles = findFiles(join(root, 'skills'), 'SKILL.md')
assert(skillFiles.length >= 4, 'Expected the four MVP skills.')
const toolReferencePattern =
  /`((?:voidr|applications|test_plans|executions|playwright|defects|file_embeddings)_[a-z0-9_]+)`/g
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
  // The skills say `ask_user`; Claude names the same tool AskUserQuestion.
  assert(
    /`AskUserQuestion` on Claude Code/.test(content),
    `${relative(path)} must map ask_user to each host's native question tool.`
  )
  assert(
    /^## Tool routing$/m.test(content),
    `${relative(path)} must declare a "## Tool routing" section mapping every scenario to one exact MCP tool.`
  )
  for (const match of content.matchAll(toolReferencePattern)) {
    assert(
      configuredTools.has(match[1]),
      `${relative(path)} references ${match[1]}, which is not in the MCP allowlist.`
    )
  }
  for (const forbidden of policy.forbiddenTools) {
    assert(
      !content.includes(forbidden),
      `${relative(path)} references forbidden tool ${forbidden}.`
    )
  }
}

const routingDocPath = join(root, 'docs/mcp-tool-routing.md')
assert(
  existsSync(routingDocPath),
  'docs/mcp-tool-routing.md must document the canonical tool routing.'
)
if (existsSync(routingDocPath)) {
  const routingDoc = readFileSync(routingDocPath, 'utf8')
  for (const tool of configuredTools) {
    assert(
      routingDoc.includes(tool),
      `docs/mcp-tool-routing.md must route the configured tool ${tool}.`
    )
  }
}

// --- Restructured skill contracts (setup / context / generate / execute) ---
// The shared contracts live once in skills/CONTRACTS.md; every voidr-* skill
// references that file instead of repeating them.

const contracts = readFileSync(join(root, 'skills/CONTRACTS.md'), 'utf8')
const contractsFlat = contracts.replace(/\s+/g, ' ')
assert(
  /Never call a tool that starts a Hive process/i.test(contracts),
  'CONTRACTS.md must state the Hive invariant.'
)
assert(
  /grouped, not absent/i.test(contractsFlat) &&
    /activation entry whose summary lists that tool/i.test(contractsFlat) &&
    /never invent an activation name/i.test(contractsFlat) &&
    /never fall back to a terminal command/i.test(contractsFlat) &&
    /ToolSearch/.test(contractsFlat) &&
    /before the host's own mechanism has been tried/i.test(contractsFlat),
  'CONTRACTS.md must carry the grouped/deferred tool contract for both hosts.'
)
assert(
  /Never run Git, npm, npx, Playwright, or the Voidr CLI in the terminal/i.test(
    contracts
  ),
  'CONTRACTS.md must keep framework commands inside the bridge.'
)
assert(
  /Never reproduce credentials/i.test(contractsFlat) &&
    /\{\{env\.VARIABLE_NAME\}\}/.test(contractsFlat) &&
    /Never read or print `\.env` contents/i.test(contractsFlat),
  'CONTRACTS.md must carry the secrets contract.'
)
assert(
  /returned it in this session/i.test(contracts),
  'CONTRACTS.md must carry the data-provenance contract.'
)
assert(
  /never clones the test repository/i.test(contracts) &&
    /clone handover message/i.test(contracts),
  'CONTRACTS.md must hand the clone to the user.'
)
assert(
  /Never install, switch, or pin a Node runtime/i.test(contracts),
  'CONTRACTS.md must carry the Node runtime contract.'
)

const setupSkill = readFileSync(join(root, 'skills/voidr-setup/SKILL.md'), 'utf8')
const setupFlat = setupSkill.replace(/\s+/g, ' ')
const contextSkill = readFileSync(join(root, 'skills/voidr-context/SKILL.md'), 'utf8')
const generateSkill = readFileSync(join(root, 'skills/voidr-generate/SKILL.md'), 'utf8')
const executeSkill = readFileSync(join(root, 'skills/voidr-execute/SKILL.md'), 'utf8')
const testPlanSkill = readFileSync(join(root, 'skills/voidr-test-plan/SKILL.md'), 'utf8')
const failureSkill = readFileSync(
  join(root, 'skills/voidr-failure-analysis/SKILL.md'),
  'utf8'
)

// Setup absorbs the connection: machine dependencies AND authentication.
assert(
  /voidr_environment_doctor/.test(setupSkill) &&
    /voidr_auth_status/.test(setupSkill) &&
    /voidr_auth_select_organization/.test(setupSkill) &&
    /voidr_auth_login/.test(setupSkill),
  'Setup skill must cover machine dependencies and Voidr authentication.'
)
assert(
  /Never ask for a Client ID or Client Secret/i.test(setupFlat) &&
    /never read credential files/i.test(setupFlat),
  'Setup skill must protect CLI and credential files.'
)
assert(
  /Never suggest disabling the security product/i.test(setupSkill),
  'Setup skill must respect corporate security products.'
)

// Context: the atomic bootstrap is the only setup path and writes the
// gitignored manifest at the repository root.
assert(
  /voidr_context_bootstrap/.test(contextSkill) &&
    /manifest-context\.json/.test(contextSkill) &&
    /\.gitignore/.test(contextSkill),
  'Context skill must route the atomic bootstrap and the gitignored manifest.'
)
assert(
  /needsEnvironmentSelection/.test(contextSkill) &&
    /Clone handover message/i.test(contextSkill) &&
    /idempotent/i.test(contextSkill),
  'Context skill must handle environment selection, clone handover, and retries.'
)
assert(
  /ONLY setup path/i.test(contextSkill) &&
    /never run npm, git, or the Voidr CLI in the terminal/i.test(contextSkill),
  'Context skill must forbid separate setup tools and terminal commands.'
)
assert(
  /never creates or changes Test\s+Plan content/i.test(contextSkill.replace(/\n/g, ' ')) ||
    /never creates or changes Test Plan content/i.test(contextSkill),
  'Context skill must stay read-only on plan content.'
)

// Generate: manifest-anchored, evidence-driven implementation.
assert(
  /manifest-context\.json/.test(generateSkill) &&
    /\/voidr-context/.test(generateSkill),
  'Generate skill must require the context manifest before any work.'
)
assert(
  /test_plans_get_case/.test(generateSkill) &&
    /Arrange\/Act\/Assert literally/i.test(generateSkill),
  'Generate skill must read the approved AAA per selected case.'
)
assert(
  /sessions_get_session_actions/.test(generateSkill) &&
    /sessions_get_session_digest/.test(generateSkill) &&
    /"no evidence", never an error/i.test(generateSkill) &&
    /Never copy recorded input VALUES/i.test(generateSkill),
  'Generate skill must consume recorded-session evidence safely.'
)
assert(
  /mode: "exploration"/.test(generateSkill) &&
    /never counts as validation/i.test(generateSkill) &&
    /DELETE the probe/i.test(generateSkill),
  'Generate skill must scope exploration probes as throwaway inspection.'
)
assert(
  /zero failures and zero skips/i.test(generateSkill) &&
    /Never weaken an assertion/i.test(generateSkill),
  'Generate skill must gate validation on a clean run.'
)
assert(
  /test_plans_update_case/.test(generateSkill) &&
    /explicit approval/i.test(generateSkill) &&
    /honestly failing/i.test(generateSkill),
  'Generate skill must gate AAA updates behind explicit human approval.'
)
assert(
  /never invents a case/i.test(generateSkill) &&
    /never\s+expands into unselected ones/i.test(generateSkill.replace(/\n/g, ' ')),
  'Generate skill must implement only existing selected cases.'
)

// Execute: sync verification before any execution write; SHADOW validation.
assert(
  /test_plans_get_test_counts/.test(executeSkill) &&
    /sync verification/i.test(executeSkill.replace(/\n/g, ' ')),
  'Execute skill must verify automation sync before executing.'
)
assert(
  /executionType: "SHADOW"/.test(executeSkill),
  'Execute skill must run validation executions as SHADOW.'
)
assert(
  /voidr_workspace_publish_tests/.test(executeSkill) &&
    /voidr_release_inspect/.test(executeSkill) &&
    /voidr_release_deploy_merged_pr/.test(executeSkill),
  'Execute skill must publish and deploy through the release gates.'
)
assert(
  /Never deploy code that did not pass/i.test(executeSkill),
  'Execute skill must require local smoke evidence before a deploy.'
)
assert(
  /at least 30 seconds/i.test(executeSkill) &&
    /never a tight loop/i.test(executeSkill),
  'Execute skill must monitor executions with a bounded polling cadence.'
)
assert(
  /never trigger\s+self-healing/i.test(executeSkill.replace(/\n/g, ' ')),
  'Execute skill must never trigger self-healing.'
)

const devSkill = readFileSync(join(root, 'skills/voidr-feature-test/SKILL.md'), 'utf8')

// The grouped/deferred tool contract lives once in CONTRACTS.md (asserted
// above); every voidr-* skill has to reference the shared contracts file.
for (const skillName of [
  'voidr-setup',
  'voidr-context',
  'voidr-generate',
  'voidr-execute',
  'voidr-test-plan',
  'voidr-feature-test',
  'voidr-failure-analysis'
]) {
  const skillText = readFileSync(
    join(root, `skills/${skillName}/SKILL.md`),
    'utf8'
  )
  assert(
    /CONTRACTS\.md/.test(skillText),
    `${skillName} must reference the shared contracts file.`
  )
}

// A plan without a repository is reported as a partial delivery, in the user's
// terms, and never as an instruction to change infrastructure.
for (const [skillName, skillText] of [
  ['voidr-feature-test', devSkill.replace(/\s+/g, ' ')],
  ['voidr-test-plan', testPlanSkill.replace(/\s+/g, ' ')]
]) {
  assert(
    /Reporting a missing test repository/i.test(skillText) &&
      /Lead with the state/i.test(skillText) &&
      /never a tool name/i.test(skillText) &&
      /never advise changing an environment variable/i.test(skillText),
    `${skillName} must report a missing test repository as a partial delivery instead of success.`
  )
}

// The clone is the user's, and it is also how access to a repository living in
// Voidr's organization is proven. No skill may offer to clone it.
for (const [skillName, skillText] of [
  ['voidr-feature-test', devSkill.replace(/\s+/g, ' ')],
  ['voidr-test-plan', testPlanSkill.replace(/\s+/g, ' ')]
]) {
  assert(
    /Handing the clone to the user/i.test(skillText) &&
      /HTTPS first and SSH after it/i.test(skillText) &&
      /inside the open workspace folder/i.test(skillText) &&
      /never run the clone yourself/i.test(skillText) &&
      /administrator of their own\s+organization in the Voidr platform/i.test(skillText),
    `${skillName} must hand the clone to the user with both commands, and never clone it.`
  )
}

// The framework's own convention file is the source of truth for test style,
// and the four rules below each come from a failure observed in a real run.
for (const [skillName, skillText] of [
  ['voidr-feature-test', devSkill.replace(/\s+/g, ' ')],
  ['voidr-generate', generateSkill.replace(/\s+/g, ' ')]
]) {
  assert(
    /read the test repository's own convention file/i.test(skillText) &&
      /win on style/i.test(skillText) &&
      /assert the text the DOM carries/i.test(skillText) &&
      /never by index/i.test(skillText) &&
      /positive web-first assertion before any negative one/i.test(skillText) &&
      /waits belong to the action layer/i.test(skillText),
    `${skillName} must defer to the repository conventions and carry the Playwright rules that failures proved.`
  )
}

for (const [skillName, skillText] of [
  ['voidr-test-plan', testPlanSkill],
  ['voidr-feature-test', devSkill],
  ['voidr-generate', generateSkill]
]) {
  assert(
    /file_embeddings_search_documents/i.test(skillText) &&
      /applicationId[\s\S]*?limit: 5[\s\S]*?minScore: 0\.5[\s\S]*?includeContent: true/i.test(
        skillText
      ) &&
      /results\[\]\.chunks\[\]\.contentPreview/i.test(skillText) &&
      /deduplicate[\s\S]*?fileId[\s\S]*?chunkIndex/i.test(skillText) &&
      /code[\s\S]*?runtime[\s\S]*?authoritative/i.test(skillText) &&
      /documentation[\s\S]*?supporting\s+evidence[\s\S]*?stale/i.test(skillText) &&
      /Never\s+fall\s+back\s+to\s+`knowledge_\*`/i.test(skillText),
    `${skillName} must retrieve app-scoped document chunks without treating documentation as authoritative or crossing into the knowledge base.`
  )
}
assert(
  /Assimilate indexed application documentation before deriving scenarios/i.test(
    devSkill
  ) &&
    ['actors', 'permissions', 'preconditions', 'user flow'].every(term =>
      new RegExp(term, 'i').test(devSkill)
    ) &&
    ['business rules', 'states', 'transitions', 'expected outcomes'].every(
      term => new RegExp(term, 'i').test(devSkill)
    ) &&
    ['errors', 'alternatives', 'fallbacks', 'edge cases'].every(term =>
      new RegExp(term, 'i').test(devSkill)
    ),
  'Dev skill must assimilate functional documentation before scenario design.'
)
assert(
  /user manuals[\s\S]*?product and operations guides[\s\S]*?business-rule references/i.test(
    generateSkill
  ) &&
    /Documentation cannot add an unselected case/i.test(generateSkill),
  'Generate skill must use product documentation without expanding approved scope.'
)
assert(
  /Never expose platform vocabulary/i.test(devSkill) &&
    /Do not say Test Plan, module,\s+suite, case slug, scaffold/i.test(devSkill),
  'Dev skill must hide platform vocabulary from the user.'
)
assert(
  /reply exactly `Criar testes`/i.test(devSkill) &&
    /Do not use `ask_user` for this approval/i.test(devSkill),
  'Dev skill must gate platform writes behind the typed “Criar testes” approval.'
)
assert(
  /Infer the feature|current branch name/i.test(devSkill) &&
    /changedHunksVsDefault/.test(devSkill) &&
    /repositoryPath/.test(devSkill),
  'Dev skill must infer the feature from the Git branch and diff hunks, and re-scope by repositoryPath.'
)
assert(
  /The diff is the scope/i.test(devSkill) &&
    /drop every one the change does not affect/i.test(devSkill) &&
    /never put it in the\s+checklist/i.test(devSkill),
  'Dev skill must scope scenarios to the diff and drop untouched rules.'
)
assert(
  /One smoke run per user message/i.test(devSkill) &&
    /Never auto-deploy, never auto-execute/i.test(devSkill),
  'Dev skill must keep the smoke-stop and deploy/execution gates.'
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
