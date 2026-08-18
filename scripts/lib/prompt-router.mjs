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

function normalizePrompt(prompt) {
  return String(prompt || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}

function isDeployTestsPrompt(prompt) {
  return /\b(?:deploy|publicar?|subir|implantar?)\b[\s\S]{0,50}\btestes?\b|\btestes?\b[\s\S]{0,30}\b(?:deploy|deployados?)\b|\b(?:executar?|rodar?)\b[\s\S]{0,40}\btestes?\b[\s\S]{0,40}\bplataforma\b/.test(
    normalizePrompt(prompt)
  )
}

// `test plan` is platform vocabulary (see isGenericTestCreationPrompt), so a
// run request against one is a platform execution even without "voidr".
function isRunTestPlanPrompt(prompt) {
  return /\b(?:rodar?|executar?|execute|run|disparar?)\b[\s\S]{0,50}\b(?:test\s*plans?|planos?\s+de\s+testes?)\b/.test(
    normalizePrompt(prompt)
  )
}

function isExecutionFailurePrompt(prompt) {
  const text = normalizePrompt(prompt)
  if (!/\bexecu(?:cao|coes|tions?)\b/.test(text)) return false
  return (
    /\b(?:falh\w*|fail\w*|erros?|quebr\w*|analis\w*|investig\w*|diagnos\w*)\b/.test(
      text
    ) || /\bpor\s+que\b|\bwhy\b/.test(text)
  )
}

function isConnectPrompt(prompt) {
  const text = normalizePrompt(prompt)
  const namesServiceAccount = /\bservice\s*accounts?\b/.test(text)
  // "login" and "conta" appear constantly inside test-writing requests, so a
  // connect route without "voidr" (or the plugin's own "service account"
  // vocabulary) would steal prompts like "cria testes de login".
  if (!/\bvoidr\b/.test(text) && !namesServiceAccount) return false
  return (
    namesServiceAccount ||
    /\b(?:conectar?|connect\w*|autenticar?|authenticat\w*|logar|login|log\s*in|credenc\w*)\b/.test(
      text
    ) ||
    /\b(?:trocar?|mudar?|selecionar?|switch|change|select)\b[\s\S]{0,40}\b(?:organizacao|organizacoes|organizations?|contas?|accounts?)\b/.test(
      text
    )
  )
}

// Copilot appends it to the transformed prompt Claude passes it as UserPromptSubmit context.
export function voidrPromptGuidance(input) {
  const prompt = String(input?.prompt || '')

  if (!prompt || explicitVoidrSkill.test(prompt)) return null
  if (isDevTestsApproval(prompt)) return null

  if (isDevTestFlowPrompt(prompt)) {
    return `Use the /voidr-context skill for this request, then /voidr-generate. Load the
matching skill before inspecting files or calling any tool. /voidr-context
selects the Test Plan, materializes the checkout, and writes
manifest-context.json; /voidr-generate implements the selected cases from that
manifest. Infer repository state with the voidr_workspace_git_context tool
(never cd or run git in the terminal — workspace paths with spaces break shell
quoting). Render every workflow choice with the native ask_user selectable
options when available; free text is only a fallback.`
  }

  if (isDeployTestsPrompt(prompt) || isRunTestPlanPrompt(prompt)) {
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

  // Checked before the pipeline intents so a failed execution named next to a
  // Test Plan id lands on diagnosis instead of the implementation pipeline.
  if (isExecutionFailurePrompt(prompt)) {
    return `If this request is about an execution created on the Voidr platform: use
the /voidr-failure-analysis skill to diagnose it. Load the skill before
inspecting files or calling any tool; it reads the execution's Playwright
evidence from the platform. If the request is clearly about a local test run
unrelated to Voidr, ignore this note.`
  }

  if (
    voidrTestingIntent.test(prompt) ||
    englishVoidrTestingIntent.test(prompt) ||
    namesATestPlanId(prompt)
  ) {
    return `This is a Voidr platform testing request. Route it through the restructured
skills: /voidr-context first when there is no manifest-context.json in the
test repository (it selects the Test Plan, materializes the checkout, and
writes the manifest), /voidr-generate to implement existing cases from that
manifest, and /voidr-execute to run on the platform. Load the matching skill
before inspecting files or calling any tool. Render every workflow choice with
the native ask_user selectable options when available; free text is only a
fallback.`
  }

  if (isGenericTestCreationPrompt(prompt)) {
    return `If this request is about tests managed on the Voidr platform (Test Plans and
Playwright suites run by Voidr): implementing cases that already exist
belongs to /voidr-context (when no manifest-context.json exists yet), followed
by /voidr-generate. Load the matching skill before asking anything or calling
any tool. Never invent your own triage options and never ask the user to type
IDs or repository paths. If the request is clearly about plain local tests
unrelated to Voidr, ignore this note.`
  }

  // Checked after the testing intents so prompts like "cria testes de login
  // na voidr" keep the pipeline route instead of being read as authentication.
  if (isConnectPrompt(prompt)) {
    return `Use the /voidr-connect skill for this request. Load it before calling any
tool: its contract starts with the voidr_auth_status MCP call, reuses an
existing local Service Account when switching organizations, and opens the
official browser login only when no valid local account exists. Never ask the
user to type credentials, organization IDs, or JSON in chat.`
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

// A Test Plan named together with a 24-hex id is unambiguous: no other object
// in this workflow is identified that way, so the pipeline route is safe even
// when the prompt never says "voidr".
function namesATestPlanId(prompt) {
  const text = String(prompt || '').toLowerCase()
  return /\btest\s*plans?\b[\s\S]{0,160}\b[a-f0-9]{24}\b/.test(text)
}

function isGenericTestCreationPrompt(prompt) {
  const text = String(prompt || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
  // `test plan` is the platform's own vocabulary, so a Portuguese sentence
  // asking to automate one is a Voidr request even without the word "voidr" —
  // and that phrasing used to match nothing, leaving the model to pick a skill
  // by description alone.
  return /\b(?:criar?|crie|desenvolver?|implementar?|escrever?|escreva|gerar?|gere|montar?|monte|automatizar?)\b[\s\S]{0,60}\b(?:testes?|test\s*plans?|planos?\s+de\s+testes?)\b/.test(
    text
  )
}
