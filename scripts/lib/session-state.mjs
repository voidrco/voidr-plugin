import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'

export function sessionStatePath(payload) {
  const dataRoot =
    process.env.COPILOT_PLUGIN_DATA ||
    process.env.VOIDR_PLUGIN_DATA ||
    resolve(tmpdir(), 'voidr-copilot-plugin-data')
  const sessionId = String(
    payload?.sessionId || payload?.session_id || 'unknown-session'
  )
  const safeId = createHash('sha256').update(sessionId).digest('hex')
  return resolve(dataRoot, 'sessions', `${safeId}.json`)
}

export function readSessionState(payload) {
  const path = sessionStatePath(payload)
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return {}
  }
}

export function updateSessionState(payload, update) {
  const path = sessionStatePath(payload)
  const current = readSessionState(payload)
  const next =
    typeof update === 'function' ? update(current) : { ...current, ...update }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(next, null, 2), 'utf8')
  return next
}

export function recordUserPromptState(payload) {
  const prompt = extractUserAuthoredPrompt(payload?.prompt)
  const timestamp = normalizeTimestamp(payload?.timestamp)
  return updateSessionState(payload, current => {
    if (
      current.lastPromptAt &&
      timestamp &&
      timestamp < current.lastPromptAt
    ) {
      return current
    }

    const devFlowStarted = isDevTestFlowPrompt(prompt)
    const planChoiceStated =
      isNewPlanChoice(prompt) || isExistingPlanChoice(prompt)
    const workflowStarted =
      isVoidrTestingPrompt(prompt) ||
      devFlowStarted ||
      (planChoiceStated && current.workflowActive !== true)
    const connectStarted = isVoidrConnectPrompt(prompt)
    const smokeRemediationAuthorized = isSmokeRemediationPrompt(prompt)
    const planningInputsConfirmed =
      isPlanningInputsConfirmation(prompt)
    const selectedEnvironmentSlug =
      current.selectedEnvironmentSlug ||
      (current.environmentSelectionRequestedAt
        ? extractEnvironmentSelection(prompt)
        : null)
    let planMode = workflowStarted ? null : current.planMode || null
    if (devFlowStarted) planMode = 'auto'
    if (isNewPlanChoice(prompt)) planMode = 'new'
    if (isExistingPlanChoice(prompt)) planMode = 'existing'
    const promptTestPlanId = extractExplicitTestPlanId(prompt)
    const selectedTestPlanId =
      planMode === 'new'
        ? null
        : promptTestPlanId ||
          (workflowStarted ? null : current.selectedTestPlanId || null)
    const resetPlanningContext = workflowStarted || isNewPlanChoice(prompt)

    return {
      ...current,
      requiredExecutionIds: [],
      workflowActive: current.workflowActive === true || workflowStarted,
      connectWorkflowActive: connectStarted
        ? true
        : workflowStarted
          ? false
          : current.connectWorkflowActive === true,
      connectFirstToolRequired: connectStarted
        ? true
        : current.connectFirstToolRequired === true,
      selectedEnvironmentSlug: workflowStarted
        ? null
        : selectedEnvironmentSlug,
      selectedEnvironmentAt: workflowStarted
        ? null
        : selectedEnvironmentSlug && !current.selectedEnvironmentSlug
          ? timestamp || Date.now()
          : current.selectedEnvironmentAt || null,
      environmentSelectionRequestedAt: workflowStarted
        ? null
        : current.environmentSelectionRequestedAt || null,
      environmentApplicationId: workflowStarted
        ? null
        : current.environmentApplicationId || null,
      smokeAttemptedAt:
        workflowStarted || smokeRemediationAuthorized
          ? null
          : current.smokeAttemptedAt || null,
      planMode,
      selectedTestPlanId,
      selectedTestPlanAt: promptTestPlanId
        ? timestamp || Date.now()
        : selectedTestPlanId
          ? current.selectedTestPlanAt || null
          : null,
      planContextConfirmed: resetPlanningContext
        ? false
        : planningInputsConfirmed
          ? true
          : current.planContextConfirmed === true,
      planContextConfirmedAt: resetPlanningContext
        ? null
        : planningInputsConfirmed
          ? timestamp || Date.now()
          : current.planContextConfirmedAt || null,
      planWriteApproved:
        isExplicitTestPlanApproval(prompt) ||
        (planMode === 'auto' && isDevTestsApproval(prompt)),
      planWriteApprovedAt:
        isExplicitTestPlanApproval(prompt) ||
        (planMode === 'auto' && isDevTestsApproval(prompt))
          ? timestamp || Date.now()
          : null,
      lastPromptAt: timestamp || Date.now()
    }
  })
}

export function extractUserAuthoredPrompt(value) {
  return String(value || '')
    .replace(/<skill-context\b[^>]*>[\s\S]*?<\/skill-context>/gi, '')
    .replace(/<system_reminder\b[^>]*>[\s\S]*?<\/system_reminder>/gi, '')
    .replace(/<current_datetime\b[^>]*>[\s\S]*?<\/current_datetime>/gi, '')
    .trim()
}

