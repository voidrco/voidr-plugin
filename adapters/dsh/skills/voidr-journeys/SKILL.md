---
name: voidr-journeys
description: Cria Test Plans (conjuntos de jornadas), jornadas e cenários AAA com o raciocínio do DSH, sem jobs de coverage ou geração no Hive.
---

# Gerar jornadas e cenários

O DSH infere e classifica os cenários. Nunca use `coverage_*`,
`test_plan_generation_*` ou um job de geração externo.

Use `ask_user_question` somente para escolher fontes de evidência quando elas
ainda estiverem abertas. Pergunte em uma mensagem normal do chat o nome e o
objetivo da jornada e, depois, o nome do Test Plan novo, uma pergunta por turno.
Termine cada turno e espere a resposta. Faça somente as perguntas necessárias; não repita
o que a pessoa já respondeu claramente. Para gravar ou selecionar sessões
reais, use `session_coverage_picker`; para enviar documentos, `document_input`.

Se a pessoa pedir apenas uma explicação ou leitura, responda sem iniciar a entrevista.
Depois de concluir a etapa pedida, sugira somente o próximo passo recomendado
em uma pergunta curta no chat. Não liste alternativas nem use formulário para
essa sugestão. Se não houver passo recomendado, encerre com o resultado.

Para aplicação ainda não confirmada, use `app_target_picker` com
`includeNewOption: true`, incluindo **Nova aplicação**. Se a pessoa escolher
`__new_app__`, pedir um produto novo ou não houver aplicações, use
`app_registration` e aguarde `app_registered`; valide o `applicationId`
retornado antes de continuar. Não substitua esses widgets por `ask_user_question`.

Depois de confirmar a aplicação, se o Test Plan de destino não estiver
explicitamente resolvido pelo pedido, pela página validada ou por uma escolha
nesta conversa, liste os planos reais com `test_plans_list_test_plans` para
essa aplicação e renderize `plan_target_picker` com
`data: { plans: [{ id, name, secondary? }], applicationName, includeNewOption: true }`.
Mostre o widget mesmo com zero ou um plano existente: a pessoa pode escolher
o plano ou **Criar um conjunto de jornadas novo**. Pare e aguarde a submissão.
`__new_plan__` não é um `testPlanId`; valide a escolha de um plano existente
antes de escrever. Não escolha o primeiro plano automaticamente, não peça IDs,
não substitua o widget por texto ou formulário e não repita a escolha quando
o destino exato já tiver sido informado e validado.
Se a pessoa escolher `__new_plan__`, peça no chat o nome do novo conjunto
somente se ele ainda não tiver sido informado, depois de resolver o escopo da
jornada. A escolha do widget define o destino, mas
não autoriza criar o conjunto antes da aprovação da proposta.

## 0. Entrevista da skill

Antes de inferir qualquer cenário, resolva com ferramentas de leitura as opções
reais e pergunte apenas o que ainda impedir uma decisão segura:

1. Decida se o pedido cria uma jornada ou trabalha em uma existente; pergunte
   no chat somente se as duas opções continuarem plausíveis;
2. Resolva aplicação, Test Plan e jornada exatos, usando os widgets de
   aplicação e plano acima quando esses destinos estiverem abertos. Quando
   o contexto da UI já trouxer o Test Plan e a jornada abertos, valide-os e
   use-os como destino; não repita essa pergunta;
3. Confirme as fontes quando o pedido e o contexto não as definirem. Ofereça
   **Gravar nova sessão**, **Usar sessões gravadas** e **Enviar documentação**;
   inclua **Spec atual** somente quando ela tiver conteúdo válido. Não inicie
   gravação nem use uma fonte não escolhida silenciosamente;
4. Assuma **tudo o que as fontes escolhidas sustentarem** como cobertura dos
   cenários: fluxo principal, alternativas, erros, limites e validações que
   tenham evidência. Não pergunte "Que cobertura você quer nos cenários?".
   Respeite um recorte menor se a pessoa o pedir explicitamente e não invente
   comportamentos sem fonte;
5. Não peça um volume arbitrário de cenários. Se houver um limite real da
   plataforma que impeça cobrir as fontes, explique-o e pergunte no chat qual
   parte priorizar.

Se as fontes ainda estiverem abertas, faça **uma chamada de
`ask_user_question` somente com `journeys-source`**, usando
`multi_select: true` entre **Gravar nova sessão**, **Usar sessões gravadas**,
**Enviar documentação** e **Spec atual** somente se ela tiver conteúdo
válido. As fontes podem ser combinadas; indique brevemente quando uma escolha
exige gravação ou anexo. Não apresente sessões inexistentes como gravadas nem
um documento citado como já anexado. Não inclua escopo, nome do plano,
cobertura, volume ou ambiente nesse formulário.

