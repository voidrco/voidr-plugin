import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'

function stateDataRoot() {
  return (
    process.env.COPILOT_PLUGIN_DATA ||
    // Claude Code's per-plugin persistent directory, which survives the
    // plugin update that moves CLAUDE_PLUGIN_ROOT.
    process.env.CLAUDE_PLUGIN_DATA ||
    process.env.VOIDR_PLUGIN_DATA ||
    resolve(tmpdir(), 'voidr-copilot-plugin-data')
  )
}

// How each host spells an explicit skill invocation in the prompt text:
// Copilot uses "/copilot voidr-connect" or "/copilot:voidr-connect", Claude
// namespaces plugin skills as "/voidr:voidr-connect". A bare "/voidr-connect"
// works on both. Recognizing all of them keeps the router from re-injecting
// guidance the user already asked for by name.
export const SKILL_INVOCATION_PREFIX = '\\/(?:copilot\\s+|copilot:|voidr:)?'

export function sessionStatePath(payload) {
  const sessionId = String(
    payload?.sessionId || payload?.session_id || 'unknown-session'
  )
  const safeId = createHash('sha256').update(sessionId).digest('hex')
  return resolve(stateDataRoot(), 'sessions', `${safeId}.json`)
}

export function latestPromptStatePath() {
  return resolve(stateDataRoot(), 'sessions', 'latest-prompt-state.json')
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

const PROMPT_GATE_KEYS = [
  'planWriteApproved',
  'planWriteApprovedAt',
  'planContextConfirmed',
  'planContextConfirmedAt',
  'selectedEnvironmentSlug',
  'selectedEnvironmentAt',
  'planMode',
  'devFlowActive',
  'workflowActive',
  'smokeRemediationAt'
]

export function readGateState(payload) {
  const session = readSessionState(payload)
  let prompt = {}
  try {
    prompt = JSON.parse(readFileSync(latestPromptStatePath(), 'utf8'))
  } catch {
    prompt = {}
  }
  const merged = { ...session }
  for (const key of PROMPT_GATE_KEYS) {
    if (merged[key] === undefined || merged[key] === null) {
      if (prompt[key] !== undefined) merged[key] = prompt[key]
    }
  }
  merged.promptHookAliveAt = Number.isFinite(prompt.lastPromptAt)
    ? prompt.lastPromptAt
    : Number.isFinite(session.lastPromptAt)
      ? session.lastPromptAt
      : null
  return merged
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
  const next = updateSessionState(payload, current => {
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
    // planMode is the plan route (auto/new/existing) and gets overwritten when
    // the developer picks an existing plan. Which skill is running is tracked
    // separately, so the dev-first flow keeps a single typed gate on every
    // route instead of falling back to the plan-first approval phrase.
    const devFlowActive = devFlowStarted
      ? true
      : isVoidrTestingPrompt(prompt)
        ? false
        : current.devFlowActive === true
    const devApprovalArmed = armsDevTestsApproval(prompt, {
      planMode,
      devFlowActive,
      // The prompt hook just wrote this state, so an absent planMode really
      // means "no dev-first evidence" and must not arm the approval.
      emptyStateCounts: false
    })
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
      // A new user turn clears the Stop-gate's consecutive-block counter.
      executionLinkBlocks: 0,
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
      smokeRemediationAt:
        workflowStarted || smokeRemediationAuthorized
          ? timestamp || Date.now()
          : current.smokeRemediationAt || null,
      planMode,
      devFlowActive,
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
        isExplicitTestPlanApproval(prompt) || devApprovalArmed,
      planWriteApprovedAt:
        isExplicitTestPlanApproval(prompt) || devApprovalArmed
          ? timestamp || Date.now()
          : null,
      lastPromptAt: timestamp || Date.now()
    }
  })
  try {
    writeFileSync(
      latestPromptStatePath(),
      JSON.stringify(next, null, 2),
      'utf8'
    )
  } catch {
    return next
  }
  return next
}

