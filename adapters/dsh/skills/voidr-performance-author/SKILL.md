---
name: voidr-performance-author
description: Implementa ou edita cenários de carga de aplicações API no DSH, produzindo um artefato isolado e abrindo o editor de cenário.
---

# Implementar cenário de carga

Carregue `voidr-performance-setup` para resolver a aplicação se ela ainda não estiver confirmada. Use somente aplicações com `type: API` e o ambiente selecionado. Releia `performance_resolve_context` neste turno; use `applications_get_api_contract` quando a estrutura das requisições for nova ou mudar.

## Cenário existente

Compare método, caminho e ordem de captura com `performance_get_scenario`; nome igual não prova equivalência. Se o cenário já corresponder ao pedido, chame `performance_open_scenario` e apresente o editor retornado. Se a resposta marcar `_ui.endTurn: true`, pare sem outra ferramenta.

## Cenário novo ou alterado

1. Monte a sequência completa de `requests[]` a partir do pedido, do contrato da API ou de evidência sanitizada. Preserve cada endpoint solicitado. Use IDs estáveis para as requisições; capture respostas com JSON Pointer e referencie capturas posteriores por `{{step.REQUEST_ID.CAPTURE_NAME}}`.
2. Chame `mcp__performance-authoring__author_performance_artifact` com `scope.applicationId`, `scenario` e, para edição, `scenarioId` e `expectedVersion`. A ferramenta monta, verifica e envia o artefato em workspace isolado.
3. Com o `draftArtifactId` e `completionToken` retornados, chame `mcp__performance-authoring__apply_performance_artifact` para salvar o rascunho. Use `scenarioId` e `expectedVersion` na edição. Apresente somente o editor retornado e pare quando `_ui.endTurn: true`.
4. Não chame também `performance_create_scenario` ou `performance_update_scenario`: o apply já faz a escrita. Se falhar, use o diagnóstico para corrigir a proposta inteira; não reduza silenciosamente as requisições.

Código e configuração completos ficam no workspace isolado e no editor autenticado. Não os imprima no chat, widget, URL ou logs. Nunca inclua valores reais de segredos nos corpos ou cabeçalhos; use referências às secrets do ambiente. A criação do rascunho não autoriza validar nem executar carga. O próximo passo é `voidr-performance-validate`, quando o usuário o pedir ou acionar a validação no editor.