export function isExplicitTestPlanApproval(prompt) {
  const text = normalizeText(prompt)
  if (/\bnao\s+(?:aprovo|aprovado|aprovar)\b/.test(text)) return false
  const approval = /\b(?:aprovo|aprovado|aprovar)\b/
  const plan = /\b(?:draft|rascunho|test plan|plano de testes?)\b/
  return (
    approval.test(text) &&
    plan.test(text) &&
    Math.abs(firstIndex(text, approval) - firstIndex(text, plan)) <= 120
  )
}

export function isPlanningInputsConfirmation(prompt) {
  return /\bconfirmar\s+insumos\s+do\s+planejamento\b/i.test(prompt)
}

// Single approval gate of the dev-first /voidr-test flow. It must be the
// whole user message so ordinary sentences never count as approval.
export function isDevTestsApproval(prompt) {
  const text = normalizeText(extractUserAuthoredPrompt(prompt)).trim()
  return /^criar (?:os )?testes[.!]?$/.test(text)
}

export function isDevTestFlowPrompt(prompt) {
  const text = normalizeText(prompt)
  if (/\/(?:copilot\s+)?voidr-test\b(?!-plan)/.test(text)) return true
  const create =
    /\b(?:criar?|crie|gerar?|gere|escrever?|escreva|fazer|faca|montar?|monte)\b/
  const tests = /\btestes?\b/
  const feature =
    /\b(?:feature|feat|funcionalidade|historia|story|branch|meu codigo|minha implementacao)\b/
  return (
    (create.test(text) && tests.test(text) && feature.test(text)) ||
    /\btestar\b[\s\S]{0,40}\b(?:minha|essa|esta|a)\s+(?:feature|feat|funcionalidade)\b/.test(
      text
    )
  )
}

export function extractEnvironmentSelection(prompt) {
  const value = normalizeText(prompt).trim()
  const structured = value.match(
    /[—–-]\s*([a-z0-9][a-z0-9._-]*)\s*[—–-]\s*https?:/
  )
  if (structured) return structured[1]

  const named = value.match(
    /\bambiente(?:\s+voidr)?(?:\s+selecionado)?\s*[:=-]?\s*([a-z0-9][a-z0-9._-]*)\b/
  )
  if (named && named[1] !== 'voidr') return named[1]

  if (/^[a-z0-9][a-z0-9._-]{0,79}$/.test(value)) return value
  return null
}

export function extractExplicitTestPlanId(prompt) {
  const value = String(prompt || '')
  const match = value.match(
    /\b(?:test\s*plan|plano\s+de\s+testes?)\s+(?:existente\s+)?(?:id\s*[:#=-]?\s*)?([a-f0-9]{24})\b/i
  )
  return match ? match[1].toLowerCase() : null
}

function isVoidrTestingPrompt(prompt) {
  const text = normalizeText(prompt)
  return (
    /\/(?:copilot\s+)?voidr-develop-tests\b/.test(text) ||
    (/\bvoidr\b/.test(text) &&
      /\b(?:desenvolver|criar|implementar|automatizar|planejar|publicar|subir|executar|rodar)\b/.test(
        text
      ) &&
      /\b(?:teste|testes|test plan|plano de testes)\b/.test(text))
  )
}

function isVoidrConnectPrompt(prompt) {
  return /\/(?:copilot\s+)?voidr-connect\b/i.test(prompt)
}

export function isNewPlanChoice(prompt) {
  const text = normalizeText(prompt)
  return /\bcriar\s+(?:um\s+)?novo\s+(?:test\s*plan|plano\s+de\s+testes?)\b/.test(
    text
  )
}

export function isExistingPlanChoice(prompt) {
  const text = normalizeText(prompt)
  const existingPlan = /\b(?:test\s*plan|plano\s+de\s+testes?)\s+existente\b/
  if (!existingPlan.test(text)) return false
  if (
    /\b(?:nao|nem|sem)\b[^.!?]{0,40}(?:test\s*plan|plano\s+de\s+testes?)\s+existente\b/.test(
      text
    )
  ) {
    return false
  }
  return /\b(?:usar|trabalhar\s+em|implementar|escolher|selecionar|continuar|de\s+um|em\s+um|num|no)\b[^.!?]{0,60}(?:test\s*plan|plano\s+de\s+testes?)\s+existente\b|^(?:num|no|em\s+um)?\s*(?:test\s*plan|plano\s+de\s+testes?)\s+existente\b/.test(
    text
  )
}

function isSmokeRemediationPrompt(prompt) {
  const text = normalizeText(prompt)
  return (
    /\b(?:corrij\w*|ajust\w*|investig\w*|diagnostic\w*|retent\w*|reexecut\w*|rod\w*\s+novamente)\b/.test(
      text
    ) &&
    /\b(?:smoke|teste|testes|falha|falhas|erro|erros)\b/.test(text)
  )
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}

function normalizeTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const parsed = Date.parse(String(value || ''))
  return Number.isFinite(parsed) ? parsed : null
}

function firstIndex(text, pattern) {
  const match = pattern.exec(text)
  return match ? match.index : Number.MAX_SAFE_INTEGER
}
