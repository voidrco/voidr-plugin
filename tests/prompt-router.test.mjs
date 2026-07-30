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
