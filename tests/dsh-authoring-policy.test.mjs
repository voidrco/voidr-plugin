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
  /(?<!mcp__voidr__)\b(?:agent_jobs|applications|assistant_context|assistant_workspace|coverage|defects|echo|executions|failure_analysis|failure_reports|file_embeddings|git_connector|group_diagnosis|issue_tracker|playwright|recording|sessions|system|test_failures|test_plan_generation|test_plans)_[a-z0-9_]*[a-z0-9]\b/g

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
  const systemTools = [
    'system_search_tools',
    'system_call_tool',
    'system_batch_execute'
  ]
  const combined = skills.map(skill => skill.content).join('\n')

  for (const tool of [...workspaceTools, ...systemTools]) {
    assert.equal(qualifyDshVoidrTools(tool), `mcp__voidr__${tool}`, tool)
  }
  assert.match(combined, /\bmcp__voidr__assistant_workspace_status\b/)
  assert.match(combined, /\bmcp__voidr__assistant_workspace_prepare\b/)
  const nativeEchoTools = ['echo_execution_confirmation', 'echo_render_deviations', 'echo_render_regulatory_controls', 'echo_render_deviation_group', 'echo_propose_overview_change']
  for (const tool of nativeEchoTools) assert.equal(qualifyDshVoidrTools(tool), tool)
  assert.doesNotMatch(nativeEchoTools.reduce((text, tool) => text.replaceAll(tool, 'native-widget'), combined), unqualifiedVoidrTool)
  assert.match(combined, /\bask_user_question\b/)
  assert.match(combined, /\brender_widget\b/)
  assert.match(combined, /\bmcp__voidr__playwright_analyze_frames_vision\b/)
  assert.doesNotMatch(combined, /mcp__voidr__ask_user_question|mcp__voidr__render_widget/)

  const once = qualifyDshVoidrTools('assistant_workspace_status ask_user_question playwright_analyze_frames_vision')
  assert.equal(qualifyDshVoidrTools(once), once)
  assert.equal(once, 'mcp__voidr__assistant_workspace_status ask_user_question mcp__voidr__playwright_analyze_frames_vision')
})

test('DSH treats unknown tools as a terminal branch error instead of looping', () => {
  const skills = Object.fromEntries(loadDshPluginSkills().map(skill => [skill.name, skill.content]))

  for (const name of ['voidr-execute', 'voidr-failure-analysis']) {
    assert.match(skills[name], /unknown tool is a runtime contract failure/i)
    assert.match(skills[name], /Never retry the same name/i)
    assert.match(skills[name], /repeat an identical tool call/i)
    assert.match(skills[name], /Search for a replacement once only/i)
  }

  const combined = Object.values(skills).join('\n')
  for (const tool of [
    'playwright_get_execution_analytics',
    'playwright_get_test_timeline',
    'playwright_get_test_history',
    'playwright_get_test_dom',
    'playwright_get_trace_events',
    'playwright_get_step_timeline',
    'playwright_get_step_frames',
    'playwright_analyze_frames_vision'
  ]) assert.match(combined, new RegExp(`\\bmcp__voidr__${tool}\\b`), tool)

  assert.doesNotMatch(skills['voidr-failure-analysis'], /\bvoidr_auth_status\b/)
})

