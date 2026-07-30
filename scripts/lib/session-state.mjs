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

    const workflowStarted = isVoidrTestingPrompt(prompt)
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
      planWriteApproved: isExplicitTestPlanApproval(prompt),
      planWriteApprovedAt: isExplicitTestPlanApproval(prompt)
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

function isNewPlanChoice(prompt) {
  return /\bcriar\s+(?:um\s+)?novo\s+test plan\b/i.test(prompt)
}

function isExistingPlanChoice(prompt) {
  return /\b(?:usar|trabalhar\s+em)\s+(?:um\s+)?test plan\s+existente\b/i.test(
    prompt
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
