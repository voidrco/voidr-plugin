import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { apply, inject } from '../adapters/dsh/index.mjs'
import { loadDshPluginSkills } from '../adapters/dsh/plugin-skills.mjs'
import { AGENT_OWNED_AUTHORING_TOOLS } from '../core/policies/agent-owned-authoring.mjs'
import { interactiveTestDevelopmentPrompt } from '../core/workflow/interactive-test-development.mjs'
import { loadPolicy } from '../scripts/lib/policy.mjs'
import { DSH_VALIDATION_DELIVERY } from '../core/workflow/validation-delivery.mjs'
import { qualifyDshVoidrTools } from '../adapters/dsh/skill-parity.mjs'

const unqualifiedVoidrTool =
  /(?<!mcp__voidr__)\b(?!playwright_analyze_frames_vision\b)(?:agent_jobs|applications|assistant_context|assistant_workspace|coverage|defects|echo|executions|failure_analysis|failure_reports|file_embeddings|git_connector|issue_tracker|playwright|recording|sessions|system_batch|test_plan_generation|test_plans)_[a-z0-9_]*[a-z0-9]\b/g

test('DSH uses exact MCP namespaces while preserving native tools', () => {
  const skills = loadDshPluginSkills()
  const workspaceTools = [
    'assistant_workspace_status',
    'assistant_workspace_bind_test_plan',
    'assistant_workspace_prepare',
    'assistant_workspace_context_refresh',
    'assistant_workspace_build',
    'assistant_workspace_inspect',
    'assistant_workspace_sync',
    'assistant_workspace_publish',
    'assistant_workspace_deploy_validation',
    'assistant_workspace_run_validation',
    'assistant_workspace_validation_status',
    'assistant_workspace_deploy_latest'
  ]
  const combined = skills.map(skill => skill.content).join('\n')

  for (const tool of workspaceTools) {
    assert.equal(qualifyDshVoidrTools(tool), `mcp__voidr__${tool}`, tool)
  }
  assert.match(combined, /\bmcp__voidr__assistant_workspace_status\b/)
  assert.match(combined, /\bmcp__voidr__assistant_workspace_prepare\b/)
  assert.doesNotMatch(combined, unqualifiedVoidrTool)
  assert.match(combined, /\bask_user_question\b/)
  assert.match(combined, /\brender_widget\b/)
  assert.match(combined, /\bplaywright_analyze_frames_vision\b/)
  assert.doesNotMatch(combined, /mcp__voidr__ask_user_question|mcp__voidr__render_widget/)

  const once = qualifyDshVoidrTools('assistant_workspace_status ask_user_question playwright_analyze_frames_vision')
  assert.equal(qualifyDshVoidrTools(once), once)
  assert.equal(once, 'mcp__voidr__assistant_workspace_status ask_user_question playwright_analyze_frames_vision')
})

test('DSH proactively offers delivery at the attempt limit or user stop across every entry point', () => {
  const skills = Object.fromEntries(loadDshPluginSkills().map(skill => [skill.name, skill.content]))
  for (const content of [skills['voidr-generate'], skills['voidr-execute'], interactiveTestDevelopmentPrompt()]) {
    const expectedDelivery = content === interactiveTestDevelopmentPrompt()
      ? DSH_VALIDATION_DELIVERY
      : qualifyDshVoidrTools(DSH_VALIDATION_DELIVERY)
    assert.ok(content.includes(expectedDelivery))
    for (const text of ['at most three runs', 'including resumed turns',
      'In that same turn', 'automate-promote', 'automate-promote-live',
      'If the user already declined extra attempts', 'NOT_VALIDATED',
      'unvalidatedApproval', 'budget_exhausted', 'user_stopped',
      'Never reuse a previous version', 'Without informed approval']) assert.ok(content.includes(text), text)
    assert.doesNotMatch(content, /No test verdict means no code publication|Do not offer LIVE from it|no executed tests is not eligible|canceled runs or no test verdict are not/)
  }
  for (const text of ['Ao encerrar as tentativas', 'NOT_VALIDATED', 'unvalidatedApproval',
    'Nunca invente nem altere o veredito', 'não ofereça outra nem execute novamente',
    'Não espere a pessoa pedir', 'reason: "user_stopped"', 'Nunca reutilize o ID']) {
    assert.ok(skills['voidr-automate'].includes(text), text)
  }
  assert.doesNotMatch(skills['voidr-automate'], /sem veredito não permite publicação/)
  assert.doesNotMatch(skills['voidr-execute'], /produced a PASSED or diagnosed FAILED validation verdict, only/)
})

