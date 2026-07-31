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
    assert.match(routed.modifiedTransformedPrompt, /\/voidr-develop-tests/)
    assert.match(
      routed.modifiedTransformedPrompt,
      /before[\s\S]*inspecting files or calling any tool/i
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
    assert.match(routed.modifiedTransformedPrompt, /\/voidr-develop-tests/)
    assert.match(
      routed.modifiedTransformedPrompt,
      /never invent your own triage options/i
    )
    assert.match(
      routed.modifiedTransformedPrompt,
      /clearly about plain local tests unrelated to Voidr, ignore/i
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
  assert.match(output.modifiedTransformedPrompt, /\/voidr-develop-tests/)
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
    'usar um existente'
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
