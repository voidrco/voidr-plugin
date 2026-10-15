# Atraso: seguir a fila antes de perseguir stacks

Use para processamento lento, mensagens em espera ou status `Enviando`/pendente apesar de despacho. Não pressupõe Kafka nem uma causa conhecida. O ticket fornece somente relato, identificadores e horários iniciais.

1. Reuse o preflight e os catálogos válidos da sessão. Resolva uma mensagem/campanha e compare criação/entrada → despacho/recebimento → consumo da notificação → persistência do estado. Preserve produtor e consumidores como saltos distintos; registrar publicação não prova confirmação do broker.
2. Resolva tópico/grupo/célula a partir dos recibos e configuração. Cruze entrada, consumo e backlog antes de perseguir um erro SQL, Kafka ou rede encontrado perto do sintoma. Descubra também **Prometheus-LGTM**: as métricas Confluent podem estar nele, separadas das métricas de aplicação. Uma consulta vazia no Prometheus da aplicação não esgota o broker. Se disponíveis, consulte `confluent_kafka_server_received_records`, `confluent_kafka_server_consumer_lag_offsets` e o contador de consumo correspondente, com os filtros efetivamente descobertos.
3. Compare baseline, formação, equilíbrio e alívio em blocos alinhados. Preserve amostras ausentes, divergências, resets, unidade e semântica. O contador interno de um consumidor não representa necessariamente a entrada no broker. Não confunda gauge em voo com backlog de offsets; não compare soma de vários pods a uma capacidade por instância.
4. Cruze réplicas, HPA atual/desejado, sinal de decisão e limites exportados. CPU baixa e HPA estável não descartam espera por fila. No código histórico, leia somente o caminho necessário para interpretar publicação, consumo, commit, atualização e tratamento de erro.
5. Só aprofunde uma stack concorrente se ela tiver vínculo com o fluxo, preceder a formação e explicar os dados melhor que a hipótese de fila. Use baseline e sucesso contemporâneo como contraprova. A varredura ampla de onset é condicional quando o balanço não explica o sintoma ou há evidência de falha comum; não precede obrigatoriamente essa primeira análise.

## Coleta finita e entrega

O runtime encerra o início de novas consultas externas após **8 minutos ou 40 chamadas**, o que vier primeiro; chamadas em andamento, tempo do modelo e renderização podem ultrapassar esse intervalo. Aos 6 minutos ou 32 chamadas, use o restante apenas para uma contraprova e o trecho de código que possa mudar a conclusão. Os limites independentes de busca e leitura de código continuam válidos.

Ao sustentar a fronteira operacional, ou atingir o limite, congele: achado e confiança; escopo/janela; recibos primários; contradições; lacunas por afirmação. Sem vínculo suficiente, congele diagnóstico parcial. O limite nunca autoriza inventar causalidade, completar amostra ausente ou pedir acesso para evitar uma entrega parcial. Não crie outra sessão/goal/dispatcher para recomeçar o orçamento.

Carregue `voidr-evidence-report` como **continuação de apresentação**, preservando modelo, organização, histórico, IDs dos recibos e achados. Leia contrato/design e componha o PDF; não refaça preflight, inventários, baseline ou investigação. Reutilize os recibos para cálculos. Falha de geração exige reparar o contrato/artefato existente; não trocar de modelo nem coletar novamente. Nunca anuncie PDF entregue antes de `ready` e confirmação de entrega exigida pelo transporte.
