---
name: voidr-performance-execute
description: Prepara e executa carga confirmada de um cenário validado, acompanha o run e analisa relatórios, comparações e sessões impactadas.
---

# Executar e analisar carga

Esta é a etapa operacional que substitui o “deploy” dos testes Playwright: não há `deploy-latest` nem promoção DEV/LIVE de casos. O cenário tem uma versão publicada pela validação; executar cria uma PerformanceRun dessa versão. Use apenas aplicação API, ambiente e PerformancePlan nativo confirmados por leitura atual.

## Primeira execução

1. Exija `preflightRunId` aprovado para o `scenarioVersionId` exato. Se não existir ou falhou, volte a `voidr-performance-validate`; não prepare tráfego.
2. Use o perfil de carga solicitado. Para perfis por usuários virtuais, passe usuários e duração; para throughput, passe requisições por segundo e duração. Não misture os dois modelos nem aumente a carga pedida.
3. Se não houver PerformancePlan nativo para a versão publicada, use `performance_create_plan` e releia o ID criado. Chame `performance_prepare_run` com aplicação, plano, versão, preflight e ambiente. Mostre no chat o resumo retornado: destino, carga efetiva, volume estimado, sequência, métodos que alteram dados e expiração da confirmação. Pare e peça uma confirmação explícita única. Produção e alteração de dados devem ser nomeadas nessa mesma confirmação.
4. Apenas após a confirmação, envie `createRunInput` devolvido pelo prepare sem reconstruí-lo a `performance_create_run`, acrescentando somente as aprovações exigidas. Renderize `performance_execution_progress` com `performanceRunId` e eventual `performanceRunCode`; o widget acompanha o progresso. Não inicie outra carga por repetição de uma resposta ou refresh.

## Repetir somente a carga

Para reutilizar exatamente a versão e o ambiente de um run anterior, chame `performance_prepare_reexecution` com o ID de origem e apenas a carga alterada. Mostre o `confirmationSummary` e pare. Na confirmação seguinte, use `performance_reexecute_run` com a entrada preparada e apenas as aprovações necessárias; não reabra o cenário, não refaça o preflight e não aceite IDs ou ambiente substituídos pelo widget.

## Acompanhar e analisar

- Para status, use `performance_get_run` ou `performance_list_runs`. Não faça polling se o widget de progresso já estiver acompanhando.
- Para resultado concluído, use `performance_analyze_run` antes de interpretar saúde; `performance_get_run_report` fornece o relatório detalhado. Compare runs com `performance_compare_runs` e consulte `performance_list_impacted_sessions` antes de atribuir uma regressão a sessões específicas.
- Cancele com `performance_cancel_run` somente quando o usuário pedir. Não diga que um run passou por causa de um preflight verde ou de uma amostra pequena; informe quando o resultado for inconclusivo.

Se uma ferramenta faltar, informe qual etapa ficou indisponível. Não execute k6 no pod do DSH, não use as ferramentas de execução Playwright e não contorne o bloqueio com shell.
