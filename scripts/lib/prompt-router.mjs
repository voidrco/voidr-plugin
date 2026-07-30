import { isDevTestFlowPrompt } from './session-state.mjs'

const voidrTestingIntent =
  /\b(?:desenvolver|criar|implementar|automatizar|planejar|publicar|subir|executar|rodar)\b[\s\S]{0,80}\b(?:testes?|test plans?|planos? de testes?)\b[\s\S]{0,80}\bvoidr\b|\bvoidr\b[\s\S]{0,80}\b(?:desenvolver|criar|implementar|automatizar|planejar|publicar|subir|executar|rodar)\b[\s\S]{0,80}\b(?:testes?|test plans?|planos? de testes?)\b/i

const explicitVoidrSkill = /\/(?:copilot\s+)?voidr-[a-z-]+/i

function isDeployTestsPrompt(prompt) {
  const text = String(prompt || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
  return /\b(?:deploy|publicar?|subir|implantar?)\b[\s\S]{0,50}\btestes?\b|\btestes?\b[\s\S]{0,30}\b(?:deploy|deployados?)\b|\bexecutar?\b[\s\S]{0,40}\btestes?\b[\s\S]{0,40}\bplataforma\b/.test(
    text
  )
}

export function routeVoidrPrompt(input) {
  const prompt = String(input?.prompt || '')
  const transformedPrompt = String(input?.transformedPrompt || prompt)

  if (!prompt || explicitVoidrSkill.test(prompt)) return {}

  if (isDevTestFlowPrompt(prompt)) {
    return {
      modifiedTransformedPrompt: `${transformedPrompt}

Use the /voidr-test skill for this request. Load that skill before inspecting
files or calling any tool. It is the developer-first flow: infer the feature
from the current Git branch and diff, confirm everything on one ask_user card,
show plain-language test scenarios, and wait for the typed “Criar testes”
approval. Never expose platform vocabulary such as Test Plan, scaffold,
module, suite, or case slug to the user.`
    }
  }

  if (isDeployTestsPrompt(prompt)) {
    return {
      modifiedTransformedPrompt: `${transformedPrompt}

Use the /voidr-deploy-run skill for this request and follow its gates in
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
  }

  if (!voidrTestingIntent.test(prompt)) return {}

  return {
    modifiedTransformedPrompt: `${transformedPrompt}

Use the /voidr-develop-tests skill for this request. Load that skill before
inspecting files or calling any tool. Its first-turn Test Plan mode question,
MCP application discovery, and repository-ordering rules are mandatory.
Render every workflow choice (plan mode, application, environment, Test Plan,
repository, planning inputs) with the native ask_user selectable options when
available; free text is only a fallback. Only the two runtime confirmations
must be typed in chat.`
  }
}
