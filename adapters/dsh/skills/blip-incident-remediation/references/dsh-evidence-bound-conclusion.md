# Concluir no nível comprovado

Leia antes de declarar bloqueio, pedir novos insumos ou encerrar a investigação. O diagnóstico operacional, a origem provável e a causa raiz técnica têm exigências distintas. A falta do defeito iniciador não apaga uma fronteira de falha demonstrada.

## Decidir por afirmação

Registre para cada conclusão: afirmação, nível, escopo/janela, evidências que a sustentam, contradições e limite. Só conclua uma fronteira com identidade histórica resolvida, sinais primários compatíveis com o sintoma e vínculo sustentado com o impacto. Inventário, topologia atual ou correlação isolada não bastam. A prova do defeito iniciador continua obrigatória para chamar algo de causa raiz.

Classifique cada lacuna pela consequência:

- **Decisiva para a afirmação:** o dado pode refutar o mecanismo, mudar a fronteira/escopo, distinguir hipóteses ainda equivalentes que levam a intervenções diferentes, ou sustentar a granularidade explicitamente pedida. Consulte a fonte autorizada discriminante; se indisponível, limite essa afirmação e explique a consequência.
- **De refinamento:** detalha a origem do defeito, contribuição individual ou minutos exatos sem mudar a conclusão operacional já sustentada. Registre-a junto da afirmação afetada e entregue o diagnóstico operacional. Não transforme esse refinamento em bloqueio global nem em requisito de novos acessos.

A mesma lacuna pode ser decisiva para causa raiz e apenas de refinamento para o diagnóstico operacional. Se o usuário pede a decomposição exata, informe que essa parte permanece não determinada; não prometa completá-la usando só métricas agregadas. Não chame evidência ausente de irrelevante sem explicar qual afirmação ela poderia mudar.

Reutilize recibos primários completos e sua proveniência antes de repetir consultas. Faça novas leituras quando houver lacuna material, contradição ou cobertura insuficiente. Um backend disponível não exige varredura se a operação não distingue uma hipótese material dentro do escopo; registre a justificativa. Não ignore evidência contrária acessível nem interrompa trabalho discriminatório já autorizado ao publicar um checkpoint.

## Filas e atraso de processamento

Resolva fluxo, produtor, consumidores, tópico/grupo, célula física e vínculo do evento do ticket. Compare entrada, consumo e backlog ao longo do tempo, com baseline, formação, equilíbrio, alívio e nova subida quando existirem. Explore essas variações naturais antes de exigir experimentos ou instrumentação nova.

- Valide o tipo/unidade de cada métrica: contador, gauge, delta por intervalo, offset ou idade. Não aplique rate a uma contagem delta exportada como gauge.
- Alinhe janela, bucket, escopo e tempo de avaliação. Em blocos consecutivos de cinco minutos, por exemplo, entrada pode ser a soma de cinco deltas de 60s dividida por 300, e consumo o rate de cinco minutos avaliado no fim do bloco. Isso requer amostras completas e sem duplicação de séries; não preencha buracos com zero.
- Não some taxas de janelas móveis sobrepostas como volume. Valide duplicação de séries, resets, amostragem, atrasos de exportação e a semântica do contador no código quando disponível. Contador da aplicação pode não representar sucesso de negócio nem commit Kafka.
- Confronte o sinal do saldo entrada menos consumo com a variação do backlog. Preserve janelas divergentes e resíduos; não ajuste deslocamentos temporais para melhorar o encaixe. Não selecione apenas os períodos favoráveis.
- Lag calculado a partir do offset confirmado e do high watermark não equivale exatamente a itens pendentes. Prefetch, commits e relógios de exportação podem impedir uma contabilidade fechada. O saldo é referência explicativa enquanto essa equivalência não for demonstrada.
- Cruze réplicas atuais/desejadas, entrada de decisão do HPA, limites exportados, throughput por instância e idade das notificações. CPU baixa não elimina gargalo; teto configurado não é teto atingido. Um HPA que não expande é observado; a eficácia de aumentar pods continua uma hipótese até validação.
- Conte repetição por chave de negócio e janela inteira ou partições disjuntas. Diferencie tentativa de publicação, confirmação do broker e consumo efetivo. Repetição é amplificador até prova de sua contribuição; sua existência no baseline impede tratá-la como defeito surgido apenas na rajada.

Crescimento quando entrada supera consumo, estabilização quando se aproximam e redução quando o consumo supera entrada sustentam descompasso operacional se ligados ao impacto. Não exigem conhecer cada offset para concluir essa fronteira. Não provam falha interna do broker, culpa do cliente, limitador específico, eficácia de uma correção ou causa raiz técnica.

Dividir volume por taxa produz equivalência condicional de trabalho. Não a converta em minutos adicionados ao evento, redução garantida ou percentual causal. Decompor atraso individual exige vínculo por registro; média agregada não explica sozinha diferenças de idade entre consumidores.

## Entrega e parada

Abra com o diagnóstico operacional sustentado e sua confiança, depois evidências discriminantes, hipóteses contraditas e limites por afirmação. Preserve a distinção entre recomendação e alteração aplicada. Se a causa raiz continua aberta, o PDF permanece DIAGNÓSTICO PARCIAL quanto à causa raiz e pode conter **diagnóstico operacional sustentado**; não marque todo o caso como bloqueado.

Peça novo insumo/acesso somente com a afirmação que falta provar e a decisão que sua resposta poderia mudar. Se as fontes autorizadas já foram exploradas no nível necessário e não restar hipótese material discriminável, conclua nesse nível. Não reinicie inventários nem solicite acesso amplo para completar campos do relatório. Ausência de recuperação na janela impede declarar normalização completa, sem impedir diagnosticar o represamento.

Essas regras não liberam escrita, sondas, permissões, fallback de modelo ou contorno de autenticação. Falha de capacidade essencial limita a conclusão dependente dela; sem âncora/escopo ou evidência primária suficiente, entregue somente o relato e a lacuna decisiva.
