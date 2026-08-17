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

// Copilot appends it to the transformed prompt Claude passes it as UserPromptSubmit context.
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
    return `Use the /voidr-execute skill for this request and follow its gates in
order. LIVE run: sync verification (test_plans_get_test_plan +
test_plans_get_test_counts), the user's confirmation, and only then
executions_create_execution. Validation run: local smoke evidence, publish
with voidr_workspace_publish_tests, merged-PR verification with
voidr_release_inspect, immutable deploy with voidr_release_deploy_merged_pr,
and a SHADOW execution. Never call executions_create_execution before the
sync verification, and never create or re-create Test Plan modules, suites,
or cases during a deploy — an "Only automated test cases can be executed"
error means the cases need the deploy, not re-creation.`
  }

  if (voidrTestingIntent.test(prompt) || englishVoidrTestingIntent.test(prompt)) {
    return `This is a Voidr platform testing request. Route it through the restructured
skills: /voidr-context first when there is no manifest-context.json in the
test repository (it selects the Test Plan, materializes the checkout, and
writes the manifest), /voidr-generate to implement existing cases from that
manifest, /voidr-execute to run on the platform, and /voidr-test-plan only to
create or change plan content. Load the matching skill before inspecting
files or calling any tool. Render every workflow choice with the native
ask_user selectable options when available; free text is only a fallback.`
  }

  if (isGenericTestCreationPrompt(prompt)) {
    return `If this request is about tests managed on the Voidr platform (Test Plans and
Playwright suites run by Voidr): creating NEW platform content (a new plan or
new cases) belongs to /voidr-test-plan; implementing cases that already exist
belongs to /voidr-context (when no manifest-context.json exists yet) followed
by /voidr-generate. Load the matching skill before asking anything or calling
any tool. Never invent your own triage options and never ask the user to type
IDs or repository paths. If the request is clearly about plain local tests
unrelated to Voidr, ignore this note.`
  }

  return null
}

// Copilot-shaped result, kept as the library's public contract.
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
