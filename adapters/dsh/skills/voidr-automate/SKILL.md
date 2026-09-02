---
name: voidr-automate
description: Conduz uma entrevista e implementa casos aprovados no workspace isolado do Assistant, validando em SHADOW sem acionar automação do Hive.
---

# Automatizar testes no workspace do DSH

O DSH escreve e corrige os testes. Nunca use `agent_jobs_trigger_automation` ou
`agent_jobs_trigger_hive_automation`.

Use `ask_user_question` para escolhas, confirmações ou informações ausentes que
não tenham um widget próprio. Quando a evidência necessária ainda precisa ser
gravada, use `session_coverage_picker`; para arquivos, use `document_input`.
Agrupe em uma única chamada as perguntas que já puder fazer, sempre com IDs
estáveis. A mensagem comum do chat não substitui essa ferramenta porque não
pausa o runtime. Não repita uma pergunta que a pessoa já respondeu claramente.

## 0. Entrevista da skill

Antes de preparar o workspace, resolva com ferramentas de leitura as opções
reais e pergunte tudo que ainda estiver aberto:

1. `automate-cases`: casos, suite ou jornada exatos a implementar, renderizando
   a árvore do Test Plan como opções quando a pessoa não tiver selecionado;
2. `automate-scope`: somente preparar e revisar o diff, ou também iterar a
   validação remota em SHADOW;
3. `automate-environment`: ambiente existente onde validar, quando houver mais
   de um e a validação tiver sido escolhida.

Depois de ler o repositório, mostre quais casos e arquivos pretende alterar.
Se o pedido atual ainda não autorizou explicitamente a implementação desses
casos, use `ask_user_question` com o ID `automate-approve-edit` antes da primeira
edição. A autorização cobre somente o escopo mostrado.

## 1. Vincular e preparar

1. Resolva o Test Plan e os casos exatos com ferramentas de leitura.
2. Preserve literalmente Arrange, Act, Assert, slugs e metadados dos casos.
3. Chame `assistant_workspace_bind_test_plan` imediatamente antes do primeiro
   checkout ou edição.
4. Chame `assistant_workspace_prepare`; o Service resolve o repositório e as
   credenciais a partir do vínculo persistido. Nunca clone manualmente.

Se `assistant_workspace_prepare` falhar, consulte `assistant_workspace_status`
uma vez e apresente o erro acionável. Nunca use `bash sleep` e nunca faça
retentativas em loop. Só tente novamente uma única vez depois que a pessoa
confirmar que a causa externa foi corrigida.

## 2. Implementar no workspace isolado

Leia as convenções e exemplos do repositório. Use sessões, screen maps e
seletores como evidência quando forem necessários ao caso. Implemente somente
os casos aprovados, sem expandir o escopo.

São permitidos Git, instalação local de dependências, build, lint e TypeScript
dentro do workspace isolado. Nunca instale browsers nem execute Playwright
localmente. Nunca leia ou exponha valores de `.env`.

## 3. Validar e corrigir

1. Revise o diff com `assistant_workspace_inspect`.
2. Gere um candidato imutável com `assistant_workspace_deploy_validation`.
3. Execute apenas os targets retornados usando
   `assistant_workspace_run_validation` em um ambiente existente.
4. Use `assistant_workspace_validation_status` para acompanhar a execução que
   acabou de criar. Não use `executions_get_execution`: em modo híbrido, a
   execução pertence ao staging, não ao Service local.
5. Leia a execução e suas evidências. Corrija o workspace e repita o ciclo
   candidato → SHADOW quando necessário.

Não enfraqueça asserts para obter verde. Se a evidência provar que o AAA está
errado, mostre a divergência e obtenha aprovação antes de atualizar o caso.

## 4. Entregar

Promova com `assistant_workspace_deploy_latest` somente após validação e uma
confirmação via `ask_user_question` com o ID `automate-promote`. Faça commit e
push com `assistant_workspace_publish` somente após uma confirmação separada
com o ID `automate-publish`. Nunca faça essas perguntas antes de existir um
candidato validado e um diff final para a pessoa revisar. Promoção e publicação
Git são decisões separadas.

Finalize com casos implementados, resultado da última validação, versão do
candidato e estado da publicação.
