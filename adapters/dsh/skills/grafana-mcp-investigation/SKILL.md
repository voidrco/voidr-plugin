---
name: grafana-mcp-investigation
description: Investiga métricas, logs, dashboards, alertas e incidentes pelo Grafana MCP da organização autenticada. Use para perguntas sobre telemetria atual ou histórica; em threads do Radar, parte da anomalia salva antes de buscar dados novos.
---

# Investigar pelo Grafana MCP

Use somente as ferramentas autenticadas da organização. Um dashboard, um alerta e um resumo do Radar podem orientar a busca, mas cada afirmação sobre o período pedido precisa de uma leitura que cubra esse período. Para o inventário observado na Blip, leia [blip-inventory.md](references/blip-inventory.md) somente quando estiver nessa organização; confirme os UIDs antes de usá-los, pois fontes e painéis podem mudar.

## Comece pelo alvo da pergunta

Identifique produto ou serviço, ambiente/célula, objeto (pod, operação, bot, endpoint ou ticket), métrica ou sintoma, período e fuso. Preserve identificadores exatos vindos do usuário ou de uma ferramenta. Se faltar um identificador que muda a fonte ou a conclusão, faça uma busca pequena por dashboard ou fonte; peça esclarecimento apenas se a ambiguidade persistir.

Em uma thread de anomalia, leia primeiro `mcp__voidr__preventive_monitor_get_radar_situation` com o ID confiável da thread. `signals`, `decisionCriteria`, `lastObservedAt` e os recibos no texto dos sinais mostram o que o Radar observou e onde procurar. Responda diretamente desse registro quando a pergunta for sobre o caso salvo. Para “agora”, evolução posterior ou evidência não presente, use o registro como mapa e faça uma leitura nova no Grafana. `lastObservedAt` e `signals[].observedAt` não são amostras atuais nem uma série por timestamp. Se o relatório tiver uma janela agregada, não atribua seus valores a instantes individuais.

## Descubra e leia com pouco contexto

1. Use `mcp__voidr__custom_connectors_list` para localizar um conector ativo `adapter=mcp` com capacidade Grafana. Não escolha um conector coletado, bloqueado ou de outra organização só por semelhança de nome. Reutilize o conector já identificado no turno.
2. Faça `mcp__voidr__custom_connectors_list_mcp_tools` uma vez para conferir nomes, schemas e `annotations.readOnlyHint`. Se a lista for enviada a um artifact, leia apenas a pequena página de `$.tools` que contenha a ferramenta desejada; o mapa abaixo dá o nome a procurar. Não pesquise repetidamente as 46 descrições inteiras.
3. Execute apenas operações declaradas de leitura por `mcp__voidr__custom_connectors_read_mcp_tool`, com o schema descoberto. A proteção do Service valida a operação novamente. Não use `execute_mcp_tool` para investigar. Se o schema ou a capacidade não existir, relate essa limitação; não tente shell, API direta ou outra identidade.

Escolha a rota que responde à pergunta:

| Pergunta | Descoberta curta | Leitura principal |
| --- | --- | --- |
| Qual dashboard ou painel acompanha o serviço? | `search_dashboards` por produto/componente, `get_dashboard_summary` | `get_dashboard_panel_queries` para saber fonte, expressão e variáveis; `run_panel_query` para os painéis escolhidos |
| Qual é o valor atual ou a tendência de uma métrica? | `list_datasources` filtrada por `prometheus`; quando necessário `list_prometheus_metric_names` e `list_prometheus_label_values` | `query_prometheus` com `queryType=instant` para o corte atual ou `range` com início, fim e passo para a evolução |
| O que aparece nos logs? | `list_datasources` filtrada por `loki`; confirme labels com `list_loki_label_names`/`list_loki_label_values` e volume com `query_loki_stats` se necessário | `query_loki_logs` com selector, janela e limite estreitos; `search_logs` apenas para busca textual localizada |
| Um alerta está disparando ou qual foi a regra? | `alerting_manage_rules` com `operation=list` e filtros | `operation=get` para a regra pertinente; `list_alert_groups` e `get_alert_group` são do OnCall, não substituem o estado da regra |
| Qual incidente ou anotação foi registrado? | `list_incidents` ou `get_annotations` filtrados | `get_incident` ou anotação específica; compare horário e escopo com a telemetria |

Prefira uma consulta de painel existente quando ela corresponde ao serviço, ambiente e período. Verifique suas variáveis e datasource antes de executá-la. Caso contrário descubra nomes de métricas e labels antes de escrever PromQL ou LogQL. Nunca assuma que o datasource padrão representa o serviço pedido. Um resultado vazio numa fonte não prova ausência de falha em outra célula, fonte ou intervalo.

O conector pode listar fontes Tempo e Pyroscope sem oferecer uma ferramenta de consulta de traços equivalente. Descubra a capacidade real antes de afirmar que inspecionou um trace. Não transforme um link de dashboard ou uma imagem de painel em medição confirmada.

## Entrega

Comece com a resposta à pergunta. Mostre fonte, datasource/painel, janela e fuso, instante da consulta quando a pergunta for sobre “agora”, e a cobertura observada. Separe valor medido, interpretação e hipótese. Se a leitura ao vivo falhar, diga que não foi possível confirmar o estado atual; informe o último dado salvo com seu horário apenas como referência. Para gráficos, use somente pontos retornados pela ferramenta e preserve unidade, labels e timestamps. Não invente pontos, resultado de query ou confirmação de impacto.