Após a escolha das fontes, se nome ou objetivo da primeira jornada ainda
faltarem, pergunte **inline em um turno**: "Qual é o nome e o objetivo da
primeira jornada?" Espere a resposta. Se o destino for `__new_plan__` e o
nome do conjunto ainda faltar, pergunte **inline no turno seguinte**:
"Qual nome você quer dar ao novo conjunto de jornadas?" Espere a resposta.
Nunca reúna essas duas perguntas no mesmo turno, nem as converta em
`ask_user_question` ou formulário. Pule qualquer pergunta já resolvida pelo
pedido ou pelo contexto validado. A resposta a cada etapa continua o pedido
original, sem pedir o prompt novamente; se houver lacunas de evidência,
explique-as brevemente após a escolha.

Para uma jornada nova, obtenha nome e objetivo. Use `MEDIUM` como severidade
quando a pessoa não a indicar; respeite `LOW`, `MEDIUM`, `HIGH` ou `CRITICAL`
quando ela indicar. Fonte é um contrato de
produto: use apenas as fontes indicadas pela pessoa ou já fixadas no contexto
da página. Se não houver escolha, pergunte; não invente nem omita uma fonte.
Depois da resposta:

- para **Gravar nova sessão**, leia os ambientes cadastrados da aplicação.
  Se houver mais de um ambiente elegível e a pessoa não tiver escolhido,
  pergunte **inline, no fim do turno**, qual usar, com nomes e URLs reais;
  espere a resposta. Não inclua o ambiente num formulário. Se houver só um
  ambiente válido, reutilize-o; se não houver nenhum, siga a confirmação
  explícita de cadastro do contrato do host. Com ambiente persistido e
  resolvido, renderize `session_coverage_picker` com a aplicação, URL, plano
  e jornada; ele inicia a captura real pela extensão. Não peça qual fluxo
  gravar: a jornada já resolvida entra em `flows`;
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
4. Para uma jornada nova, obtenha nome e objetivo antes de criar qualquer
   estrutura; use severidade `MEDIUM` se a pessoa não indicar outra.

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

Mostre a proposta inteira e termine com **uma pergunta direta no chat**:
"Deseja salvar o Test Plan [nome] com a jornada [nome] e os [N] cenários
propostos?" Para um plano existente, pergunte se deseja salvar nele as
alterações propostas, indicando quantos cenários serão criados, atualizados
ou complementados. Não apresente opções de persistir/revisar/cancelar e não
chame `ask_user_question` nem renderize formulário para essa aprovação.
Espere a resposta. Se a pessoa pedir ajustes, revise a proposta e faça a
pergunta novamente; se recusar, não escreva. Somente uma aprovação inequívoca
para salvar a proposta exibida autoriza as escritas abaixo.

## 4. Persistir sem job

Depois da aprovação:

1. se o destino for `__new_plan__`, crie o conjunto em `DRAFT` com
   `test_plans_create_test_plan` usando a aplicação confirmada e o nome
   aprovado; releia o conjunto criado e use seu `testPlanId` real. Se a
   criação falhar, pare sem escrever jornadas ou cenários;
2. crie a jornada com `test_plans_create_module` somente quando ela não existir;
3. crie as suites ausentes com `test_plans_create_suite`;
4. persista `NEW` com `test_plans_create_case`;
5. persista `UPDATE` e `COMPLEMENT` com `test_plans_update_case`, enviando os
   arrays AAA completos após reler o caso;
6. associe o `sessionId` quando o cenário vier de uma sessão específica;
7. releia o plano e confira se a estrutura final corresponde à aprovação.

Não use `coverage_apply_inferred_cases`: ele depende de uma proposta produzida
por um job externo. Se uma gravação em lote exigir muitas escritas, faça as
operações determinísticas acima uma a uma e reporte qualquer falha parcial.

Ao final, liste o que foi criado, atualizado e complementado. Se o pedido já
incluiu automatizar os casos, continue com `voidr-automate`; não peça de novo
qual é o próximo passo. Caso contrário, pergunte no chat se a pessoa quer
automatizá-los antes de iniciar essa etapa. Não use `ask_user_question` apenas
para sugerir a automação. A pessoa pode pedir outro ajuste ou análise no chat.