test('DSH reports automatic plan activation only after latest publication', () => {
  const skills = Object.fromEntries(loadDshPluginSkills().map(skill => [skill.name, skill.content]))
  for (const content of [skills['voidr-generate'], skills['voidr-execute'], interactiveTestDevelopmentPrompt()]) {
    for (const text of ['at least one automated test', 'DRAFT', 'ACTIVE', 'ARCHIVED',
      'planStatusChanged', 'alreadyPublished', 'not a LIVE case tag or a passing verdict',
      'without rebuilding or uploading again', 'never report ACTIVE without confirmation']) {
      assert.ok(content.includes(text), text)
    }
  }
  for (const text of ['DRAFT', 'ACTIVE', 'ARCHIVED', 'alreadyPublished', 'planStatusChanged',
    'Build, upload de validação e SHADOW não ativam']) {
    assert.ok(skills['voidr-automate'].includes(text), text)
  }
})

test('unvalidated delivery adaptation does not relax the original plugin host rules', () => {
  const execute = readFileSync(new URL('../skills/voidr-execute/SKILL.md', import.meta.url), 'utf8')
  assert.match(execute, /Do not offer LIVE from it/)
  assert.doesNotMatch(execute, /unvalidatedApproval/)
})

test('custom question answers remain authoritative user instructions', () => {
  const prompt = interactiveTestDevelopmentPrompt()

  assert.match(prompt, /custom value is a direct user instruction/)
  assert.match(prompt, /valid when selected is empty/)
  assert.match(prompt, /changes or stops the task/)
  assert.match(prompt, /custom conflicts with selected options, custom wins/)
  assert.match(prompt, /authorize an unrelated write/)
})

test('composer and form directives outrank assistant hypotheses without rewriting runtime evidence', () => {
  const skills = Object.fromEntries(loadDshPluginSkills().map(skill => [skill.name, skill.content]))
  const prompt = interactiveTestDevelopmentPrompt()

  for (const text of [
    'chat composer or as an ask_user_question answer',
    'latest explicit user statement defines the intended product contract',
    'Runtime evidence defines what happened in an execution',
    'exact expected-versus-observed mismatch',
    'cannot declare that an execution passed'
  ]) assert.ok(prompt.includes(text), text)

  for (const name of ['voidr-automate', 'voidr-generate', 'voidr-execute', 'voidr-failure-analysis']) {
    assert.match(skills[name], /Explicit composer instructions and custom question answers/)
    assert.match(skills[name], /Runtime evidence defines what happened/)
  }

  assert.match(skills['voidr-automate'], /não invalida informações ou diretivas explícitas/)
  assert.match(skills['voidr-automate'], /sem\s+reescrever o que a pessoa declarou que deveria ocorrer/)
  assert.match(skills['voidr-generate'], /latest directive and\s+approved AAA define the intended behavior/)
  assert.doesNotMatch(skills['voidr-generate'], /code and observed runtime behavior\s+are authoritative/)
})

test('DSH registers authoring skills and canonical analysis/context/generate/execute', () => {
  const skills = loadDshPluginSkills()
  assert.deepEqual(
    skills.map(skill => skill.name),
    ['voidr-automate', 'voidr-context', 'voidr-execute', 'voidr-failure-analysis', 'voidr-generate', 'voidr-journeys', 'voidr-spec']
  )
  assert.equal(inject.includes('skills'), true)
  for (const skill of skills) {
    assert.equal(skill.provider, 'voidr-plugin')
    assert.equal(skill.content.length > 300, true)
  }
})

