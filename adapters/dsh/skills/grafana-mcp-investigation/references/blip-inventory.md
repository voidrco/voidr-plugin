# Grafana MCP · Blip — inventário observado em 20/10/2026

Leitura feita pelo conector ativo `blip-grafana-mcp`. É um ponto de partida, não um catálogo imutável. Confira o conector ativo e o UID da fonte no turno atual.

## Fontes e escopo

`list_datasources` encontrou 163 fontes: 22 Prometheus, 58 Loki, 20 Tempo, 12 Pyroscope, 49 MSSQL, 1 Azure Monitor e 1 Sentry. As fontes Prometheus/Loki/Tempo são separadas por células ou produtos como Packs, Take, Bots, Firehose e Payments. O Prometheus-Take aparece como padrão no Grafana; isso não o torna correto para outra célula.

Exemplo confirmado para Packs:

| Tipo | Fonte | UID observado |
| --- | --- | --- |
| métricas | Prometheus-Packs | `fdlotcuxyvu2od` |
| logs | Loki-Packs | `fdn6yupqtb4e8a` |
| traces | Tempo-Packs | `edn6zwrcl5bswa` |

Para outro produto, use `list_datasources` com `type=prometheus` ou `type=loki` e selecione por vínculo verificado com o serviço. Não transfira métricas entre células por coincidência de nome.

## Dashboards como índice de consultas

`search_dashboards({query:"Packs"})` retornou 9 itens, entre eles `Packs Logs`, `Team Metrics - Packs Platform` e `Packs Platform - Resource Usage & HPA Dashboard (Enhanced)` (`uid=packs-resources-hpa`). O último usa `Prometheus-Packs`, variáveis `namespace`, `app` e `DS_PROMETHEUS`, e inclui consultas de HPA, rede, reinícios e recursos. `get_dashboard_summary` resumiu 3 painéis de topo, enquanto `get_dashboard_panel_queries` devolveu 29 consultas incluindo painéis aninhados: use esta segunda ferramenta para localizar a expressão real. Exemplo verificado: o painel `Container Restarts` consulta `kube_pod_container_status_restarts_total{namespace="$namespace", pod=~"$app.*"}`.

Para investigação geral, procure dashboard pelo nome do serviço ou sintoma, confira `get_dashboard_summary`, depois extraia apenas os painéis necessários com `get_dashboard_panel_queries`. Substitua variáveis com valores descobertos na fonte, não por nomes adivinhados. Use `run_panel_query` para executar o painel escolhido no intervalo pedido.

## Ferramentas remotas úteis

- Catálogo e visual: `list_datasources`, `search_dashboards`, `get_dashboard_summary`, `get_dashboard_panel_queries`, `run_panel_query`, `generate_deeplink`.
- Métricas: `list_prometheus_metric_names`, `list_prometheus_label_names`, `list_prometheus_label_values`, `query_prometheus`, `query_prometheus_histogram`.
- Logs: `list_loki_label_names`, `list_loki_label_values`, `query_loki_stats`, `query_loki_logs`, `search_logs`.
- Alertas e operação: `alerting_manage_rules` (operações de leitura `list/get/versions`), `get_annotations`, `list_incidents`, `get_incident`, `list_alert_groups`, `get_alert_group`.

O MCP expôs 46 ferramentas nessa leitura. As demais cobrem OnCall, dashboards, Pyroscope, Sift, Elasticsearch, imagens e metadados. Seus schemas e capacidades são descobertos pelo `custom_connectors_list_mcp_tools`; esta referência não autoriza uma ferramenta pelo nome ou pela anotação antiga.
