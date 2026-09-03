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
5. A preparação executa o context setup original: manifesto, dependências,
   link validado, estrutura dos casos e ambiente. Se retornar
   `needsEnvironmentSelection`, pergunte e repita com `environmentSlug`.
   O Service injeta a Service Account da organização nesses comandos. Nunca
   peça `voidr login`, acesso ao terminal do usuário ou credenciais em chat.
6. Antes de cada turno de geração, inclusive ao retomar, chame
   `assistant_workspace_context_refresh` e leia `manifest-context.json`.
   Se o contexto estiver incompleto, prepare novamente antes de editar.

O retorno de `assistant_workspace_bind_test_plan` e `assistant_workspace_status`
informa `repositoryAccess.mode`, calculado pelo Service a partir do repositório
vinculado ao plano, não da organização do usuário nem de uma URL no chat:

- `voidr_managed`: repositório GitHub da organização interna da Voidr (`voidrco`).
  Não exige conector Git do cliente. Prepare diretamente pelo Service, mesmo
  quando `git_connector_list` estiver vazio; não chame essa listagem como pré-requisito.
- `organization_connector`: repositório externo. O Service usa o conector da
  organização autenticada. Se estiver ausente, peça a conexão; se não houver
  permissão para o repositório, peça a correção dessa permissão. Nunca use o
  acesso interno da Voidr como alternativa, nem busque tokens ou chaves locais.
- `unsupported`, ausência de vínculo ou de `repositoryAccess`: não deduza um
  acesso a partir do nome da jornada. Consulte o estado uma vez; se continuar
  indisponível, informe que o vínculo/configuração precisa ser corrigido.

O modo indica qual acesso usar, não garante que a credencial esteja funcionando.
Falhas no acesso `voidr_managed` devem ser encaminhadas à Voidr, sem pedir ao
cliente que instale um conector para `voidrco`.

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
   Use `assistant_workspace_build` para validar sem publicar. Só faça upload
   após aprovação; não substitua esse build por uma checagem de sintaxe.
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
Carregue `voidr-execute` para o piloto, diagnóstico e entrega. Primeiro valide
um caso representativo; com sucesso, execute os restantes juntos. Limite a três
validações por caso e duas correções da mesma falha; outra rodada exige pedido
do usuário. Diagnostique pela timeline, DOM e trace, não só pela mensagem.

## 4. Entregar

Publicar código, promover tags e publicar no Git são três decisões separadas:

1. **Publicar o código:** use `assistant_workspace_deploy_latest` somente após
   uma execução concluída com veredito dos testes (passou ou falhou após diagnóstico)
   e confirmação via `ask_user_question` com o ID `automate-promote`.
   Mostre a versão executada e o diff final antes de perguntar. Informe
   `confirm: true`, `executionId` e, em caso de falha, `failureDiagnosis`.
   Execução cancelada ou sem veredito não permite publicação. Não reconstrua a versão.
   Essa ferramenta atualiza a release de código, não as tags dos casos.
   `status: promoted` ou `alreadyPublished: true` confirma somente o código publicado;
   `caseTagsChanged: false` não é erro e não significa que os casos estejam LIVE.
2. **Promover DEV → LIVE:** após confirmar a publicação, leia as tags atuais com
   `test_plans_get_test_plan`. Se os casos já estiverem LIVE, informe isso sem nova escrita.
   Caso contrário, explique quais casos passarão a ser monitorados e elegíveis para
   self-healing. Peça confirmação separada via `ask_user_question` com o ID
   `automate-promote-live`. Confirme `canWrite: true` e use
   `test_plans_update_test_case_tag` uma vez por caso confirmado. Releia o plano
   e informe o `current_tag` persistido de cada caso. Nunca anuncie LIVE sem essa leitura.
   Se a pessoa recusar, preserve as tags e informe que o código está publicado, mas
   os casos não foram promovidos. Se faltar permissão ou a mudança falhar, informe
   quais casos não mudaram; não repita o deploy nem reconstrua o candidato para corrigir tags.
3. **Publicar no Git:** faça commit e push com `assistant_workspace_publish`
   somente após confirmação separada com o ID `automate-publish`.
   Falha no Git não desfaz a publicação do código nem as tags já confirmadas.

Se a publicação de código falhar, não avance para a promoção de tags. Consulte o
estado antes de propor uma nova tentativa. Se retornar `alreadyPublished: true`,
continue da decisão de tags, sem novo upload. Preserve o mesmo candidato executado.

Finalize com casos implementados, resultado da última validação, versão publicada,
`current_tag` lido de cada caso e estado separado do commit/push.
