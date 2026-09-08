import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { routeVoidrPrompt } from '../scripts/lib/prompt-router.mjs'

const root = resolve(import.meta.dirname, '..')

test('routes natural Portuguese Voidr testing intents to the entry skill', () => {
  for (const prompt of [
    'Quero desenvolver testes na voidr',
    'Preciso criar um plano de testes na Voidr',
    'Vamos automatizar os testes usando a Voidr',
    'Quero executar os testes pela voidr'
  ]) {
    const routed = routeVoidrPrompt({
      prompt,
      transformedPrompt: prompt
    })
    assert.match(routed.modifiedTransformedPrompt, /\/voidr-context/)
    assert.match(routed.modifiedTransformedPrompt, /\/voidr-generate/)
    assert.match(routed.modifiedTransformedPrompt, /voidr_context_refresh/)
    assert.match(
      routed.modifiedTransformedPrompt,
      /before inspecting[\s\S]*files or calling any tool/i
    )
  }
})

test('routes English handoff intents to the entry skill', () => {
  for (const prompt of [
    'List all Test Plans for the application "Itaú Crédito Rural" (applicationId: abc)',
    'Create a new module, suite, and test case in the Voidr Test Plan "smoke-teste"',
    'The user wants to implement tests from an existing Test Plan'
  ]) {
    const routed = routeVoidrPrompt({
      prompt,
      transformedPrompt: prompt
    })
    assert.match(
      routed.modifiedTransformedPrompt || '',
      /\/voidr-context/,
      prompt
    )
  }
})

test('routes bare test-creation intents to a Voidr triage note', () => {
  for (const prompt of [
    'Quero criar um teste',
    'Preciso implementar testes',
    'Me ajuda a escrever um teste novo'
  ]) {
    const routed = routeVoidrPrompt({
      prompt,
      transformedPrompt: prompt
    })
    assert.match(routed.modifiedTransformedPrompt, /\/voidr-context/)
    assert.match(routed.modifiedTransformedPrompt, /\/voidr-generate/)
    assert.match(
      routed.modifiedTransformedPrompt,
      /never invent your own triage\s+options/i
    )
    assert.match(
      routed.modifiedTransformedPrompt,
      /clearly about plain local tests\s+unrelated to Voidr,\s+ignore/i
    )
    assert.match(
      routed.modifiedTransformedPrompt,
      /implementing cases that already exist\s+belongs to/i
    )
  }
})

test('does not rewrite unrelated prompts or explicit Voidr skill calls', () => {
  assert.deepEqual(
    routeVoidrPrompt({
      prompt: 'Corrija o teste unitário deste arquivo',
      transformedPrompt: 'Corrija o teste unitário deste arquivo'
    }),
    {}
  )
  assert.deepEqual(
    routeVoidrPrompt({
      prompt: '/copilot voidr-connect',
      transformedPrompt: '/copilot voidr-connect'
    }),
    {}
  )
})

test('hook command emits valid unchanged output for malformed input', async () => {
  const { spawn } = await import('node:child_process')
  const { resolve } = await import('node:path')
  const { once } = await import('node:events')
  const script = resolve(
    import.meta.dirname,
    '../scripts/route-voidr-prompt.mjs'
  )
  const child = spawn(process.execPath, [script], {
    stdio: ['pipe', 'pipe', 'inherit']
  })
  child.stdin.end('{not-json')
  let stdout = ''
  child.stdout.on('data', chunk => {
    stdout += chunk
  })
  const [code] = await once(child, 'exit')
  assert.equal(code, 0)
  assert.deepEqual(JSON.parse(stdout), {})
})

