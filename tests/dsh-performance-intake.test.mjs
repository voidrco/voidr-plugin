import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../adapters/dsh/index.mjs'
import { loadDshPluginSkills } from '../adapters/dsh/plugin-skills.mjs'

const skills = Object.fromEntries(loadDshPluginSkills().map(skill => [skill.name, skill.content]))

test('Performance setup discovers the application instead of demanding an internal ID', () => {
  const setup = skills['voidr-performance-setup']
  assert.match(setup, /mcp__voidr__system_search_tools/)
  assert.match(setup, /mcp__voidr__applications_list_applications/)
  assert.match(setup, /Nunca peça um ID de 24 caracteres/)
  assert.match(setup, /performance_app_picker/)
  assert.match(setup, /apps: \[\]/)
  assert.match(setup, /idioma ativo da conversa\/interface/)
  assert.match(setup, /uma decisão de negócio realmente ausente por vez/)
  assert.match(setup, /Falha de ferramenta não é lista vazia/)
})

test('Authoring uses documentation and offers an editable starter without traffic consent', () => {
  const author = skills['voidr-performance-author']
  assert.match(author, /mcp__voidr__applications_get_api_contract/)
  assert.match(author, /O que você quer testar\?/)
  assert.match(author, /não invente endpoints/)
  assert.match(author, /um usuário simultâneo por um minuto/)
  assert.match(author, /Preserve uma carga explicitamente solicitada/)
  assert.match(author, /não autorizam tráfego/)
  assert.match(author, /aprovação de produção/)
  assert.match(author, /mcp__performance-authoring__author_performance_artifact/)
})

test('Performance surface injects beginner setup into the real DSH prompt', () => {
  const variables = new Map()
  apply({
    skills: { register() {} },
    systemPrompt: { section() {}, variable(name, handler) { variables.set(name, handler) } },
    commands: { register() {} }, tools: { register() {} }, on() {}
  })
  const prompt = variables.get('voidr_interactive_test_development')({
    agent: { session: { events: [{ type: 'voidr/project-context-hint', data: { surface: 'performance' } }] } }
  })
  assert.match(prompt, /Nunca peça um ID de 24 caracteres/)
  assert.match(prompt, /performance_app_picker/)
  assert.doesNotMatch(prompt, /The persisted Test Plan binding is authoritative/)
})
