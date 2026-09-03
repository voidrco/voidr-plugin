import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { apply, inject } from '../adapters/dsh/index.mjs'
import { loadDshPluginSkills } from '../adapters/dsh/plugin-skills.mjs'
import { AGENT_OWNED_AUTHORING_TOOLS } from '../core/policies/agent-owned-authoring.mjs'
import { interactiveTestDevelopmentPrompt } from '../core/workflow/interactive-test-development.mjs'
import { loadPolicy } from '../scripts/lib/policy.mjs'

test('DSH registers authoring skills and canonical context/generate/execute', () => {
  const skills = loadDshPluginSkills()
  assert.deepEqual(
    skills.map(skill => skill.name),
    ['voidr-automate', 'voidr-context', 'voidr-execute', 'voidr-generate', 'voidr-journeys', 'voidr-spec']
  )
  assert.equal(inject.includes('skills'), true)
  for (const skill of skills) {
    assert.equal(skill.provider, 'voidr-plugin')
    assert.equal(skill.content.length > 300, true)
  }
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

  assert.equal(registeredSkills.length, 6)
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
  for (const [surface, skillName] of Object.entries({ spec: 'voidr-spec', journeys: 'voidr-journeys', automate: 'voidr-automate' })) {
    const text = variables.get('voidr_interactive_test_development')({ agent: { session: { events: [{ type: 'voidr/project-context-hint', data: { surface } }] } } })
    assert.match(text, new RegExp(`Active surface skill: ${skillName}`))
    assert.ok(text.includes(loadDshPluginSkills().find(skill => skill.name === skillName).content))
  }
  const home = interactiveTestDevelopmentPrompt({ hint: { surface: 'home' } })
  assert.match(home, /generalist/)
  assert.match(home, /generate a test plan, write a specification, create journeys and scenarios, automate tests, or analyze failures/)
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