test('prompt hook resolves its script when VS Code omits PLUGIN_ROOT', () => {
  const hooks = JSON.parse(readFileSync(join(root, 'hooks.json'), 'utf8'))
  const command = hooks.hooks.userPromptTransformed[0].bash
  const prompt = 'Quero desenvolver testes na voidr'
  const result = spawnSync('/bin/bash', ['-lc', command], {
    input: JSON.stringify({
      sessionId: 'vscode-prompt-hook',
      cwd: process.cwd(),
      prompt,
      transformedPrompt: prompt
    }),
    encoding: 'utf8',
    env: {
      HOME: process.env.HOME,
      PATH: process.env.PATH,
      VOIDR_PLUGIN_ROOT: root
    }
  })
  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout)
  assert.match(output.modifiedTransformedPrompt, /\/voidr-context/)
})

test('plan-mode choices are recognized in natural phrasings', async () => {
  const { isExistingPlanChoice, isNewPlanChoice } = await import(
    '../scripts/lib/session-state.mjs'
  )
  for (const prompt of [
    'Usar Test Plan existente',
    'Num test plan existente',
    'Quero implementar testes de um Test Plan existente',
    'trabalhar em um plano de testes existente',
    'Usar um já existente.',
    'usar um existente',
    'É um existente\nNão sei o nome da aplicação, mas é um teste web',
    'Já existente',
    'Existente'
  ]) {
    assert.equal(isExistingPlanChoice(prompt), true, prompt)
  }
  for (const prompt of [
    'Não quero usar o test plan existente',
    'Criar novo Test Plan',
    'Corrija o teste unitário deste arquivo',
    'quero usar um repositório existente',
    'usar o ambiente existente para o smoke'
  ]) {
    assert.equal(isExistingPlanChoice(prompt), false, prompt)
  }
  assert.equal(isNewPlanChoice('Criar um novo plano de testes'), true)
  assert.equal(isNewPlanChoice('criar novo test plan'), true)
  assert.equal(isNewPlanChoice('usar test plan existente'), false)
})


test('run intents against a Test Plan route to /voidr-execute', () => {
  for (const prompt of [
    'executa o test plan de login',
    'roda o test plan 6a833bfabbf47dc61a9484df',
    'roda os testes do plano de pagamento na plataforma'
  ]) {
    const routed = routeVoidrPrompt({ prompt })
    assert.match(routed.modifiedTransformedPrompt || '', /\/voidr-execute/, prompt)
    assert.match(
      routed.modifiedTransformedPrompt || '',
      /sync verification/,
      prompt
    )
  }
  // Running tests with no platform marker stays a local request.
  for (const prompt of ['roda os testes do projeto', 'npm test falhou, roda de novo']) {
    assert.deepEqual(routeVoidrPrompt({ prompt }), {}, prompt)
  }
})

test('execution-failure intents route to /voidr-failure-analysis', () => {
  for (const prompt of [
    'analisa por que a execução 6a833bfabbf47dc61a9484df falhou',
    'investiga a falha da execução de ontem',
    'why did execution 6a833bfabbf47dc61a9484df fail?'
  ]) {
    const routed = routeVoidrPrompt({ prompt })
    assert.match(
      routed.modifiedTransformedPrompt || '',
      /\/voidr-failure-analysis/,
      prompt
    )
  }
  // A failed execution named with a Test Plan id still means diagnosis, not
  // the implementation pipeline.
  const withPlanId = routeVoidrPrompt({
    prompt:
      'a execução do test plan 6a833bfabbf47dc61a9484df falhou, analisa pra mim'
  })
  assert.match(
    withPlanId.modifiedTransformedPrompt || '',
    /\/voidr-failure-analysis/
  )
  // A local failing test never mentions a platform execution.
  assert.deepEqual(routeVoidrPrompt({ prompt: 'por que meu teste falhou?' }), {})
})

test('connect and organization-switch intents route to /voidr-connect', () => {
  for (const prompt of [
    'conecta minha conta voidr',
    'troca para a organização serasa no voidr',
    'preciso logar na voidr',
    'troca a service account'
  ]) {
    const routed = routeVoidrPrompt({ prompt })
    assert.match(routed.modifiedTransformedPrompt || '', /\/voidr-connect/, prompt)
    assert.match(routed.modifiedTransformedPrompt || '', /voidr_auth_status/, prompt)
  }
  // "login" inside a test-writing request keeps the pipeline route.
  const loginTests = routeVoidrPrompt({ prompt: 'cria testes de login na voidr' })
  assert.doesNotMatch(loginTests.modifiedTransformedPrompt || '', /\/voidr-connect/)
  assert.match(loginTests.modifiedTransformedPrompt || '', /\/voidr-context/)
  // A generic login request without Voidr vocabulary stays untouched.
  assert.deepEqual(routeVoidrPrompt({ prompt: 'faz login na aplicação e testa' }), {})
})