test('DSH spec reads documents uploaded by its widget instead of searching the application index', () => {
  const spec = loadDshPluginSkills().find(skill => skill.name === 'voidr-spec').content

  assert.match(spec, /\[Widget Submission\][\s\S]*action:"upload"/)
  assert.match(spec, /data\.files[\s\S]*data\.fileKey/)
  assert.match(spec, /mcp__voidr__files_analyze_uploaded_file/)
  assert.match(spec, /chat_uploads[\s\S]*não[\s\S]*indexa/)
  assert.match(spec, /file_embeddings_search_documents` somente para documentação já\s+indexada/)
  assert.doesNotMatch(spec, /`file_embeddings_search_documents` quando a pessoa escolher documentação/)
})

test('DSH proactively offers delivery at the attempt limit or user stop across every entry point', () => {
  const skills = Object.fromEntries(loadDshPluginSkills().map(skill => [skill.name, skill.content]))
  for (const content of [skills['voidr-generate'], skills['voidr-execute'], interactiveTestDevelopmentPrompt()]) {
    const expectedDelivery = content === interactiveTestDevelopmentPrompt()
      ? DSH_VALIDATION_DELIVERY
      : qualifyDshVoidrTools(DSH_VALIDATION_DELIVERY)
    assert.ok(content.includes(expectedDelivery))
    for (const text of ['at most three runs', 'including resumed turns',
      'In that same turn', 'normal chat', 'automate-promote-live',
      'If the user already declined extra attempts', 'NOT_VALIDATED',
      'unvalidatedApproval', 'budget_exhausted', 'user_stopped',
      'Never reuse a previous version', 'Without informed approval']) assert.ok(content.includes(text), text)
    assert.doesNotMatch(content, /No test verdict means no code publication|Do not offer LIVE from it|no executed tests is not eligible|canceled runs or no test verdict are not/)
  }
  for (const text of ['Ao encerrar as tentativas', 'NOT_VALIDATED', 'unvalidatedApproval',
    'Nunca invente nem altere o veredito', 'nem execute novamente',
    'Não espere a pessoa pedir', 'reason: "user_stopped"', 'Nunca reutilize o ID']) {
    assert.ok(skills['voidr-automate'].includes(text), text)
  }
  assert.doesNotMatch(skills['voidr-automate'], /sem veredito não permite publicação/)
  assert.doesNotMatch(skills['voidr-execute'], /produced a PASSED or diagnosed FAILED validation verdict, only/)
})

test('DSH asks inline after validation attempts without weakening publication consent', () => {
  const skills = Object.fromEntries(loadDshPluginSkills().map(skill => [skill.name, skill.content]))
  const entryPoints = [skills['voidr-automate'], skills['voidr-generate'],
    skills['voidr-execute'], interactiveTestDevelopmentPrompt()]

  for (const content of entryPoints) {
    assert.match(content, /normal chat|própria mensagem do chat/)
    assert.match(content, /additional validation attempt|tentativa adicional limitada/)
    assert.match(content, /keep the work unpublished|manter o trabalho sem publicar/)
    assert.match(content, /explicit reply|resposta explícita/)
    assert.doesNotMatch(content, /call ask_user_question with id automate-promote(?!-)/)
  }
  assert.match(DSH_VALIDATION_DELIVERY, /never preselect publication of a failing candidate/)
  assert.match(skills['voidr-automate'], /nunca pré-selecione a publicação de\s+um candidato com falha/)
  assert.match(DSH_VALIDATION_DELIVERY, /Declining extra attempts is NOT consent/)
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

  assert.match(skills['voidr-automate'], /não repita o que a pessoa já\s+respondeu claramente/)
  assert.match(skills['voidr-automate'], /sem\s+reescrever o que a pessoa declarou que deveria ocorrer/)
  assert.match(skills['voidr-generate'], /latest directive and\s+approved AAA define the intended behavior/)
  assert.doesNotMatch(skills['voidr-generate'], /code and observed runtime behavior\s+are authoritative/)
})

test('DSH exposes material progress without narrating every tool call', () => {
  const automate = loadDshPluginSkills().find(skill => skill.name === 'voidr-automate').content

  for (const text of [
    'Checkpoints de andamento',
    'Não narre cada comando nem exponha raciocínio interno',
    'quando uma evidência mudar o diagnóstico ou a estratégia de implementação',
    'antes de ampliar uma correção para outros arquivos ou casos',
    'antes de cada validação',
    'imediatamente após receber o resultado da validação',
    'somente ao caso representativo e aos helpers indispensáveis',
    'antes de propagar a estratégia aos demais casos'
  ]) assert.ok(automate.includes(text), text)

  assert.match(automate, /o alvo atual, a evidência observada, o que ela\s+significa/)
  assert.match(automate, /os casos afetados e o número\s+da tentativa/)
  assert.match(automate, /Não use apenas frases vagas[\s\S]*“continuando”/)
  assert.match(automate, /alterar o comportamento pretendido[\s\S]*pare e peça confirmação/)
})

test('DSH keeps active validation polling inside the turn', () => {
  const skills = Object.fromEntries(loadDshPluginSkills().map(skill => [skill.name, skill.content]))
  const prompt = interactiveTestDevelopmentPrompt()

  for (const content of [prompt, skills['voidr-automate'], skills['voidr-execute']]) {
    assert.match(content, /QUEUED/)
    assert.match(content, /RUNNING/)
    assert.match(content, /30 seconds|30 segundos/)
    assert.match(content, /automate-validation-running/)
    assert.match(content, /Continuar acompanhando/)
    assert.match(content, /Encerrar acompanhamento/)
    assert.match(content, /verifica/)
  }
})

test('DSH shows a sanitized Playwright evidence preview before correcting a failed run', () => {
  const automate = loadDshPluginSkills().find(skill => skill.name === 'voidr-automate').content

  for (const text of [
    'Prévia obrigatória de uma falha',
    'mensagem literal do Playwright',
    'esperado versus observado',
    'de dois a cinco eventos relevantes do trace',
    'erros de console relacionados',
    'método, endpoint, status e um resumo sanitizado da resposta',
    'link da execução ou relatório',
    'Nunca exponha headers de autorização, cookies, tokens',
    'diga qual fonte está ausente'
  ]) assert.ok(automate.includes(text), text)

  assert.match(automate, /não prova de falha do\s+aplicativo ou do teste/)
  assert.match(automate, /Ao receber um resultado `FAILED`[\s\S]*antes de editar ou iniciar\s+outra validação/)
})

test('DSH registers authoring skills and canonical analysis/context/generate/execute', () => {
  const skills = loadDshPluginSkills()
  assert.deepEqual(
    skills.map(skill => skill.name),
    ['blip-incident-remediation', 'voidr-automate', 'voidr-context', 'voidr-echo-analysis', 'voidr-evidence-report', 'voidr-execute', 'voidr-failure-analysis', 'voidr-gate-analysis', 'voidr-generate', 'voidr-hero-analysis', 'voidr-journeys', 'voidr-performance-author', 'voidr-performance-execute', 'voidr-performance-setup', 'voidr-performance-validate', 'voidr-spec']
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
    'Visual analysis is optional',
    'If visual analysis is not warranted, call neither tool',
    'UI rendering, layout, occlusion, or selector question unresolved',
    'A PASSED execution alone does not justify it',
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
  assert.doesNotMatch(analysis, /Before the evidence deep-dive, emit render_widget/)
  assert.doesNotMatch(analysis, /For one exact execution and test, show execution_analysis_viewer/)
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
    tools: { register() {} },
    on: (event, handler) => handlers.set(event, handler)
  })

  assert.equal(registeredSkills.length, loadDshPluginSkills().length)
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
  for (const skill of Object.keys(byName).filter(name => !['voidr-gate-analysis', 'voidr-hero-analysis'].includes(name))) {
    assert.match(prompt, new RegExp(skill))
  }
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

test('DSH authoring asks in chat by default and keeps write gates', () => {
  const byName = Object.fromEntries(loadDshPluginSkills().map(skill => [skill.name, skill]))

  const automate = byName['voidr-automate'].content
  assert.match(automate, /Pergunte em uma mensagem normal do chat/)
  assert.match(automate, /Termine a mensagem e espere a resposta/)
  assert.match(automate, /Não use\s+`ask_user_question` como padrão/)
  assert.match(automate, /não repita/i)

  assert.match(byName['voidr-spec'].content, /Use `ask_user_question` para a entrevista estruturada/)
  assert.match(byName['voidr-spec'].content, /uma\s+chamada de `ask_user_question`/)
  assert.match(byName['voidr-spec'].content, /`spec-source`[\s\S]*`spec-scope`[\s\S]*`spec-coverage`/)
  assert.match(byName['voidr-spec'].content, /Inclua somente os campos ainda não resolvidos/)
  assert.match(byName['voidr-spec'].content, /As fontes podem ser\s+combinadas/)
  assert.match(byName['voidr-spec'].content, /Mostre a proposta completa e pergunte apenas se a pessoa quer salvá-la/)
  assert.match(byName['voidr-journeys'].content, /faça \*\*uma chamada de\s+`ask_user_question` somente com `journeys-source`/)
  assert.match(byName['voidr-journeys'].content, /somente com `journeys-source`/)
  assert.match(byName['voidr-journeys'].content, /`multi_select: true`/)
  assert.doesNotMatch(byName['voidr-journeys'].content, /`journeys-scope`|`journeys-plan-name`/)
  assert.match(byName['voidr-journeys'].content, /pergunte \*\*inline em um turno\*\*/)
  assert.match(byName['voidr-journeys'].content, /pergunte \*\*inline no turno seguinte\*\*/)
  assert.match(byName['voidr-journeys'].content, /Nunca reúna essas duas perguntas no mesmo turno/)
  assert.doesNotMatch(byName['voidr-journeys'].content, /`journeys-coverage`|`journeys-volume`/)
  assert.match(byName['voidr-journeys'].content, /As\s+fontes podem ser combinadas/)
  assert.match(byName['voidr-journeys'].content, /tudo o que as fontes escolhidas sustentarem/)
  assert.match(byName['voidr-journeys'].content, /Respeite um recorte menor se a pessoa o pedir explicitamente/)
  assert.match(byName['voidr-journeys'].content, /pergunte \*\*inline, no fim do turno\*\*/)
  assert.match(byName['voidr-journeys'].content, /Mostre a proposta inteira e termine com \*\*uma pergunta direta no chat\*\*/)
  assert.match(byName['voidr-journeys'].content, /Deseja salvar o Test Plan \[nome\]/)
  assert.match(byName['voidr-journeys'].content, /Não apresente opções de persistir\/revisar\/cancelar e não\s+chame `ask_user_question`/)

  assert.match(byName['voidr-spec'].content, /Somente uma confirmação explícita para salvar\s+autoriza a escrita/)
  assert.match(byName['voidr-journeys'].content, /Somente uma aprovação inequívoca\s+para salvar a proposta exibida autoriza as escritas/)
  assert.match(byName['voidr-automate'].content, /Sem aprovação, preserve os arquivos e não publique/)
  assert.match(byName['voidr-automate'].content, /Credenciais\s+ausentes seguem o formulário seguro/)
  assert.match(byName['voidr-journeys'].content, /Se o pedido já\s+incluiu automatizar os casos, continue/)

  const prompt = interactiveTestDevelopmentPrompt()
  assert.match(prompt, /For ordinary choices and confirmations, ask in plain chat/)
  assert.match(prompt, /Do not use ask_user_question by default/)
  assert.match(prompt, /Never use ask_user_question, a form, or a persist\/revise\/cancel menu for this confirmation/)
  assert.match(prompt, /A request for the full generation-to-deployment workflow already states the next stage/)
})

test('spec surface groups dense intake in a form without changing ordinary next steps', () => {
  const prompt = interactiveTestDevelopmentPrompt({ hint: { surface: 'spec' } })
  assert.match(prompt, /single structured ask_user_question form for unresolved evidence source, scope and coverage/)
  assert.match(prompt, /Optional follow-up after a completed authoring stage/)
  assert.match(prompt, /suggest only the single best-supported next skill step/)
  assert.match(prompt, /Do not list alternatives, use ask_user_question/)
})

test('journeys surface keeps the plan picker and separates source form from inline naming', () => {
  const prompt = interactiveTestDevelopmentPrompt({ hint: { surface: 'journeys' } })
  assert.match(prompt, /Use plan_target_picker for an unresolved Test Plan destination/)
  assert.match(prompt, /one ask_user_question form containing only the multi-select source question/)
  assert.match(prompt, /Ask for a missing new journey name and objective inline in one turn/)
  assert.match(prompt, /new Test Plan name inline in a separate later turn/)
  assert.match(prompt, /never combine those two questions or put either in a form/)
  assert.match(prompt, /default scenario coverage to everything the chosen sources support/i)
  assert.match(prompt, /ask for a missing recording environment inline at the end of the turn/)
  assert.match(prompt, /Do not put coverage or environment in the intake form/)
  assert.match(prompt, /Optional follow-up after a completed authoring stage/)
  assert.match(prompt, /suggest only the single best-supported next skill step/)
})

test('unresolved Test Plan destination always uses the plan picker after application selection', () => {
  for (const surface of ['home', 'journeys', 'journey-overview']) {
    const prompt = interactiveTestDevelopmentPrompt({ hint: { surface } })
    assert.match(prompt, /Load voidr-journeys to create a Test Plan/)
    for (const required of [
      'test_plans_list_test_plans', 'plan_target_picker', 'includeNewOption: true',
      'zero or one existing plans', '__new_plan__', 'Stop and wait for its submission',
      'Do not repeat the picker when the exact plan is already resolved'
    ]) assert.ok(prompt.includes(required), `${surface}: ${required}`)
  }
  const journeys = loadDshPluginSkills().find(skill => skill.name === 'voidr-journeys').content
  assert.match(journeys, /renderize `plan_target_picker`/)
  assert.match(journeys, /mesmo com zero ou um plano existente/)
  assert.match(journeys, /`__new_plan__` não é um `testPlanId`/)
  assert.match(journeys, /não substitua o widget por texto ou formulário/)
})

test('Journeys surface leaves optional transitions in prose without skipping required approvals', () => {
  const skills = Object.fromEntries(loadDshPluginSkills().map(skill => [skill.name, skill.content]))
  const overview = interactiveTestDevelopmentPrompt({ hint: { surface: 'journey-overview' } })

  assert.match(overview, /one natural-language question/)
  assert.match(overview, /Markdown bullet list/)
  assert.match(overview, /Do not force a form merely to offer optional paths/)
  assert.match(overview, /ask only for the missing choice/)

  for (const surface of ['spec', 'journeys', 'automate']) {
    const prompt = interactiveTestDevelopmentPrompt({ hint: { surface } })
    assert.match(prompt, /Answer read-only questions directly/)
    assert.match(prompt, /required inputs still missing/)
    assert.match(prompt, /Optional follow-up after a completed authoring stage/)
  }

  for (const name of ['voidr-spec', 'voidr-journeys', 'voidr-automate']) {
    assert.match(skills[name], /Pergunte em uma mensagem normal do chat/)
    assert.match(skills[name], /sem lista|Não liste alternativas/)
    assert.doesNotMatch(skills[name], /Se houver vários caminhos úteis|Se houver vários caminhos\s+úteis/)
  }
  assert.match(skills['voidr-spec'], /Somente uma confirmação explícita para salvar\s+autoriza a escrita/)
  assert.match(skills['voidr-spec'], /pergunte somente: "Quer que\s+eu crie os cenários AAA desta jornada\?"/)
  assert.doesNotMatch(skills['voidr-spec'], /você pode sugerir criar cenários ou revisar/)
  assert.match(skills['voidr-spec'], /Se a spec não foi salva, não sugira a criação/)
  assert.match(skills['voidr-journeys'], /Somente uma aprovação inequívoca\s+para salvar a proposta exibida autoriza as escritas/)
  assert.match(skills['voidr-automate'], /Se o pedido atual ainda não autorizou explicitamente a implementação/)
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
    assert.match(content, /Do not finish delivery without resolving this choice|antes de encerrar a entrega/)
    assert.match(content, /Generic consent to publish code does not approve LIVE or Git|Aprovação para publicar código[\s\S]*não aprova[\s\S]*LIVE/)
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

test('DSH offers one direct inline LIVE and Git confirmation when every case passed', () => {
  const skills = Object.fromEntries(loadDshPluginSkills().map(skill => [skill.name, skill.content]))
  const entryPoints = [skills['voidr-generate'], skills['voidr-execute'], interactiveTestDevelopmentPrompt()]

  for (const content of entryPoints) {
    assert.match(content, /all implemented cases PASSED/)
    assert.match(content, /one direct question in normal chat/)
    assert.match(content, /default Git branch/)
    assert.match(content, /without a menu, form, or ask_user_question/)
    assert.match(content, /partial answer authorizes only the named action/)
    assert.match(content, /If any implemented case FAILED or is NOT_VALIDATED/)
  }

  const automate = skills['voidr-automate']
  assert.match(automate, /Se todos os casos implementados passaram/)
  assert.match(automate, /Deseja promover os 10 para LIVE e publicar o código no/)
  assert.match(automate, /não apresente lista de escolhas nem\s+formulário/)
  assert.match(automate, /Se houver casos `FAILED` ou `NOT_VALIDATED`/)
  assert.match(automate, /Um “sim” a essa pergunta específica autoriza as\s+duas ações/)
})

test('DSH suggests optional next steps in prose after confirmed LIVE delivery', () => {
  const skills = Object.fromEntries(loadDshPluginSkills().map(skill => [skill.name, skill.content]))
  const entryPoints = [skills['voidr-automate'], skills['voidr-generate'], skills['voidr-execute'],
    interactiveTestDevelopmentPrompt()]

  for (const content of entryPoints) {
    for (const required of [
      '/schedules/',
      '/monitor?view=products'
    ]) assert.ok(content.includes(required), required)
    assert.match(content, /at least one implemented case is confirmed LIVE|ao menos um caso implementado[\s\S]*como `LIVE`/)
    assert.doesNotMatch(content, /automate-live-next-step/)
    assert.match(content, /optional|opcionais/i)
  }

  const automate = skills['voidr-automate']
  assert.match(automate, /depois que a decisão de Git estiver resolvida/)
  assert.match(automate, /Quer configurar um[\s\S]*agendamento para executar esses testes periodicamente/)
  assert.match(automate, /Não chame `ask_user_question` nem renderize widget apenas para essa sugestão/)
  assert.match(automate, /não como uma[\s\S]*escolha obrigatória entre cron e Monitor/)
  assert.match(automate, /pessoa pode pedir outro ajuste\s+ou análise no chat/)
  assert.match(automate, /não inicie[\s\S]*execução/)
  assert.match(interactiveTestDevelopmentPrompt(), /Do not show a cron-versus-Monitor menu/)
  assert.match(interactiveTestDevelopmentPrompt(), /suggest only the single best-supported next skill step/)
  assert.match(interactiveTestDevelopmentPrompt(), /Do not list alternatives/)
  assert.match(interactiveTestDevelopmentPrompt(), /If no next step is clearly recommended, stop/)
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
    tools: { register() {} },
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
  const monitorSystemPrompt = variables.get('voidr_interactive_test_development')({ agent: { session: { events: [{ type: 'voidr/project-context-hint', data: { surface: 'monitor', executionId: 'exec-1', testCaseSlug: 'case-1' } }] } } })
  assert.match(monitorSystemPrompt, /Visual analysis is optional/)
  assert.match(monitorSystemPrompt, /merely because this skill is loaded or Monitor supplies an/)
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
