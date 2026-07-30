import { isDevTestFlowPrompt } from './session-state.mjs'

const voidrTestingIntent =
  /\b(?:desenvolver|criar|implementar|automatizar|planejar|publicar|subir|executar|rodar)\b[\s\S]{0,80}\b(?:testes?|test plans?|planos? de testes?)\b[\s\S]{0,80}\bvoidr\b|\bvoidr\b[\s\S]{0,80}\b(?:desenvolver|criar|implementar|automatizar|planejar|publicar|subir|executar|rodar)\b[\s\S]{0,80}\b(?:testes?|test plans?|planos? de testes?)\b/i

const explicitVoidrSkill = /\/(?:copilot\s+)?voidr-[a-z-]+/i

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
