---
name: voidr-performance-validate
description: Valida a versão de um cenário de carga no DSH e faz o preflight de uma iteração antes de permitir tráfego final.
---

# Validar cenário de carga

Use esta skill para `action: validate` no editor ou um pedido explícito de validação. Confirme os IDs de aplicação API e cenário recebidos do editor ou por leitura atual; não use um ID lembrado de conversa antiga.

1. Chame somente `performance_validate_scenario` com os campos exigidos pela ferramenta. Ela valida, publica uma versão imutável e acompanha um preflight de uma iteração. Não chame `performance_publish_scenario`, um segundo preflight ou polling manual em seguida.
2. Apresente os achados e o editor atualizado retornados. Se `_ui.endTurn: true`, pare imediatamente.
3. Se falhar, indique método, caminho, status e evidência disponíveis; devolva à edição via `voidr-performance-author`. Não trate falha estrutural como prova de falha do endpoint, nem diminua o cenário pedido.
4. Somente `preflight.passed: true` para a versão exata permite avançar a `voidr-performance-execute`. Um preflight verde comprova que a sequência funciona uma vez; não comprova capacidade sob carga.

Salvar o rascunho, publicar a versão e executar o preflight não exigem confirmação adicional. Isso não autoriza o teste de carga final. Não use a validação SHADOW de Playwright ou `assistant_workspace_deploy_latest` neste domínio.