test('Echo monitoring report intents route to the authenticated report skill', () => {
  for (const prompt of [
    'Gere o relatório diário do Voidr Echo',
    'Envie o report semanal do Echo',
    'Crie o relatório mensal do assistente de voz',
    'Monte o relatório de monitoramento diário'
  ]) {
    const routed = routeVoidrPrompt({ prompt })
    assert.match(
      routed.modifiedTransformedPrompt || '',
      /\/voidr-echo-report/,
      prompt
    )
    assert.match(routed.modifiedTransformedPrompt || '', /voidr_auth_status/)
    assert.match(
      routed.modifiedTransformedPrompt || '',
      /echo_generate_monitoring_report/
    )
  }

  assert.deepEqual(
    routeVoidrPrompt({ prompt: 'gere um relatório de cobertura do projeto' }),
    {}
  )
})

test('a Test Plan named with its id routes to the pipeline', () => {
  // The phrasing that started this: Portuguese sentence, platform vocabulary,
  // no "voidr" anywhere. It matched nothing, so the model picked a skill by
  // description and landed on /voidr-generate with no manifest.
  const routed = routeVoidrPrompt({
    prompt:
      'Quero automatizar o test plan "Cobertura — Analise de 1 sessao" (id: 6a833bfabbf47dc61a9484df)'
  })
  assert.match(routed.modifiedTransformedPrompt, /Voidr platform testing request/)
  assert.match(routed.modifiedTransformedPrompt, /\/voidr-context/)
  assert.match(routed.modifiedTransformedPrompt, /voidr_context_refresh/)

  // Without the id it is still ambiguous, so it gets the conservative triage
  // note rather than the pipeline route.
  const generic = routeVoidrPrompt({ prompt: 'automatizar o test plan de checkout' })
  assert.match(generic.modifiedTransformedPrompt, /If this request is about tests/)

  // And unrelated work stays untouched.
  for (const prompt of ['roda o lint do projeto', 'git status']) {
    assert.deepEqual(routeVoidrPrompt({ prompt }), {}, prompt)
  }
})

test('correction intents route to /voidr-generate, not to another diagnosis', () => {
  for (const prompt of [
    'Faca o fix nas specs',
    'corrige o seletor de senha',
    'aplica o fix nos testes',
    'conserta o TROCA-01',
    'ajusta o assert do caso de login'
  ]) {
    const routed = routeVoidrPrompt({ prompt })
    assert.match(routed.modifiedTransformedPrompt || '', /\/voidr-generate/, prompt)
    // Correcting is implementation work: it ends on the build gate, and the
    // re-run is a separate, later request.
    assert.match(routed.modifiedTransformedPrompt || '', /voidr_build/, prompt)
    assert.match(
      routed.modifiedTransformedPrompt || '',
      /never weaken an assertion/i,
      prompt
    )
  }

  // A unit test is the developer's own file; the platform never runs it.
  assert.deepEqual(
    routeVoidrPrompt({ prompt: 'Corrija o teste unitário deste arquivo' }),
    {}
  )
  assert.deepEqual(
    routeVoidrPrompt({ prompt: 'corrige esse bug no meu componente react' }),
    {}
  )

  // Asking why it failed is still diagnosis, not correction.
  const diagnosis = routeVoidrPrompt({
    prompt: 'analisa por que a execução 6a833bfabbf47dc61a9484df falhou'
  })
  assert.match(
    diagnosis.modifiedTransformedPrompt || '',
    /\/voidr-failure-analysis/
  )
})
