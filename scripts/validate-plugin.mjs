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
const entryFrontmatter = parseFrontmatter(entrySkill)
const connectSkill = readFileSync(
  join(root, 'skills/voidr-connect/SKILL.md'),
  'utf8'
)
const testPlanSkill = readFileSync(
  join(root, 'skills/voidr-test-plan/SKILL.md'),
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
assert(
  /selects either option, immediately call `voidr_auth_status`[\s\S]*?requires no confirmation[\s\S]*?Do not ask\s+whether to validate authentication/i.test(
    entrySkill
  ),
  'Entry skill must continue directly to the read-only auth check after plan-mode selection.'
)
assert(
  /quero desenvolver testes na Voidr/i.test(entryFrontmatter.description || '') &&
    /automatizar testes na Voidr/i.test(entryFrontmatter.description || ''),
  'Entry skill description must include natural Portuguese routing triggers.'
)
assert(
  /native `ask_user` question UI[\s\S]*?Criar novo Test Plan[\s\S]*?Usar Test Plan existente/i.test(
    entrySkill
  ),
  'Entry skill must render new-versus-existing as selectable options.'
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
  /Always use `ask_user`[\s\S]*?returned application name[\s\S]*?`type`[\s\S]*?never ask the user to provide an `applicationId` manually/i.test(
    entrySkill
  ) &&
    /test_plans_list_test_plans[\s\S]*?selectable options[\s\S]*?never ask the user to type a `testPlanId`/i.test(
      entrySkill
    ),
  'Entry skill must use MCP-backed selectable application and Test Plan choices.'
)
assert(
  /selected application's MCP `type` as authoritative[\s\S]*?Never ask the user to decide WEB versus API/i.test(
    entrySkill
  ),
  'Entry skill must derive WEB/API from the selected Voidr application.'
)
assert(
  /applications_list_environments[\s\S]*?name[\s\S]*?slug[\s\S]*?applicationUrl/i.test(
    entrySkill
  ) &&
    /A single[\s\S]*?environment must still be confirmed/i.test(entrySkill),
  'Entry skill must select and confirm a Voidr environment from MCP.'
)
assert(
  /platform environment and local smoke target are different values/i.test(
    entrySkill
  ) &&
    /Usar ambiente Voidr[\s\S]*?Usar localhost[\s\S]*?localSmokeBaseUrl/i.test(
      entrySkill
    ),
  'Entry skill must keep the platform environment separate from local smoke.'
)
const planningInputQuestionIndex = entrySkill.indexOf(
  'Com base em quais insumos devo montar o Test Plan?'
)
const testPlanDraftIndex = entrySkill.indexOf(
  'present a complete Test Plan draft'
)
assert(
  planningInputQuestionIndex >= 0 &&
    testPlanDraftIndex > planningInputQuestionIndex &&
    /Analisar código-fonte do workspace[\s\S]*?Usar documentação ou requisitos[\s\S]*?Descrever regras e cenários no chat[\s\S]*?Combinar código, documentação e contexto do negócio/i.test(
      entrySkill
    ),
  'Entry skill must select planning inputs before showing a Test Plan draft.'
)
assert(
  /Application name, application type, environment,[\s\S]*?routing metadata, never sufficient test-design\s+evidence/i.test(
    entrySkill
  ) &&
    /Resumo dos insumos do planejamento[\s\S]*?Confirmar insumos do planejamento[\s\S]*?Do not show a Test Plan draft yet/i.test(
      entrySkill
    ),
  'Entry skill must reject routing metadata as evidence and confirm collected inputs before drafting.'
)
assert(
  /Com base em quais insumos devo montar o Test Plan\?[\s\S]*?routing metadata[\s\S]*?never sufficient\s+evidence/i.test(
    testPlanSkill
  ) &&
    /Confirmar insumos do planejamento[\s\S]*?new user message[\s\S]*?Do not render a Test Plan\s+draft before it/i.test(
      testPlanSkill
    ),
  'Test Plan skill must enforce the planning-input evidence gate before its visible draft.'
)
assert(
  /Before calling any Test Plan mutation tool, explicitly load the[\s\S]*?`\/voidr-test-plan` skill/i.test(
    entrySkill
  ) &&
    /Qual feature ou jornada da aplicação selecionada você quer testar[\s\S]*?primeiro/i.test(
      entrySkill
    ) &&
    /Do not infer a feature from the application name, product repository, route,[\s\S]*?README/i.test(
      entrySkill
    ),
  'Entry skill must explicitly load the Test Plan skill and require a user-selected feature.'
)
assert(
  /Only after explicit approval may the agent call[\s\S]*?test_plans_create_test_plan[\s\S]*?test_plans_populate_test_plan/i.test(
    entrySkill
  ),
  'Entry skill must block Test Plan writes until feature-scoped draft approval.'
)
assert(
  /repository returned by[\s\S]*?test_plans_create_test_plan[\s\S]*?authoritative/i.test(
    entrySkill
  ) &&
    /allowExistingGitRepository: true[\s\S]*?server-returned[\s\S]*?repositoryUrl/i.test(
      entrySkill
    ),
  'Entry skill must consume the repository provisioned by the Voidr MCP.'
)
assert(
  /gitProviderConfig\.repositoryUrl[\s\S]*?equals[\s\S]*?repository\.url/i.test(
    testPlanSkill
  ) &&
    /Repositório vinculado:\s*\[<owner>\/<repository-name>\]\(<repository\.url>\)/i.test(
      testPlanSkill
    ) &&
    /has not completed successfully until this clickable repository link/i.test(
      testPlanSkill
    ),
  'Test Plan skill must verify and return the linked repository as a clickable URL.'
)
assert(
  /exact approval[\s\S]*?Aprovar este Test Plan[\s\S]*?generic `Sim` is not[\s\S]*?new user message/i.test(
    entrySkill
  ),
  'Entry skill must require the exact post-draft approval message.'
)
assert(
  /user already named\s+a repository[\s\S]*?read-only inspection[\s\S]*?not ask permission again/i.test(
    entrySkill
  ) &&
    /For combined context,[\s\S]*?distinguish which\s+conclusion came from which source/i.test(
      entrySkill
    ),
  'Entry skill must honor explicitly authorized repositories and preserve evidence provenance.'
)
assert(
  /Present this question[\s\S]*?immediately after the feature answer[\s\S]*?do not ask whether the user wants to[\s\S]*?see the options/i.test(
    entrySkill
  ) &&
    /Immediately after the local smoke answer, ask exactly:[\s\S]*?Com base em quais insumos devo montar o Test Plan\?[\s\S]*?End the response and wait/i.test(
      entrySkill
    ),
  'Entry skill must ask smoke and planning-input questions without meta-confirmations.'
)
assert(
  /explicitly load[\s\S]*?`\/voidr-implement-tests` skill/i.test(entrySkill),
  'Entry skill must explicitly load the implementation skill before code work.'
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
assert(
  /If this status call fails,[\s\S]*?call `voidr_auth_login` directly/i.test(
    connectSkill
  ) &&
    /Never pass `default`[\s\S]*?not returned[\s\S]*?`serviceAccounts`/i.test(
      connectSkill
    ),
  'Connect skill must not invent an organization when status fails.'
)
assert(
  /first operational action must be a direct MCP call to[\s\S]*?`voidr_auth_status` with `\{\}`/i.test(
    connectSkill
  ) &&
    /Do not search, read, or inspect workspace files[\s\S]*?MCP bridge implementation/i.test(
      connectSkill
    ) &&
    /Never use a shell, terminal, `node`, `npx`, `curl`[\s\S]*?`voidr-mcp-bridge\.mjs`/i.test(
      connectSkill
    ),
  'Connect skill must force MCP-first authentication without filesystem or shell fallbacks.'
)
assert(
  /voidr_auth_status` is not available as an MCP tool[\s\S]*?reload the plugin and start a new chat[\s\S]*?Do not investigate through\s+files or the terminal/i.test(
    connectSkill
  ),
  'Connect skill must stop cleanly when its MCP tools are unavailable.'
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
