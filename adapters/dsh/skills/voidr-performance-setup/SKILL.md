---
name: voidr-performance-setup
description: Seleciona e verifica a aplicação API, ambiente e contexto de Performance no DSH; encaminha autoria, validação, execução e análise às skills próprias.
---

# Preparar Voidr Performance

Esta é a entrada da surface `/performance` e de pedidos explícitos de teste de carga em outras telas. Um contexto da UI é uma dica, não prova de identidade ou permissão. PerformancePlan, PerformanceRun e PerformanceReport são próprios de carga; não use TestPlan, Execution ou o fluxo Playwright para substituí-los.

## Conversa para quem está começando

- Na tela Performance, um pedido genérico de criar testes é de carga, não de Playwright. Um simples cumprimento não autoriza criação nem execução; ofereça uma próxima ação curta.
- Escreva perguntas, opções e mensagens no idioma ativo da conversa/interface. Use nomes do produto do cliente e linguagem cotidiana: em pt-BR, “validação inicial” e “usuários simultâneos”. Não despeje IDs, nomes de ferramentas, campos do contrato ou termos internos.
- Descubra `applications_list_applications`, `applications_get_application` e `performance_resolve_context` por `system_search_tools`/`system_call_tool` quando não estiverem carregadas. Só declare indisponibilidade depois dessa descoberta e da leitura autorizada. Nunca peça um ID de 24 caracteres, UUID ou chave interna ao cliente. Falha de ferramenta não é lista vazia; explique a limitação real sem pedir credenciais nem trocar a organização.
- Resolva primeiro a aplicação com o seletor existente. Depois reutilize os dados e a intenção já fornecidos, sem perguntar tudo de novo. Não faça um formulário único de aplicação, requisição HTTP, ambiente e perfil de carga. Peça no máximo uma decisão de negócio realmente ausente por vez.
- Para escolher endpoint ou fluxo de teste, pergunte no texto normal do chat, nunca por `ask_user_question`, `request_user_input` ou formulário de `render_widget`. Sugira poucas ações apoiadas na documentação verificada e aceite resposta livre, inclusive combinar ações. Faça a pergunta uma vez, encerre o turno e aguarde a resposta pelo campo de mensagem, sem duplicá-la em formulário. Preserve o seletor de aplicação e os widgets de aprovação de validação/carga; escolher endpoint não autoriza tráfego.
- Se há um único ambiente configurado, resolva-o sem pergunta extra. Se há mais de um e nenhum foi escolhido, mostre nomes e URLs para escolher; não adivinhe o destino nem sua política.
- Um pedido de criar cenário segue para autoria; a escolha de aplicação não é autorização de tráfego. Não use formulário só para repetir o próximo passo nem opções vazias para uma pergunta de texto livre.
- Na autoria, filtros de URL têm o campo `query` na ferramenta `mcp__performance-authoring__author_performance_artifact`, inclusive em cada `requests[]`. `/api/v3/pet/findByStatus?status=available` vira `path: "/api/v3/pet/findByStatus"`, `query: { "status": "available" }`. A ferramenta também separa filtros enviados no `path`. Nunca declare que o filtro não é suportado nem troque o endpoint por esse motivo; se houver erro de caminho relativo seguro, confira essa separação.
- Login com credenciais no corpo JSON é suportado: use referências inteiras como `body: { "username": "{{secret.API_USERNAME}}", "password": "{{secret.API_PASSWORD}}" }`. A autoria gera a leitura direta do segredo no código, sem obter seu valor; não peça credenciais no chat nem substitua o login por produtos por esse motivo.

## Entrada sem aplicação definida

1. Chame `applications_list_applications` uma vez.
2. Mostre no `render_widget` com preset `performance_app_picker` todas e somente as aplicações cujo `type` persistido é `API`, inclusive quando há uma só. Se não houver nenhuma, envie `apps: []`; o widget oferece o cadastro de aplicação API. Não mostre WEB, MOBILE ou DESKTOP.
3. Pare após o widget. Não pergunte de novo no chat nem inicie um run.
4. Ao receber `action: performance_application`, releia a aplicação pelo ID escolhido. Se não for API, explique e reabra o seletor. Se receber `value: performance.new_api_app`, mostre `app_registration` para criar uma aplicação API; após o cadastro, confira o tipo persistido.

## Aplicação definida

1. Confirme a aplicação com `applications_get_application` e exija `type: API`.
2. Chame `performance_resolve_context { applicationId }` uma vez para obter ambientes, planos e cenários. Não invente um ambiente nem use um URL de outra aplicação.
3. Para um cenário novo ou uma alteração, carregue `voidr-performance-author` com o ID e o contexto confirmado. Para validar um rascunho, carregue `voidr-performance-validate`. Para iniciar, acompanhar, repetir ou analisar um run, carregue `voidr-performance-execute`.
4. Se o pedido for genérico, ofereça apenas ações possíveis com o contexto retornado. Sugira uma próxima ação direta no chat. Uma escolha estruturada de ambiente só cabe quando houver mais de um destino real e a decisão não puder ser inferida; a escolha de endpoint ou fluxo fica no texto normal do chat. Não dispare carga como efeito de selecionar uma aplicação.

## Resultado da validação inicial

Para validar ou tentar a validação novamente, siga `voidr-performance-validate`: chame `performance_validate_scenario` uma vez e renderize o `_ui.widget` retornado com os IDs da nova execução. Depois consulte `performance_get_preflight_result` para o mesmo `preflightRunId`, com `waitMs: 20000`, até `done: true`, por no máximo 3 minutos e 9 consultas. `pending`, `queued`, `running` e `done: false` não são falha nem aprovação. Não encerre só com “Disparando:” ou uma promessa: conclua com uma ou duas frases completas no idioma ativo dizendo o resultado confirmado ou que a validação ainda está em andamento e o painel continua acompanhando. Erro de leitura significa resultado não confirmado, não execução falha. Nunca crie outra tentativa, troque o endpoint ou prepare carga durante esse acompanhamento; não misture logs de um run anterior com o atual. Respeite `_ui.endTurn: true` quando realmente presente, sem presumir que a validação sempre o retorna.

## Limites de acesso

- Aplicações não API são inelegíveis mesmo quando o usuário as nomeia.
- Um PerformancePlan nativo não é um Test Plan de jornadas. Se não houver plano, a autoria começa pelo cenário; após publicação, a ferramenta pode criar o plano nativo necessário para a execução.
- Nunca solicite credenciais em chat. Use somente o contexto autenticado da organização e as ferramentas autorizadas pelo Service.
- Se a ferramenta de uma etapa não estiver disponível, reporte essa lacuna; não troque para comandos manuais ou para o agente legado do Hive.
