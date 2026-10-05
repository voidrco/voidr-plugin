---
name: voidr-performance-author
description: Implementa ou edita cenários de carga de aplicações API no DSH, produzindo um artefato isolado e abrindo o editor de cenário.
---

# Implementar cenário de carga

Carregue `voidr-performance-setup` para resolver a aplicação se ela ainda não estiver confirmada. Use somente aplicações com `type: API` e o ambiente selecionado. Releia `performance_resolve_context` neste turno; use `applications_get_api_contract` quando a estrutura das requisições for nova ou mudar.

## Autoria sem questionário técnico

1. Reutilize o que o cliente já informou: aplicação, destino, fluxo e intensidade. Leia a documentação da API antes de pedir detalhes que ela já contém. Descubra `applications_get_api_contract` por `system_search_tools`/`system_call_tool` se não estiver carregada; uma falha de acesso não prova ausência de documentação.
2. Se falta escolher o fluxo, faça apenas uma pergunta simples, no idioma ativo: “O que você quer testar?”. Ofereça ações de negócio apoiadas na documentação, como consultar produtos ou entrar na conta, somente se existirem. Não pergunte “qual requisição HTTP?” nem peça IDs, JSON, métodos ou caminhos internos como requisito para começar. Sem documentação, peça o link da documentação ou um exemplo de URL; não invente endpoints nem escreva opções vazias para texto livre.
3. Se a intensidade não foi definida, proponha um primeiro rascunho pequeno: um usuário simultâneo por um minuto. Explique que isso é uma proposta editável, não uma execução. Não exija escolher smoke/ramp/spike/throughput, VUs ou RPS para criar o primeiro rascunho. Preserve uma carga explicitamente solicitada, sem substituí-la por esse exemplo. Os controles avançados continuam no editor.
4. Pergunte no máximo uma decisão de negócio realmente ausente por vez, com opções concretas. Nunca reúna aplicação, requisição, ambiente e perfil num questionário técnico. Se os dados já bastam e a autoria foi solicitada, continue a implementação sem uma confirmação redundante de criação.
5. Cadastro, escolha do fluxo e criação de rascunho não autorizam tráfego. Preserve as confirmações próprias de validação inicial, destino/carga, mutações e aprovação de produção antes de executar. Nunca derive autorização de execução das escolhas de autoria.

## Cenário existente

Compare método, caminho e ordem de captura com `performance_get_scenario`; nome igual não prova equivalência. Se o cenário já corresponder ao pedido, chame `performance_open_scenario` e apresente o editor retornado. Se a resposta marcar `_ui.endTurn: true`, pare sem outra ferramenta.

## Cenário novo ou alterado

1. Monte a sequência completa de `requests[]` a partir do pedido, do contrato da API ou de evidência sanitizada. Preserve cada endpoint solicitado. Use IDs estáveis para as requisições; capture respostas com JSON Pointer e referencie capturas posteriores por `{{step.REQUEST_ID.CAPTURE_NAME}}`.
2. Chame `mcp__performance-authoring__author_performance_artifact` com `scope.applicationId`, `scenario` e, para edição, `scenarioId` e `expectedVersion`. A ferramenta monta, verifica e envia o artefato em workspace isolado.
3. Com o `draftArtifactId` e `completionToken` retornados, chame `mcp__performance-authoring__apply_performance_artifact` para salvar o rascunho. Use `scenarioId` e `expectedVersion` na edição. Apresente somente o editor retornado e pare quando `_ui.endTurn: true`.
4. Não chame também `performance_create_scenario` ou `performance_update_scenario`: o apply já faz a escrita. Se falhar, use o diagnóstico para corrigir a proposta inteira; não reduza silenciosamente as requisições.

Código e configuração completos ficam no workspace isolado e no editor autenticado. Não os imprima no chat, widget, URL ou logs. Nunca inclua valores reais de segredos nos corpos ou cabeçalhos; use referências às secrets do ambiente. A criação do rascunho não autoriza validar nem executar carga. O próximo passo é `voidr-performance-validate`, quando o usuário o pedir ou acionar a validação no editor.
