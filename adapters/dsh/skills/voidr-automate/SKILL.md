---
name: voidr-automate
description: Implementa os casos aprovados como testes no workspace isolado do Assistant, valida candidatos em SHADOW e publica somente quando solicitado, sem acionar automação do Hive.
---

# Automatizar testes no workspace do DSH

O DSH escreve e corrige os testes. Nunca use `agent_jobs_trigger_automation` ou
`agent_jobs_trigger_hive_automation`.

## 1. Vincular e preparar

1. Resolva o Test Plan e os casos exatos com ferramentas de leitura.
2. Preserve literalmente Arrange, Act, Assert, slugs e metadados dos casos.
3. Chame `assistant_workspace_bind_test_plan` imediatamente antes do primeiro
   checkout ou edição.
4. Chame `assistant_workspace_prepare`; o Service resolve o repositório e as
   credenciais a partir do vínculo persistido. Nunca clone manualmente.

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
4. Leia a execução e suas evidências. Corrija o workspace e repita o ciclo
   candidato → SHADOW quando necessário.

Não enfraqueça asserts para obter verde. Se a evidência provar que o AAA está
errado, mostre a divergência e obtenha aprovação antes de atualizar o caso.

## 4. Entregar

Promova com `assistant_workspace_deploy_latest` somente após validação e pedido
explícito. Faça commit e push com `assistant_workspace_publish` somente quando
a pessoa pedir. Promoção e publicação Git são decisões separadas.

Finalize com casos implementados, resultado da última validação, versão do
candidato e estado da publicação.
