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

test('Authoring follows the latest endpoint and stops on access denial without speculative probes', () => {
  const author = skills['voidr-performance-author']
  assert.match(author, /escolha explícita mais recente de endpoint ou fluxo substitui a anterior/)
  assert.match(author, /não continue investigando o endpoint descartado/)
  assert.match(author, /Em 401\/403, pare a escrita e encerre o turno/)
  assert.match(author, /não prova feature flag desativada/)
  assert.match(author, /não invente `draftArtifactId` ou `completionToken`/)
  assert.match(author, /Não investigue repositórios da plataforma, credenciais ou configuração do host/)
  assert.match(author, /Autorar não autoriza sondar endpoints via Bash\/curl/)
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
  assert.match(prompt, /Para escolher endpoint ou fluxo de teste, pergunte no texto normal do chat/)
  assert.doesNotMatch(prompt, /The persisted Test Plan binding is authoritative/)
  assert.match(prompt, /query: \{ "status": "available" \}/)
  assert.match(prompt, /A ferramenta também separa filtros enviados no `path`/)
  assert.match(prompt, /mcp__voidr__performance_get_preflight_result/)
  assert.match(prompt, /mesmo `preflightRunId`/)
  assert.match(prompt, /waitMs: 20000/)
  assert.match(prompt, /3 minutos e 9 consultas/)
  assert.match(prompt, /`done: false` não são falha nem aprovação/)
  assert.match(prompt, /Erro de leitura significa resultado não confirmado/)
  assert.match(prompt, /sem presumir que a validação sempre o retorna/)
  assert.match(prompt, /Login com credenciais no corpo JSON é suportado/)
  assert.match(prompt, /"password": "\{\{secret\.API_PASSWORD\}\}"/)
})

test('Validation follows the dispatched run without redispatch, stale results or an unfinished final message', () => {
  const validation = skills['voidr-performance-validate']
  assert.match(validation, /mcp__voidr__performance_validate_scenario` uma única vez/)
  assert.match(validation, /mcp__voidr__performance_get_preflight_result/)
  assert.match(validation, /`preflightRunId` e o `scenarioVersionId` de cada resultado/)
  assert.match(validation, /preservando seu ID, preset e dados/)
  assert.match(validation, /não o sobrescreva com histórico antigo/)
  assert.match(validation, /3 minutos e 9 consultas/)
  assert.match(validation, /não que a execução falhou/)
  assert.match(validation, /conclua com uma ou duas frases completas/)
  assert.match(validation, /Nunca prepare carga neste turno de validação/)
  assert.doesNotMatch(validation, /polling manual em seguida|Chame somente/)
  assert.match(skills['voidr-performance-execute'], /Para status da carga/)
  assert.match(skills['voidr-performance-execute'], /A validação inicial tem outro fluxo/)
})

test('Authoring preserves URL filters through the dedicated query field', () => {
  const author = skills['voidr-performance-author']
  assert.match(author, /query: \{ "status": "available" \}/)
  assert.match(author, /Filtro fixo não exige variável de ambiente/)
  assert.match(author, /Nunca descarte o filtro nem troque o endpoint/)
  assert.match(author, /Filtros enviados no `path` também são separados automaticamente/)
  assert.match(author, /nunca afirme que o campo `query` não existe/)
})

test('Endpoint and flow choices use chat replies while pickers and approvals remain available', () => {
  for (const name of ['voidr-performance-setup', 'voidr-performance-author']) {
    const content = skills[name]
    assert.match(content, /texto normal do chat/)
    assert.match(content, /`ask_user_question`, `request_user_input` ou formulário de `render_widget`/)
    assert.match(content, /encerre o turno e aguarde a resposta pelo campo de mensagem/)
    assert.match(content, /sem duplicá-la em formulário/)
    assert.match(content, /Preserve o seletor de aplicação e os widgets de aprovação de validação\/carga/)
  }
})