test('DSH failure analysis stays specialized and hands explicit corrections to remote authoring', () => {
  const analysis = loadDshPluginSkills().find(skill => skill.name === 'voidr-failure-analysis').content
  for (const text of [
    'organization Service Account',
    'execution_analysis_viewer',
    'playwright_analyze_frames_vision',
    'analyzing: true',
    're-emit the SAME widget id',
    'multiple executions',
    'evidence-only fallback',
    'This skill diagnoses only',
    'load voidr-automate, voidr-generate and voidr-execute',
    'Correction validation runs only on Voidr infrastructure',
    'Never run Playwright in the DSH pod'
  ]) assert.ok(analysis.includes(text), text)
  assert.doesNotMatch(analysis, /Execute `\/copilot voidr-setup`/)
  assert.doesNotMatch(analysis, /GitHub Copilot CLI|Claude Code/)
})

test('DSH denies every delegated authoring tool before execution', async () => {
  const handlers = new Map()
  const registeredSkills = []
  apply({
    skills: { register: skill => registeredSkills.push(skill) },
    systemPrompt: { section: () => undefined, variable: () => undefined },
    commands: { register: () => undefined },
    tools: {},
    on: (event, handler) => handlers.set(event, handler)
  })

  assert.equal(registeredSkills.length, 7)
  const preExecute = handlers.get('tools/pre-execute')
  assert.equal(typeof preExecute, 'function')

  for (const [tool, skill] of Object.entries(AGENT_OWNED_AUTHORING_TOOLS)) {
    const decision = await preExecute(
      { name: `mcp__voidr__${tool}`, args: {} },
      async () => ({ kind: 'allow' })
    )
    assert.equal(decision.kind, 'deny', tool)
    assert.match(decision.reason, new RegExp(skill), tool)
  }

  const allowed = await preExecute(
    { name: 'mcp__voidr__test_plans_get_test_plan', args: {} },
    async () => ({ kind: 'allow' })
  )
  assert.deepEqual(allowed, { kind: 'allow' })
  for (const command of ['npx voidr login', 'npx --no-install voidr link --yes',
    'node node_modules/@voidrco/playwright/cli/voidr.js env pull', 'voidr scaffold']) {
    const denied = await preExecute({ name: 'bash', args: { command } }, async () => ({ kind: 'allow' }))
    assert.equal(denied.kind, 'deny', command)
    assert.match(denied.reason, /Service Account/)
    assert.match(denied.reason, /assistant_workspace_prepare/)
  }
  assert.deepEqual(await preExecute({ name: 'bash', args: { command: 'rg "voidr login" README.md' } },
    async () => ({ kind: 'allow' })), { kind: 'allow' })
})

test('shared policy blocks the same authoring shortcuts on every plugin host', () => {
  const policy = loadPolicy()
  for (const tool of Object.keys(AGENT_OWNED_AUTHORING_TOOLS)) {
    assert.equal(policy.forbiddenTools.includes(tool), true, tool)
    assert.equal(policy.safeRemoteTools.includes(tool), false, tool)
  }
})

test('authoring skills route persistence through deterministic Service tools', () => {
  const byName = Object.fromEntries(loadDshPluginSkills().map(skill => [skill.name, skill]))
  assert.match(byName['voidr-spec'].content, /test_plans_update_module_spec/)
  assert.match(byName['voidr-journeys'].content, /test_plans_create_case/)
  assert.match(byName['voidr-journeys'].content, /test_plans_update_case/)
  assert.match(byName['voidr-automate'].content, /assistant_workspace_deploy_validation/)
  assert.match(byName['voidr-automate'].content, /assistant_workspace_run_validation/)
  for (const text of [
    'applications_get_environment_secrets',
    'applications_add_environment_secret',
    'automate-environment-credentials-{environmentSlug}'
  ]) assert.ok(byName['voidr-automate'].content.includes(text), text)
  assert.match(byName['voidr-automate'].content, /Salvar credenciais e\s+continuar/)
  assert.match(byName['voidr-automate'].content, /Form.*genérico/)
  assert.match(byName['voidr-automate'].content, /USUARIO_EMAIL[\s\S]*type: "text"/)
  assert.match(byName['voidr-automate'].content, /USUARIO_SENHA[\s\S]*type: "password"/)
  assert.match(byName['voidr-automate'].content, /já forneceu os valores[\s\S]*sem perguntar novamente/)
  assert.match(byName['voidr-automate'].content, /Só prossiga[\s\S]*todas as chaves exigidas/)
  assert.match(byName['voidr-automate'].content, /não execute a validação/)

  const prompt = readFileSync(
    new URL('../core/workflow/interactive-test-development.mjs', import.meta.url),
    'utf8'
  )
  for (const skill of Object.keys(byName)) assert.match(prompt, new RegExp(skill))
})