export function recordAskUserSelections(
  payload,
  { toolName, toolInput, toolResult }
) {
  if (!/ask.*question|ask_user/i.test(String(toolName || ''))) return null
  // Claude echoes the identical answers block on both the tool input and the
  // tool response, so the same answer arrives twice. Applying it twice is
  // idempotent, but deduplicating keeps the recorded set honest.
  const answers = dedupeAnswers([
    ...collectAskUserAnswers(toolResult),
    ...collectClaudeAskAnswers(toolInput),
    ...collectClaudeAskAnswers(toolResult)
  ])
  if (answers.length === 0) return null

  return updateSessionState(payload, current => {
    const next = { ...current }
    let changed = false
    for (const { header, text, typed } of answers) {
      if (typed) {
        if (isExplicitTestPlanApproval(text)) {
          next.planWriteApproved = true
          next.planWriteApprovedAt = Date.now()
          changed = true
        } else if (isPlanningInputsConfirmation(text)) {
          next.planContextConfirmed = true
          next.planContextConfirmedAt = Date.now()
          changed = true
        } else if (
          armsDevTestsApproval(text, {
            planMode: next.planMode,
            devFlowActive: next.devFlowActive === true,
            // This is the fallback for a dead prompt hook, where no routing
            // state was ever recorded, so an empty state is expected here.
            emptyStateCounts: true
          })
        ) {
          if (next.planMode !== 'existing') next.planMode = 'auto'
          next.devFlowActive = true
          next.workflowActive = true
          next.planWriteApproved = true
          next.planWriteApprovedAt = Date.now()
          changed = true
        }
      }
      if (isSmokeRemediationPrompt(text)) {
        next.smokeAttemptedAt = null
        next.smokeRemediationAt = Date.now()
        changed = true
      }
      if (isNewPlanChoice(text)) {
        next.planMode = 'new'
        next.workflowActive = true
        next.planContextConfirmed = false
        next.planContextConfirmedAt = null
        changed = true
      } else if (isExistingPlanChoice(text)) {
        next.planMode = 'existing'
        next.workflowActive = true
        changed = true
      }
      if (
        !next.selectedEnvironmentSlug &&
        Number.isFinite(next.environmentSelectionRequestedAt) &&
        /amb|env/i.test(String(header || ''))
      ) {
        const slug = extractEnvironmentSelection(text)
        if (slug) {
          next.selectedEnvironmentSlug = slug
          next.selectedEnvironmentAt = Date.now()
          changed = true
        }
      }
    }
    return changed ? next : current
  })
}

// Claude's AskUserQuestion carries the answers back as a flat
// {question: answer} map of strings, not Copilot's {selected, freeText} record.
//
// The approval gates turn on whether the user *typed* the text or clicked a
// prepared option — a clicked option must never count as authorship, which is
// why the skills are forbidden from offering an approval phrase as an option.
// Claude marks neither, so authorship is inferred from the labels that were
// offered: an answer matching none of them was written by the user.
//
// The labels are pooled across every question rather than matched per question
// on purpose. Keying them by question text would make the inference depend on
// `answers` using that exact key, and if the key ever differed every clicked
// option would read as typed — the one direction this must never fail in. An
// answer is only trusted as typed when the offered labels were actually seen
// and it is none of them; otherwise the gate stays shut and the user types the
// approval in chat, which is the primary path anyway.
function collectClaudeAskAnswers(container) {
  const source = parseMaybeJson(container)
  const answers = source?.answers
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
    return []
  }
  const questions = Array.isArray(source.questions) ? source.questions : null
  const offered = new Set(
    (questions || []).flatMap(question =>
      (Array.isArray(question?.options) ? question.options : [])
        .map(option => String(option?.label || '').trim())
        .filter(Boolean)
    )
  )
  const wasTyped = text => Boolean(questions) && !offered.has(text.trim())

  const collected = []
  for (const [header, value] of Object.entries(answers)) {
    if (typeof value !== 'string' || !value.trim()) continue
    collected.push({ header, text: value, typed: wasTyped(value) })
    // Notes come from a free-text field, so they are authored by definition.
    const notes = source.annotations?.[header]?.notes
    if (typeof notes === 'string' && notes.trim()) {
      collected.push({ header, text: notes, typed: true })
    }
  }
  return collected
}

