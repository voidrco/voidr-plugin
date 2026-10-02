---
name: voidr-performance-setup
description: Seleciona e verifica a aplicação API, ambiente e contexto de Performance no DSH; encaminha autoria, validação, execução e análise às skills próprias.
---

# Preparar Voidr Performance

Esta é a entrada da surface `/performance` e de pedidos explícitos de teste de carga em outras telas. Um contexto da UI é uma dica, não prova de identidade ou permissão. PerformancePlan, PerformanceRun e PerformanceReport são próprios de carga; não use TestPlan, Execution ou o fluxo Playwright para substituí-los.

## Entrada sem aplicação definida

1. Chame `applications_list_applications` uma vez.
2. Mostre no `render_widget` com preset `performance_app_picker` todas e somente as aplicações cujo `type` persistido é `API`, inclusive quando há uma só. Se não houver nenhuma, envie `apps: []`; o widget oferece o cadastro de aplicação API. Não mostre WEB, MOBILE ou DESKTOP.
3. Pare após o widget. Não pergunte de novo no chat nem inicie um run.
4. Ao receber `action: performance_application`, releia a aplicação pelo ID escolhido. Se não for API, explique e reabra o seletor. Se receber `value: performance.new_api_app`, mostre `app_registration` para criar uma aplicação API; após o cadastro, confira o tipo persistido.

## Aplicação definida

1. Confirme a aplicação com `applications_get_application` e exija `type: API`.
2. Chame `performance_resolve_context { applicationId }` uma vez para obter ambientes, planos e cenários. Não invente um ambiente nem use um URL de outra aplicação.
3. Para um cenário novo ou uma alteração, carregue `voidr-performance-author` com o ID e o contexto confirmado. Para validar um rascunho, carregue `voidr-performance-validate`. Para iniciar, acompanhar, repetir ou analisar um run, carregue `voidr-performance-execute`.
4. Se o pedido for genérico, ofereça apenas ações possíveis com o contexto retornado. Sugira uma próxima ação direta no chat; use escolha estruturada somente quando houver mais de um destino real e a decisão não puder ser inferida. Não dispare carga como efeito de selecionar uma aplicação.

## Limites

- Aplicações não API são inelegíveis mesmo quando o usuário as nomeia.
- Um PerformancePlan nativo não é um Test Plan de jornadas. Se não houver plano, a autoria começa pelo cenário; após publicação, a ferramenta pode criar o plano nativo necessário para a execução.
- Nunca solicite credenciais em chat. Use somente o contexto autenticado da organização e as ferramentas autorizadas pelo Service.
- Se a ferramenta de uma etapa não estiver disponível, reporte essa lacuna; não troque para comandos manuais ou para o agente legado do Hive.