test('final Git delivery targets the default branch without changing isolated generation or LIVE promotion', () => {
  const skills = Object.fromEntries(loadDshPluginSkills().map(skill => [skill.name, skill.content]))
  assert.match(skills['voidr-automate'], /etapa final.*branch principal[\s\S]*resolvida pela ferramenta/)
  assert.match(skills['voidr-automate'], /A geração continua no workspace e na branch local isolados/)
  assert.match(skills['voidr-automate'], /nunca force o push/)
  assert.match(skills['voidr-execute'], /default branch as the final delivery step/)
  assert.match(skills['voidr-execute'], /never force push or silently fall back/)
  const prompt = interactiveTestDevelopmentPrompt({ hint: { surface: 'automate' } })
  assert.match(prompt, /At final Git delivery/)
  assert.match(prompt, /Keep generation isolated on the local session branch/)
  assert.match(prompt, /Promotion and Git publication are separate operations/)
  for (const content of [skills['voidr-execute'], prompt]) {
    assert.doesNotMatch(content, /pushes only the session branch|push the session branch\./)
  }
})

test('each DSH authoring skill owns an interactive intake and write gate', () => {
  const byName = Object.fromEntries(loadDshPluginSkills().map(skill => [skill.name, skill]))

  for (const skill of ['voidr-spec', 'voidr-journeys', 'voidr-automate'].map(name => byName[name])) {
    assert.match(skill.content, /ask_user_question/)
    assert.match(skill.content, /IDs?\s+estáve(?:l|is)/)
    assert.match(skill.content, /não repita/i)
  }

  for (const id of ['spec-destination', 'spec-source', 'spec-scope', 'spec-focus', 'spec-approve']) {
    assert.match(byName['voidr-spec'].content, new RegExp(id))
  }
  for (const id of [
    'journeys-target',
    'journeys-destination',
    'journeys-source',
    'journeys-coverage',
    'journeys-volume',
    'journeys-approve'
  ]) {
    assert.match(byName['voidr-journeys'].content, new RegExp(id))
  }
  for (const id of [
    'automate-cases',
    'automate-scope',
    'automate-environment',
    'automate-approve-edit',
    'automate-promote',
    'automate-promote-live',
    'automate-publish'
  ]) {
    assert.match(byName['voidr-automate'].content, new RegExp(id))
  }

  const prompt = interactiveTestDevelopmentPrompt()
  assert.match(prompt, /mandatory interactive intake/)
  assert.match(prompt, /ask_user_question/)
})

test('automate separates code publication, case tags and Git delivery', () => {
  const automate = loadDshPluginSkills().find(skill => skill.name === 'voidr-automate').content
  for (const text of ['alreadyPublished: true', 'caseTagsChanged: false',
    'test_plans_get_test_plan', 'canWrite: true', 'test_plans_update_test_case_tag',
    'automate-promote-live', 'current_tag']) assert.ok(automate.includes(text), text)
  assert.match(automate, /não as tags dos casos/)
  assert.match(automate, /Nunca anuncie LIVE sem essa leitura/)
  assert.match(automate, /Se a pessoa recusar, preserve as tags/)
  assert.match(automate, /não repita o deploy nem reconstrua o candidato para corrigir tags/)
  assert.match(automate, /não avance para a promoção de tags/)
})

