# Atraso de processamento: broker, consumo e escala

Leia quando o caso envolver campanhas represadas, filas, `Enviando`, `NOT_PROCESSED` ou atraso de mensagem/notificação. Antes de concluir diagnóstico, normalidade ou falta de acesso, cruze **backlog/entrada → consumo → HPA** na mesma janela absoluta e no escopo do incidente. Uma perna inacessível vira lacuna explícita; mantenha parcial a conclusão que depende dela. Este roteiro não altera os portões causais nem autoriza mudanças de produção.

## Resolver as fontes dentro do conector autorizado

Descubra ferramentas/schema e inventarie datasources com paginação; use os UIDs retornados. Na Blip, as métricas Confluent Cloud normalmente estão centralizadas em **Prometheus-LGTM**, enquanto runtime/consumidores e Kubernetes ficam no **Prometheus da célula investigada**. Esses nomes são pistas de navegação, não prova de cobertura ou identidade física.

Uma consulta `kafka_consumergroup_*` vazia na célula não prova ausência de backlog, retenção vencida ou falta de acesso ao broker. Verifique o LGTM autorizado e a família `confluent_kafka_server_*`, com nomes, labels e metadados observados. Essa resolução de datasources no mesmo conector não permite substituir outro conector, contornar uma negativa de permissão ou ignorar restrição explícita de fonte.

Resolva `kafka_id`, `topic` e `consumer_group_id` pelos logs/configuração do caminho investigado e pelos labels retornados. Não fixe UIDs, cluster, prefixo `prod` ou grupo de outro ticket. Verifique separadamente a célula do workload e o cluster Kafka; um grupo pode ser compartilhado entre tópicos de várias células.

## Leituras que sustentam a comparação

Use consultas delimitadas, em sequência, pelo dispatcher de leitura e schema anunciados. Em `query_prometheus`, respeite `startTime`/`endTime`; em Loki, `startRfc3339`/`endRfc3339`. Exemplos abaixo são famílias candidatas: confirme sua existência e seus labels antes de formular seletores.

| Perna | Séries e verificações |
| --- | --- |
| Broker no LGTM | `confluent_kafka_server_consumer_lag_offsets` por cluster/tópico/grupo; `confluent_kafka_server_received_records` por tópico; `confluent_kafka_server_max_pending_rebalance_time_milliseconds` por grupo, quando disponível. |
| Consumo na célula | `iris_consumers_consumed_items_total` do consumidor correspondente; `iris_producer_consumer_inflight_items` e labels de limites carregados `producer_throughput`/`consumer_throughput`, quando expostos. Taxa, concorrência e capacidade local são medidas diferentes. |
| HPA efetivo | Séries `kube_horizontalpodautoscaler_*`: `spec_min_replicas`, `spec_max_replicas`, `spec_target_metric`, `status_current_replicas`, `status_desired_replicas`, `status_target_metric`, `status_condition`. Correlacione CPU e, quando relevante, identidade/imagem, início e restart dos pods. |

Leia os descritores/metadados, não copie cegamente a query de um dashboard:

- `received_records` e `sent_records` podem ser **gauges com contagem delta por amostra de 60 segundos**. Converta por esse intervalo somente quando o descritor confirmar; não aplique `rate()` ao gauge. Para o contador cumulativo de consumo, aplique `rate()` antes de agregar.
- `sent_records` pode incluir tentativas malsucedidas e não mede os commits/sucessos desse grupo. Lag em offsets não é idade da mensagem; fila interna vazia não demonstra broker vazio.
- Compare entrada e consumo com unidade, resolução e intervalo explícitos. Uma contagem por minuto e uma média móvel de cinco minutos não são medidas instantâneas equivalentes. Preserve amostras ausentes, repetidas e limites de scrape; não integre contagens delta repetidas sem conhecer a cadência da fonte.
- Amostras não zero de rebalanceamento não são eventos distintos nem duração total de indisponibilidade. Sinal de grupo compartilhado não identifica célula, membro ou causa de join/leave. Sem assignment/partição/offset, não explique a espera individual apenas pelo lag agregado.

## Testar a formação e a persistência do acúmulo

Na retenção disponível, localize uma baseline compatível antes do sintoma e o primeiro crescimento do backlog. Compare a sequência entrada/consumo/lag com a decisão do HPA. Registre datasource, seletores, janela/fuso, unidades, resolução e cobertura por perna; não converta o início de um bucket em timestamp exato de evento.

CPU baixa não refuta backlog em um consumidor limitado por taxa ou espera. `ScalingLimited=true` não prova que atingiu o máximo: confronte réplicas atuais/desejadas, mínimo, máximo e tipo/alvo da métrica. Uma queda do máximo configurado não explica o caso se a escala permaneceu abaixo dos dois tetos. HPA saudável pode permanecer no mínimo enquanto o lag cresce se sua decisão usa apenas CPU.

Diferencie configuração observada em métricas/logs do processo, estado histórico do HPA, manifesto GitOps e defaults da revisão de código correspondente. Limites exportados não confirmam automaticamente tasks, capacidade, intervalos, assignment ou todo o appsettings. Não peça acesso amplo ao Azure ou chave do bot quando essas leituras já permitem testar a hipótese; uma lacuna exige o dado e a operação mínimos que a resolveriam.

## Portão de conclusão

Siga os mesmos IDs de bot/campanha/mensagem em `recebimento → enqueue → processamento → envio → notificação → persistência/projeção de status`. Confirme se o atraso é da entrega ou da atualização de estado. Não use texto de tela, intervalo entre datas de um CSV ou status posterior como prova automática de espera no broker.

Antes de congelar o diagnóstico, registre para cada perna os resultados ou a lacuna exata e confronte as hipóteses com código/configuração da versão observada. Backlog confirma pendência nesse consumo, não saturação/defeito do Kafka. Rajada, limite e mudança de escala isolados não provam o defeito iniciador. Separe mecanismo sustentado de gatilho/origem ainda desconhecidos; para atribuição individual podem faltar partição/offset, enqueue/dequeue, espera no limitador, retry, assignment e ack/commit.

O APM pode unir esses marcos quando emitidos; não cria histórico nem contexto de fila ausentes. Validação de variáveis do Builder não comprova cobertura de atrasos de processamento. Não reinicie consumidores, altere HPA/limites, force rebalanceamento ou ative coleta durante uma investigação somente leitura.

Semântica de referência: [lag e rebalanceamento Confluent](https://docs.confluent.io/cloud/current/monitoring/monitor-lag.html) e [modelo de métricas Confluent](https://api.telemetry.confluent.cloud/docs/api.yaml). Os descritores da fonte consultada determinam a interpretação efetiva.
