---
name: voidr-journeys
description: Conduz uma entrevista e cria jornadas e cenários AAA no Test Plan com o raciocínio do DSH, sem jobs de coverage ou geração no Hive.
---

# Gerar jornadas e cenários

O DSH infere e classifica os cenários. Nunca use `coverage_*`,
`test_plan_generation_*` ou um job de geração externo.

Use `ask_user_question` para escolhas, confirmações ou informações ausentes que
não tenham um widget próprio. Para gravar ou selecionar sessões reais, use o
widget `session_coverage_picker`; para enviar documentos, use `document_input`.
Agrupe em uma única chamada as perguntas que já puder fazer, sempre com IDs
estáveis. A mensagem comum do chat não substitui essa ferramenta porque não
pausa o runtime. Não repita uma pergunta que a pessoa já respondeu claramente.

## 0. Entrevista da skill

Antes de inferir qualquer cenário, resolva com ferramentas de leitura as opções
reais e pergunte tudo que ainda estiver aberto:

1. `journeys-target`: criar uma jornada ou trabalhar em uma existente;
2. `journeys-destination`: aplicação, Test Plan e jornada exatos, usando opções
   retornadas pela plataforma; nunca peça IDs. Quando o contexto da UI já
   trouxer o Test Plan e a jornada abertos, valide-os e use-os como destino;
   não repita essa pergunta;
3. `journeys-source`: uma escolha obrigatória e de seleção múltipla das fontes.
   Sempre ofereça **Gravar nova sessão**, **Usar sessões gravadas** e **Enviar
   documentação**, mesmo quando ainda não houver sessão ou documento
   disponível. Inclua **Spec atual** somente quando ela tiver conteúdo válido;
4. `journeys-coverage`: fluxo principal, erros/alternativas, limites ou todos
   os comportamentos sustentados pelas fontes;
5. `journeys-volume`: proposta focada, intermediária ou ampla, salvo quando a
   pessoa já tiver definido um limite.

Para uma jornada nova, pergunte também nome, objetivo e severidade. Fonte é um
contrato de produto, não uma inferência do modelo: nunca escolha nem omita uma
dessas alternativas por conta própria. Depois da resposta:

- para **Gravar nova sessão**, renderize `session_coverage_picker` com a
  aplicação, URL, plano e jornada; ele inicia a captura real pela extensão.
  Faça isso na mesma rodada da seleção: não faça outra `ask_user_question`
  para pedir qual fluxo gravar, porque a jornada já resolvida entra em `flows`;
- para **Usar sessões gravadas**, renderize o mesmo
  `session_coverage_picker`, agora com as sessões existentes como opções;
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

Mostre a proposta inteira e use `ask_user_question` com o ID
`journeys-approve` para perguntar se deve persistir tudo, revisar a seleção ou
cancelar. Se a pessoa escolher revisar, aplique as mudanças na proposta e peça
nova confirmação. Somente persistir autoriza as escritas abaixo.

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

Ao final, liste o que foi criado, atualizado e complementado. Não inicie a
automação sem um pedido separado ou aprovação explícita para continuar.