test('DSH cannot finish after publishing while implemented failed cases remain silently in DEV', () => {
  const skills = Object.fromEntries(loadDshPluginSkills().map(skill => [skill.name, skill.content]))
  const entryPoints = [skills['voidr-generate'], skills['voidr-execute'],
    interactiveTestDevelopmentPrompt()]

  for (const content of entryPoints) {
    for (const required of [
      'implemented case', 'FAILED', 'NOT_VALIDATED', 'automate-promote-live',
      'promote all implemented cases', 'promote only PASSED cases', 'keep every current tag'
    ]) assert.ok(content.toLowerCase().includes(required.toLowerCase()), required)
    assert.match(content, /before (?:it can emit a final delivery|final delivery)|antes de encerrar a entrega/)
    assert.match(content, /generic approval to publish code does not approve LIVE|Aprovação para publicar código[\s\S]*não aprova[\s\S]*LIVE/)
    assert.match(content, /Never silently promote only PASSED cases|Nunca promova silenciosamente apenas os aprovados/)
    assert.match(content, /failed cases as ineligible/)
  }

  const automate = skills['voidr-automate']
  for (const required of [
    'todos os casos implementados', '`FAILED` e `NOT_VALIDATED`', 'automate-promote-live',
    'promover todos os casos implementados', 'promover somente os `PASSED`',
    'manter todas as tags atuais', 'antes de encerrar a entrega'
  ]) assert.ok(automate.includes(required), required)
  assert.match(automate, /Aprovação para publicar código[\s\S]*não aprova[\s\S]*LIVE/)
  assert.match(automate, /Nunca promova silenciosamente apenas os aprovados/)
  assert.match(automate, /reprovados são[\s\S]*“não elegíveis”/)
})

test('DSH uses product widgets for recording and file evidence', () => {
  const prompt = interactiveTestDevelopmentPrompt()
  assert.match(prompt, /session_coverage_picker/)
  assert.match(prompt, /document_input/)
  assert.match(prompt, /Do not ask the user to describe a browser flow in a text field/)

  const byName = Object.fromEntries(loadDshPluginSkills().map(skill => [skill.name, skill]))
  assert.match(byName['voidr-spec'].content, /session_coverage_picker/)
  assert.match(byName['voidr-journeys'].content, /session_coverage_picker/)
  assert.match(byName['voidr-automate'].content, /document_input/)
})

test('DSH persists approved environment URLs before offering new recording', () => {
  const prompt = interactiveTestDevelopmentPrompt()
  for (const required of [
    'applications_list_environments', 'applications_create_environment',
    'applications_update_environment', 'applicationId, name and applicationUrl',
    'applicationId, envSlug and applicationUrl', 'explicitly confirm the persistent change',
    'passing targetUrl alone does not register anything', 'read environments before retrying',
    'Existing-session selection does not require creating a new environment',
    'Missing environment setup is the only prerequisite exception',
  ]) assert.ok(prompt.includes(required), required)
  assert.doesNotMatch(prompt, /selected “Gravar nova sessão”, render/)
})

test('DSH offers product registration before resolving a new Test Plan destination', () => {
  for (const surface of ['home', 'journeys', 'spec', 'journey-overview']) {
    const prompt = interactiveTestDevelopmentPrompt({ hint: { surface } })
    for (const required of [
      'app_target_picker', 'includeNewOption: true', 'even when only one application exists',
      'explicitly selected application', '__new_app__', 'app_registration',
      'Cadastrar nova aplicação', 'no applications exist', 'do not list existing applications first',
      'stop and wait for the widget submission', 'action: "app_registered"',
      'validate that application with Voidr read tools', 'If cancelled or not detected',
      'never an applicationId', 'do not register the application through an API'
    ]) assert.ok(prompt.includes(required), `${surface}: ${required}`)
  }
  for (const skill of loadDshPluginSkills().filter(skill => ['voidr-spec', 'voidr-journeys'].includes(skill.name))) {
    for (const required of ['app_target_picker', 'includeNewOption: true', 'app_registration', 'app_registered']) {
      assert.ok(skill.content.includes(required), `${skill.name}: ${required}`)
    }
  }
})

test('automate follows server-selected repository access rather than assuming a customer connector', () => {
  const automate = loadDshPluginSkills().find(skill => skill.name === 'voidr-automate').content
  for (const value of ['repositoryAccess.mode', 'voidr_managed', 'organization_connector', 'unsupported', 'voidrco']) {
    assert.ok(automate.includes(value), value)
  }
  assert.match(automate, /Não exige conector Git do cliente/)
  assert.match(automate, /Nunca use o\s+acesso interno da Voidr como alternativa/)
  assert.match(automate, /não garante que a credencial esteja funcionando/)
})

