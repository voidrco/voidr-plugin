# Diagnóstico independente pela telemetria

Leia após resolver o escopo e antes de aprofundar uma hipótese. A finalidade é identificar rapidamente a fronteira que falha, sem esperar a causa raiz e sem reproduzir a conclusão humana. Este roteiro complementa o preflight, os portões de escopo e a escada causal; não autoriza novas fontes, acessos, mudanças ou sondas em produção.

## Entrada e quarentena

Use o relato inicial para sintoma, impacto declarado, identificadores e janela. Descubra componentes por telemetria, configuração e código autorizados. **Não use atribuição de causa, fornecedor culpado, diagnóstico ou solução da war room como entrada**, mesmo em uma mensagem intitulada `COMUNICADO DE ATUALIZAÇÃO` ou publicada antes do encerramento. Classifique pelo conteúdo, não pelo título nem apenas pela data.

Se uma resposta misturar relato com conclusão, preserve somente os fatos iniciais separáveis; coloque a atribuição e os termos derivados dela em quarentena. Não os use para escolher banco, fornecedor, repositório, query ou hipótese. Se não puder separar, registre a contaminação e reconstrua a âncora com outra fonte permitida. Uma conclusão anterior no histórico desta sessão também contamina um replay: uma validação cega exige contexto novo e entradas sanitizadas.

Não dependa de atualizar o Slack durante a formação do diagnóstico. Depois de congelar um registro independente com evidências, horário e lacunas, compare com a conclusão humana somente se solicitado, em seção separada; ela não aumenta retroativamente a confiança da conclusão técnica.

## Uma rodada discriminatória antes de aprofundar

Fixe janela absoluta/fuso, baseline comparável, serviços e identidades físicas. Para falha de banco ou dependência externa, confronte as três hipóteses na mesma janela. Em outras famílias, adapte a dependência observada sem forçar Astra como candidato.

| Hipótese | Leituras úteis | Evidência que muda a decisão |
| --- | --- | --- |
| Aplicação | Primeiro erro bruto, stack e contrato de retorno; versão/imagem/configuração efetiva; deploy, criação/substituição/restarts e prontidão dos pods. | Falha concentrada em uma revisão/caminho, com mecanismo implantado compatível; ou falha comum em serviços/revisões distintos que enfraquece uma regressão isolada. |
| Rede/infra Blip | DNS, TCP/egress, retransmissões/falhas/conntrack, disponibilidade dos nós; eventos e mudanças de rede/AKS no escopo correto quando acessíveis. | Falha do caminho nos mesmos pods/horários/endpoints; ou controles positivos contemporâneos e respostas do protocolo da dependência que enfraquecem uma perda de conectividade geral. |
| Dependência | Erros, latência, sucesso e conexões do cliente por banco/endpoint/região; métricas/logs do servidor/gateway quando disponíveis; serviços e clusters consumidores comparáveis. | Falhas na mesma dependência através de clientes distintos, com configuração/runtime vinculando-os; evidência interna ou por operação que distingue falha de atendimento da simples presença de conexão. |

Registre por hipótese: **sustenta, contradiz, lacuna, próxima leitura discriminatória**, com referências, escopo, janela, unidade e cobertura. `Inacessível`, ausência de série, zero explícito e resultado truncado são estados diferentes. Não some contadores de janelas móveis sobrepostas nem conte registros de erro como mensagens/clientes únicos.

No Grafana descubra UIDs, labels e descritores; faça chamadas sequenciais conforme o contrato do conector. Reutilize a descoberta e consultas já qualificadas. Não investigue todas as assinaturas/repositórios nem repita inventários porque uma hipótese ficou incompleta.

### Limites que impedem atribuição indevida

- Sessões abertas não demonstram sucesso de consultas. Um `Unavailable` retornado por CQL é diferente de timeout DNS/TCP; descreva a assinatura exata sem presumir o defeito interno do gateway/backend.
- Nós/prontidão saudáveis ou CPU baixa não eliminam falhas de caminho/dependência. Mudança no Activity Log não é causal só por proximidade; prove recurso, direção do efeito e precedência. Atualização posterior não iniciou uma falha anterior.
- Resolva assinatura, região, grupo, nó e pod por evidência do runtime quando disponíveis. Região do AKS e região do banco são coordenadas distintas. Cruze a VM de um evento com os pods que emitiram o erro; não atribua a falha do cluster inteiro a um evento de uma VM.
- Bancos compartilhados entre clusters sustentam um domínio comum de falha. Mesmo fornecedor em regiões/bancos diferentes não comprova um único evento iniciador entre regiões.
- Métrica do fornecedor zerada enquanto os clientes falham é uma contradição de cobertura/semântica a investigar, não prova de backend saudável nem de falha interna. Valide timestamps, scrape, labels, unidade e controles antes de usá-la como árbitro.
- Ausência de mudança administrativa só vale para filtros, recursos, assinatura e janela consultados; não elimina plano de dados Kubernetes, falha transitória de rede ou operação interna de fornecedor.

## Concluir no nível suportado

Separe três perguntas na resposta e no relatório:

1. **Diagnóstico operacional:** qual fronteira falha e como afeta a jornada? Pode ser sustentado por erros concretos de operação e outra fonte independente que os vincule ao runtime/dependência. Nomeie os elos observados; mantenha como inferência a propagação sem request pareado.
2. **Origem provável:** qual hipótese explica melhor os sinais e o que ainda impede excluir concorrentes? Múltiplos clusters mais erro do cliente permitem priorizar dependência; não autorizam afirmar categoricamente `o fornecedor causou` ou `a infraestrutura Blip está descartada`.
3. **Causa raiz técnica:** qual defeito/evento iniciou o mecanismo? Exige o portão causal existente. Origem no fornecedor pede evidência discriminatória do servidor/gateway ou do caminho da operação, além da atribuição por exclusão. Se faltar, mantenha aberta.

Entregue um checkpoint operacional assim que a rodada permitir, sem aguardar o defeito iniciador e sem interromper o trabalho já autorizado. Priorize a próxima leitura que distingue as hipóteses concorrentes. Não faça uma exploração ampla de Azure para adiar uma conclusão sobre uma dependência já observada.

Depois de uma leitura sem sinal discriminatório, registre seu resultado e mude de perna/consulta conforme a lacuna. Reabra o mesmo ramo apenas com novo identificador, mudança na cobertura ou contradição concreta. Se fontes autorizadas não resolvem o elo, entregue a conclusão limitada e o dado/operação mínimos que o desbloqueiam; não solicite acesso amplo nem execute sondas, reinícios ou coleta nova sem autorização.

Formato conciso do checkpoint: `fronteira e impacto; hipótese prioritária e confiança justificada; evidências que a sustentam/contradizem; causa raiz confirmada ou não; próximo dado discriminatório`. O PDF continua obrigatório conforme o contrato de entrega, mas sua preparação não deve atrasar a comunicação operacional útil. Uma hipótese não deve ser promovida para preencher o template.
