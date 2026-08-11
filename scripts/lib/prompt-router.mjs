import {
  isDevTestFlowPrompt,
  isDevTestsApproval,
  SKILL_INVOCATION_PREFIX
} from './session-state.mjs'

const voidrTestingIntent =
  /\b(?:desenvolver|criar|implementar|automatizar|planejar|publicar|subir|executar|rodar)\b[\s\S]{0,80}\b(?:testes?|test plans?|planos? de testes?)\b[\s\S]{0,80}\bvoidr\b|\bvoidr\b[\s\S]{0,80}\b(?:desenvolver|criar|implementar|automatizar|planejar|publicar|subir|executar|rodar)\b[\s\S]{0,80}\b(?:testes?|test plans?|planos? de testes?)\b/i

const englishVoidrTestingIntent =
  /\b(?:create|implement|develop|add|list|select|update|run|execute)\b[\s\S]{0,80}\btest\s*plans?\b|\bvoidr\b[\s\S]{0,80}\btest\s*(?:plans?|cases?)\b/i

const explicitVoidrSkill = new RegExp(
  `${SKILL_INVOCATION_PREFIX}voidr-[a-z-]+`,
  'i'
)

function isDeployTestsPrompt(prompt) {
  const text = String(prompt || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
  return /\b(?:deploy|publicar?|subir|implantar?)\b[\s\S]{0,50}\btestes?\b|\btestes?\b[\s\S]{0,30}\b(?:deploy|deployados?)\b|\bexecutar?\b[\s\S]{0,40}\btestes?\b[\s\S]{0,40}\bplataforma\b/.test(
    text
  )
}

// The routing note, independent of how a host delivers it. Copilot appends it
// to the transformed prompt; Claude passes it as UserPromptSubmit context.
// Both end up in front of the model before it acts on the request.
export function voidrPromptGuidance(input) {
  const prompt = String(input?.prompt || '')

  if (!prompt || explicitVoidrSkill.test(prompt)) return null
  if (isDevTestsApproval(prompt)) return null

  if (isDevTestFlowPrompt(prompt)) {
    return `Use the /voidr-feature-test skill for this request. Load that skill before inspecting
files or calling any tool. It is the developer-first flow: infer the feature
with the voidr_workspace_git_context tool (never cd or run git in the
terminal — workspace paths with spaces break shell quoting), confirm
everything on one ask_user card, show plain-language test scenarios, and wait
for the typed “Criar testes” approval. Never ask whether the Test Plan is new
or existing — the flow decides that silently — and never expose platform
vocabulary such as Test Plan, scaffold, module, suite, or case slug to the
user.`
  }

  if (isDeployTestsPrompt(prompt)) {
    return `Use the /voidr-deploy-run skill for this request and follow its gates in
order: merged-PR evidence, immutable deploy with
voidr_release_deploy_merged_pr, independent sync verification
(test_plans_get_test_plan + test_plans_get_test_counts), and only then the
execution. Start by calling voidr_release_inspect on the selected test
repository — never ask the user for the Test Plan ID, repository URL, or PR
number; the inspection discovers all of them. Never call
executions_create_execution before the deploy and sync verification, and
never create or re-create Test Plan modules, suites, or cases during a
deploy — an "Only automated test cases can be executed" error means the
cases need the deploy, not re-creation.`
  }

  if (voidrTestingIntent.test(prompt) || englishVoidrTestingIntent.test(prompt)) {
    return `Use the /voidr-develop-tests skill for this request. Load that skill before
inspecting files or calling any tool. Its first-turn Test Plan mode question,
MCP application discovery, and repository-ordering rules are mandatory.
Render every workflow choice (plan mode, application, environment, Test Plan,
repository, planning inputs) with the native ask_user selectable options when
available; free text is only a fallback. Only the two runtime confirmations
must be typed in chat.`
  }

  if (isGenericTestCreationPrompt(prompt)) {
    return `If this request is about tests managed on the Voidr platform (Test Plans and
Playwright suites run by Voidr), load the /voidr-develop-tests skill before
asking anything or calling any tool, and start with its mandatory
new-versus-existing Test Plan question. A request to create a new test or
case means creating new platform content — inside an existing plan, use the
"Add cases to an existing plan" route of /voidr-test-plan; it is never a
request to implement cases that already exist. Never invent your own triage
options and never ask the user to type IDs or repository paths. If the
request is clearly about plain local tests unrelated to Voidr, ignore this
note.`
  }

  return null
}

// Copilot-shaped result, kept as the library's public contract. The hook
// serializes `guidance` for whichever host is running; see lib/host.mjs.
export function routeVoidrPrompt(input) {
  const guidance = voidrPromptGuidance(input)
  if (!guidance) return {}
  const prompt = String(input?.prompt || '')
  const transformedPrompt = String(input?.transformedPrompt || prompt)
  return {
    guidance,
    modifiedTransformedPrompt: `${transformedPrompt}\n\n${guidance}`
  }
}

function isGenericTestCreationPrompt(prompt) {
  const text = String(prompt || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
  return /\b(?:criar?|crie|desenvolver?|implementar?|escrever?|escreva|gerar?|gere|montar?|monte|automatizar?)\b[\s\S]{0,60}\btestes?\b/.test(
    text
  )
}
