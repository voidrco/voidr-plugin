---
name: voidr-journeys
description: Conduz uma entrevista e cria jornadas e cenários AAA no Test Plan com o raciocínio do DSH, sem jobs de coverage ou geração no Hive.
---

# Gerar jornadas e cenários

O DSH infere e classifica os cenários. Nunca use `coverage_*`,
`test_plan_generation_*` ou um job de geração externo.

Pergunte em uma mensagem normal do chat quando faltar uma decisão, confirmação
ou informação. Termine a mensagem e espere a resposta antes de agir. Não use
`ask_user_question` como padrão nem abra um formulário para escolhas que a
pessoa consegue responder em texto. Faça somente as perguntas necessárias,
agrupando as que dependem do mesmo contexto; não repita o que a pessoa já
respondeu claramente. Reserve `ask_user_question` para uma escolha estruturada
que realmente não possa ser resolvida com clareza no chat. Para gravar ou
selecionar sessões reais, use o widget `session_coverage_picker`; para enviar
documentos, use `document_input`.

Para aplicação ainda não confirmada, use `app_target_picker` com
`includeNewOption: true`, incluindo **Nova aplicação**. Se a pessoa escolher
`__new_app__`, pedir um produto novo ou não houver aplicações, use
`app_registration` e aguarde `app_registered`; valide o `applicationId`
retornado antes de continuar. Não substitua esses widgets por `ask_user_question`.

## 0. Entrevista da skill

Antes de inferir qualquer cenário, resolva com ferramentas de leitura as opções
reais e pergunte apenas o que ainda impedir uma decisão segura:

1. Decida se o pedido cria uma jornada ou trabalha em uma existente; pergunte
   no chat somente se as duas opções continuarem plausíveis;
2. Resolva aplicação, Test Plan e jornada exatos, usando opções
   retornadas pela plataforma; nunca peça IDs. Quando o contexto da UI já
   trouxer o Test Plan e a jornada abertos, valide-os e use-os como destino;
   não repita essa pergunta;
3. Confirme as fontes quando o pedido e o contexto não as definirem. Ofereça
   **Gravar nova sessão**, **Usar sessões gravadas** e **Enviar documentação**;
   inclua **Spec atual** somente quando ela tiver conteúdo válido. Não inicie
   gravação nem use uma fonte não escolhida silenciosamente;
4. Pergunte sobre cobertura somente se não estiver claro se a pessoa quer
   fluxo principal, erros/alternativas, limites ou tudo que as fontes sustentam;
5. Pergunte sobre volume somente se um limite fizer diferença material para a
   proposta e não puder ser inferido do pedido.

Para uma jornada nova, obtenha nome, objetivo e severidade; pergunte no chat
somente o que o pedido e o contexto não resolverem. Fonte é um contrato de
produto: use apenas as fontes indicadas pela pessoa ou já fixadas no contexto
da página. Se não houver escolha, pergunte; não invente nem omita uma fonte.
Depois da resposta:

- para **Gravar nova sessão**, renderize `session_coverage_picker` com a
  aplicação, URL, plano e jornada; ele inicia a captura real pela extensão.
  Faça isso na mesma rodada da seleção: não faça outra `ask_user_question`
  para pedir qual fluxo gravar, porque a jornada já resolvida entra em `flows`;
- para **Usar sessões gravadas**, renderize o mesmo
  `session_coverage_picker` com `sourceMode: existing_session` e passe em
  `sessionIds` todas as sessões já associadas à jornada no contexto da UI.
  Se listar outras sessões, passe-as em `sessions`; nunca renderize um seletor
  vazio quando o contexto já trouxe sessões associadas;
- para **Enviar documentação**, renderize `document_input` para o anexo real.

Espere os widgets devolverem as evidências escolhidas antes de inferir. Não
peça a descrição de uma navegação em texto, nem reutilize uma sessão ou escolha
de outra skill silenciosamente.

## 1. Resolver o escopo

1. Valide aplicação e Test Plan com ferramentas de leitura.
2. Confirme se o pedido cria uma jornada nova ou adiciona cenários a uma
   jornada existente.
3. Para uma jornada existente, leia `test_plans_get_module_spec`, suites e
   casos atuais antes de propor mudanças.
4. Para uma jornada nova, obtenha o nome, objetivo e severidade antes de criar
   qualquer estrutura.

Nunca substitua silenciosamente o plano escolhido e nunca invente IDs, slugs
ou uma aplicação a partir do diretório local.

## 2. Reunir as fontes escolhidas

- Spec existente: `test_plans_get_module_spec` é a fonte principal.
- Sessões: use `sessions_get_session_actions`,
  `sessions_get_session_action_effects`, `sessions_get_session_digest` e,
  quando necessário, screen map ou seletores.
- Documentação: use `file_embeddings_search_documents` apenas para os tópicos
  relevantes ao escopo confirmado.

Não transforme uma ação observada em regra de negócio sem evidência. Não copie
dados pessoais ou segredos das fontes.

## 3. Propor no DSH

Para cada cenário, produza:

- nome e destino exato: jornada e suite;
- Arrange: estado e pré-condições;
- Act: ação exercitada;
- Assert: resultado observável;
- classificação `NEW`, `UPDATE` ou `COMPLEMENT` contra os casos existentes;
- fontes usadas e qualquer lacuna.

`UPDATE` substitui um caso cujo contrato mudou. `COMPLEMENT` preserva o caso e
acrescenta passos necessários ao mesmo comportamento. `NEW` representa um
comportamento ainda não coberto.

Mostre a proposta inteira e pergunte no chat se deve persistir tudo, revisar a
seleção ou cancelar. Espere a resposta. Se a pessoa escolher revisar, aplique
as mudanças na proposta e peça nova confirmação. Somente persistir autoriza as
escritas abaixo.

## 4. Persistir sem job

Depois da aprovação:

1. crie a jornada com `test_plans_create_module` somente quando ela não existir;
2. crie as suites ausentes com `test_plans_create_suite`;
3. persista `NEW` com `test_plans_create_case`;
4. persista `UPDATE` e `COMPLEMENT` com `test_plans_update_case`, enviando os
   arrays AAA completos após reler o caso;
5. associe o `sessionId` quando o cenário vier de uma sessão específica;
6. releia o plano e confira se a estrutura final corresponde à aprovação.

Não use `coverage_apply_inferred_cases`: ele depende de uma proposta produzida
por um job externo. Se uma gravação em lote exigir muitas escritas, faça as
operações determinísticas acima uma a uma e reporte qualquer falha parcial.

Ao final, liste o que foi criado, atualizado e complementado. Se o pedido já
incluiu automatizar os casos, continue com `voidr-automate`; não peça de novo
qual é o próximo passo. Caso contrário, pergunte no chat se a pessoa quer
automatizá-los antes de iniciar essa etapa.