function dedupeAnswers(answers) {
  const seen = new Set()
  return answers.filter(answer => {
    const key = `${answer.typed} ${answer.header} ${answer.text}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function parseMaybeJson(value) {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function collectAskUserAnswers(toolResult) {
  const parsed = parseAskUserPayload(toolResult)
  const record = parsed?.answers
  if (!record || typeof record !== 'object') return []
  const answers = []
  for (const [header, value] of Object.entries(record)) {
    const selected = Array.isArray(value?.selected) ? value.selected : []
    for (const text of selected) {
      if (typeof text === 'string' && text.trim()) {
        answers.push({ header, text, typed: false })
      }
    }
    if (typeof value?.freeText === 'string' && value.freeText.trim()) {
      answers.push({ header, text: value.freeText, typed: true })
    }
  }
  return answers
}

function parseAskUserPayload(result) {
  const candidates = []
  const visit = value => {
    if (value == null) return
    if (typeof value === 'string') {
      candidates.push(value)
      return
    }
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    if (typeof value === 'object') {
      if (value.answers && typeof value.answers === 'object') {
        candidates.push(value)
        return
      }
      if (typeof value.text === 'string') candidates.push(value.text)
      if (value.content) visit(value.content)
      if (value.result) visit(value.result)
      if (value.output) visit(value.output)
    }
  }
  visit(result)
  for (const candidate of candidates) {
    if (candidate && typeof candidate === 'object') return candidate
    try {
      const parsed = JSON.parse(candidate)
      if (parsed?.answers && typeof parsed.answers === 'object') return parsed
    } catch {
      continue
    }
  }
  return null
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

// Single approval gate of the dev-first /voidr-feature-test flow. It must be the
// whole user message so ordinary sentences never count as approval.
export function isDevTestsApproval(prompt) {
  const text = normalizeText(extractUserAuthoredPrompt(prompt)).trim()
  return /^criar (?:os )?testes[.!]?$/.test(text)
}

export function isDevTestFlowPrompt(prompt) {
  const text = normalizeText(prompt)
  if (
    skillInvocation('voidr-feature-test\\b').test(text) ||
    skillInvocation('voidr-test\\b(?!-plan)').test(text)
  ) {
    return true
  }
  const create =
    /\b(?:criar?|crie|gerar?|gere|escrever?|escreva|fazer|faca|montar?|monte)\b/
  const tests = /\btestes?\b/
  const feature =
    /\b(?:feature|feat|funcionalidade|historia|story|branch|meu codigo|minha implementacao)\b/
  if (
    /\b(?:create|write|generate|make|add)\b/.test(text) &&
    /\btests?\b/.test(text) &&
    /\b(?:my|this)\s+(?:feature|branch|code|implementation)\b|\bfeature\s+i\s+(?:just\s+)?(?:built|implemented|finished|shipped)\b/.test(
      text
    )
  ) {
    return true
  }
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
    skillInvocation('voidr-develop-tests\\b').test(text) ||
    (/\bvoidr\b/.test(text) &&
      /\b(?:desenvolver|criar|implementar|automatizar|planejar|publicar|subir|executar|rodar)\b/.test(
        text
      ) &&
      /\b(?:teste|testes|test plan|plano de testes)\b/.test(text))
  )
}

function isVoidrConnectPrompt(prompt) {
  return skillInvocation('voidr-connect\\b').test(prompt)
}

function skillInvocation(suffix) {
  return new RegExp(`${SKILL_INVOCATION_PREFIX}${suffix}`, 'i')
}

export function isNewPlanChoice(prompt) {
  const text = normalizeText(prompt)
  return /\bcriar\s+(?:um\s+)?novo\s+(?:test\s*plan|plano\s+de\s+testes?)\b/.test(
    text
  )
}

export function isExistingPlanChoice(prompt) {
  const text = normalizeText(prompt)
  if (/^(?:quero\s+)?usar\s+(?:um\s+)?(?:ja\s+)?existente[.!]?$/.test(text.trim())) {
    return true
  }
  const firstLine = String(text.split(/\r?\n/, 1)[0] || '').trim()
  if (
    /^(?:e|eh)?\s*(?:o\s+|um\s+)?(?:test\s*plan\s+|plano\s+(?:de\s+testes?\s+)?)?(?:ja\s+)?existente[.!]?$/.test(
      firstLine
    )
  ) {
    return true
  }
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

// One rule for the “Criar testes” gate, shared by the prompt hook and the
// ask_user fallback so the recognizer and the flow-awareness can never drift
// apart. The two callers differ only in what an empty state means.
function armsDevTestsApproval(text, { planMode, devFlowActive, emptyStateCounts }) {
  if (!isDevTestsApproval(text)) return false
  if (planMode === 'auto' || devFlowActive) return true
  return emptyStateCounts && !planMode
}

export function isSmokeRemediationPrompt(prompt) {
  const text = normalizeText(prompt)
  // Right after a smoke run the context is unambiguous, so an explicit
  // remediation, rerun, or investigation verb authorizes the work on its own.
  // "corrige e roda de novo" is the phrase the denial itself suggests and it
  // carries no noun.
  const remediationVerb =
    /\b(?:corri[gj]\w*|consert\w*|arrum\w*|investig\w*|diagnostic\w*|retent\w*|reexecut\w*|fix\w*|debug\w*|rerun)\b/.test(
      text
    ) ||
    /\b(?:rod\w*|execut\w*|test\w*|tent\w*)\s+(?:novamente|de novo|outra vez)\b/.test(
      text
    )
  if (remediationVerb) return true
  // Generic change verbs stay ambiguous, so they still need the subject.
  return (
    /\b(?:ajust\w*|mud\w*|alter\w*|troc\w*|melhor\w*|refator\w*)\b/.test(
      text
    ) &&
    /\b(?:smoke|teste|testes|tests?|falha|falhas|failures?|erro|erros|errors?|specs?)\b/.test(text)
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