test('spec and journey intake always preserve the three evidence paths', () => {
  const byName = Object.fromEntries(loadDshPluginSkills().map(skill => [skill.name, skill]))

  for (const name of ['voidr-spec', 'voidr-journeys']) {
    assert.match(byName[name].content, /Gravar nova sessão/)
    assert.match(byName[name].content, /Usar sessões gravadas/)
    assert.match(byName[name].content, /Enviar documentação/)
    assert.match(byName[name].content, /session_coverage_picker/)
    assert.match(byName[name].content, /document_input/)
  }

  assert.match(
    interactiveTestDevelopmentPrompt(),
    /record a new session, use recorded sessions, and send documentation/
  )
})

test('the backend preloads the selected surface skill into the system prompt', () => {
  let section
  const variables = new Map()
  apply({
    skills: { register: () => undefined },
    systemPrompt: {
      section: value => { section = value },
      variable: (name, provider) => variables.set(name, provider)
    },
    commands: { register: () => undefined },
    tools: {},
    on: () => undefined
  })
  assert.equal(section.text, '{{voidr_interactive_test_development}}')
  for (const [surface, skillName] of Object.entries({
    spec: 'voidr-spec',
    journeys: 'voidr-journeys',
    automate: 'voidr-automate',
    monitor: 'voidr-failure-analysis'
  })) {
    const text = variables.get('voidr_interactive_test_development')({ agent: { session: { events: [{ type: 'voidr/project-context-hint', data: { surface } }] } } })
    assert.match(text, new RegExp(`Active surface skill: ${skillName}`))
    assert.ok(text.includes(loadDshPluginSkills().find(skill => skill.name === skillName).content))
  }
  const home = interactiveTestDevelopmentPrompt({ hint: { surface: 'home' } })
  assert.match(home, /generalist/)
  assert.match(home, /generate a test plan, write a specification, create journeys and scenarios, automate tests, or analyze failures/)
  assert.match(home, /Load voidr-failure-analysis/)
  const monitor = interactiveTestDevelopmentPrompt({ hint: { surface: 'monitor' } })
  assert.match(monitor, /Diagnose with read-only Voidr tools first/)
  const overview = variables.get('voidr_interactive_test_development')({ agent: { session: { events: [{ type: 'voidr/project-context-hint', data: { surface: 'journey-overview', testPlanId: 'plan-1' } }] } } })
  assert.match(overview, /general Assistant for a Journeys page/)
  assert.match(overview, /write or revise a spec, create a journey, create test scenarios, or automate approved tests/)
  assert.match(overview, /Do not select the first module or case automatically/)
  assert.doesNotMatch(overview, /Active surface skill:/)
})

test('DSH renders surface prompts without interpreting literal template examples', {
  skip: !process.env.DSH_SYSTEM_PROMPT_MODULE
}, async () => {
  const { renderPrompt } = await import(process.env.DSH_SYSTEM_PROMPT_MODULE)
  let section
  const providers = new Map()
  apply({
    skills: { register: () => undefined },
    systemPrompt: {
      section: value => { section = value },
      variable: (name, provider) => providers.set(name, provider)
    },
    commands: { register: () => undefined },
    tools: {},
    on: () => undefined
  })

  for (const surface of ['home', 'monitor', 'journey-overview', 'spec', 'journeys', 'automate']) {
    const hint = { surface, journeyName: 'Login {{unknown}} {{env.LOGIN_PASSWORD}} {{{nested}}}' }
    const context = { agent: { session: { events: [{ type: 'voidr/project-context-hint', data: hint }] } } }
    const variables = Object.fromEntries([...providers].map(([name, provider]) => [name, provider(context)]))
    const rendered = renderPrompt({ sections: [section], contexts: [], tools: [], variables })
    assert.equal(rendered, variables.voidr_interactive_test_development)
    assert.ok(rendered.includes(hint.journeyName))
    assert.throws(() => renderPrompt({
      sections: [{ ...section, text: rendered }], contexts: [], tools: [], variables: {}
    }), /(?:malformed|unknown) prompt variable/)
    if (surface === 'spec') {
      assert.ok(rendered.includes('{{env.NOME_DA_VARIAVEL}}'))
      for (const option of ['Gravar nova sessão', 'Usar sessões gravadas', 'Enviar documentação']) {
        assert.ok(rendered.includes(option))
      }
    }
  }
})
