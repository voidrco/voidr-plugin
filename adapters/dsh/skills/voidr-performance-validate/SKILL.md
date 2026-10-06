---
name: voidr-performance-validate
description: Valida a versão de um cenário de carga no DSH e faz o preflight de uma iteração antes de permitir tráfego final.
---

# Validar cenário de carga

Use esta skill para `action: validate` no editor ou um pedido explícito de validação. Confirme os IDs de aplicação API e cenário recebidos do editor ou por leitura atual; não use um ID lembrado de conversa antiga.

1. Chame `performance_validate_scenario` uma única vez para este pedido, com os campos exigidos. Ela valida, publica uma versão imutável e inicia um preflight de uma iteração; pode retornar antes de ele terminar. Não chame `performance_publish_scenario` nem crie outro preflight para consultar o resultado.
2. Renderize imediatamente o `_ui.widget` retornado, preservando seu ID, preset e dados, para substituir o acompanhamento anterior pelo da nova execução. Não componha outro painel nem reutilize o ID de um run antigo. Se houver de fato `_ui.endTurn: true`, respeite-o: não chame outra ferramenta e informe apenas o estado comprovado, sem inventar um resultado.
3. Se ainda estiver `pending`, `queued` ou `running`, diga uma frase completa no idioma ativo: “A validação inicial começou. Estou aguardando o resultado; o teste de carga ainda não foi iniciado.” Consulte `performance_get_preflight_result` com o `preflightRunId` retornado e `waitMs: 20000` até `done: true`, por no máximo 3 minutos e 9 consultas. Essa leitura não inicia outra execução. Pare antes em erro de leitura ou ferramenta indisponível; não use shell nem outra tentativa como substituto.
4. Confira o `preflightRunId` e o `scenarioVersionId` de cada resultado. Não misture resultado anterior com a tentativa atual. `done: false` não é aprovação nem falha. Se o limite de espera acabar, conclua: “A validação inicial ainda está em andamento. O painel continua acompanhando; o teste de carga ainda não foi iniciado.” Se a leitura falhar, diga que não conseguiu confirmar o resultado, não que a execução falhou. O widget acompanha automaticamente a execução vinculada; não o sobrescreva com histórico antigo.
5. Ao terminar, conclua com uma ou duas frases completas: aprovação, ou falha com método, caminho, status e evidência disponíveis. Não encerre com “Disparando:” nem com uma promessa de ação futura já realizada. Um status HTTP com resposta é evidência do endpoint; ausência de status não prova erro do endpoint nem tráfego zero. Não atribua uma rejeição de política à confirmação de mutação sem evidência específica. A coluna de caminho sem `?` não prova filtro ausente: confira o `query` da versão exata.
6. Se falhar, ofereça a correção apoiada nos logs via `voidr-performance-author`, sem alterar o cenário, trocar endpoint ou repetir automaticamente. Somente `done: true` e `passed: true` para a versão exata permitem avançar a `voidr-performance-execute` em outra etapa. Um preflight verde comprova que a sequência funciona uma vez; não comprova capacidade sob carga. Nunca prepare carga neste turno de validação.

Salvar o rascunho, publicar a versão e executar o preflight não exigem confirmação adicional. Isso não autoriza o teste de carga final. Não use a validação SHADOW de Playwright ou `assistant_workspace_deploy_latest` neste domínio.
