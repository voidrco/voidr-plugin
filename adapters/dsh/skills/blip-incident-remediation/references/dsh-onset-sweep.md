# Varredura determinística de onset

Use esta varredura quando a pergunta discriminatória exigir comparar famílias no onset. Para atraso de processamento e status pendente, faça primeiro a passagem de fila de [dsh-processing-first.md](dsh-processing-first.md); não execute sete famílias por serviço antes de medir entrada, consumo e backlog. Respeite o orçamento de coleta e registre famílias não aprofundadas como lacunas por afirmação. Ela transforma uma orientação abstrata em uma coleta reproduzível e impede encerrar no evento mais volumoso ou na primeira stack trace convincente.

No DSH, depois de resolver conector, datasource Loki, seletor físico e janela inicial, use `incident_onset_sweep`. Consuma a matriz e as amostras retornadas como evidência, não como conclusão causal. Se `recommendations` indicar truncamento ou baseline ausente, expanda ou substitua a janela e execute novamente; a escolha da nova janela continua pertencendo à investigação.

Uma execução cobre somente o seletor físico informado. Se a jornada atravessar célula dedicada e serviços compartilhados, execute a varredura separadamente em cada célula candidata com a mesma janela, bucket e baseline, e monte também uma matriz `célula × família × primeiro ponto × baseline`. Encontrar o tenant numa célula não autoriza encerrar a varredura nela; em células compartilhadas, a ausência do tenant nos logs não é evidência negativa. Use fingerprints de serviço, rota, exceção, fila, endpoint ou versão para localizar o salto compartilhado.

A ferramenta sempre varre todas as famílias, mesmo quando `families` é informado. Esse argumento é apenas uma dica de prioridade. Antes de concluir, percorra `reconciliationChecklist` e dê a cada família exatamente um resultado: `promovida como parte do evento comum`, `refutada por baseline/mecanismo` ou `mantida como lacuna`. Uma família marcada `requires_explicit_classification` não pode desaparecer do JSON ou do PDF.

Os campos `firstElevated` e `lastElevated` da matriz são limites de buckets agregados. Para os relógios do incidente, use `familySamples.*.firstObservedAt`, `familySamples.*.lastObservedAt`, `firstRawObservedAt` e `exactCommonOnsetCandidates`, que preservam os timestamps das linhas brutas. Nunca substitua um timestamp bruto anterior pelo início arredondado de um bucket. Se os timestamps brutos não estiverem disponíveis, declare a resolução temporal do bucket em vez de apresentar o horário agregado como instante exato.

Antes de congelar o onset, transcreva para a evidência os candidatos brutos devolvidos pela ferramenta e compare-os explicitamente com o bucket agregado escolhido. Se existir candidato bruto anterior e compatível, ele é o relógio técnico; o bucket permanece apenas como resolução da elevação. Não publique somente o bucket sem explicar por que cada candidato bruto foi aceito ou descartado.

## 1. Janelas

Defina:

- uma janela curta que comece antes do impacto declarado;
- uma janela de alta resolução ao redor do primeiro candidato;
- uma baseline saudável equivalente;
- quando houver retenção, o mesmo horário num período adjacente.

Use linhas brutas primeiro. Contagens e patterns servem para localizar; não substituem a inspeção das exceções, endpoints e serviços.

## 2. Classificador mínimo

Classifique as assinaturas encontradas em todas as famílias aplicáveis:

- cache: Redis, Memcached, multiplexer, cache timeout, cache connection;
- fila ou broker: Kafka, RabbitMQ, Service Bus, channel closed, rebalance, dequeue, consumer;
- banco relacional: SqlException, PostgreSQL, MySQL, Oracle, cancelamento ou timeout de comando;
- banco documental ou distribuído: MongoDB, Cassandra, Cosmos DB, DynamoDB;
- rede, DNS e transporte: SocketException, connection refused/reset, name resolution, DNS, TLS, HTTP 5xx, timeout/cancelamento;
- storage ou objeto: blob, bucket, filesystem, object store;
- runtime: starvation, thread pool, GC, OOM, CPU throttling, pod/node pressure.

Os termos acima são classificadores de descoberta, não hipóteses. Consulte somente as famílias presentes ou plausíveis no runtime, registre consulta vazia e não force uma causa.

## 3. Matriz obrigatória

Para cada família observada, registre:

| família | assinatura bruta | endpoint/instância | serviços | primeiro/último ponto | volume | baseline | estado |
|---|---|---|---|---|---:|---|---|

Não funda endpoints ou stores distintos. Um cache A e um cache B contam como instâncias independentes; um banco e uma fila contam como famílias independentes. Se duas ou mais linhas divergirem juntas, avalie um evento comum antes de promover uma delas a causa.

Depois da varredura ampla do escopo físico, reconcilie todas as famílias devolvidas pela matriz, inclusive as de menor volume. Para cada família elevada perto do onset comum, faça uma destas três coisas no livro de evidências: promovê-la como parte do evento comum, refutá-la com baseline ou mecanismo incompatível, ou mantê-la como lacuna. O relatório não pode omitir silenciosamente uma família presente na matriz nem reduzir um evento multi-serviço ao serviço que exibe o sintoma.

## 4. Persistência da falha

Quando o pico inicial for curto e o sintoma durar mais:

1. siga a resposta/valor através dos callers;
2. procure `GetOrAdd`, `Set`, `Add`, `cache`, `cacheNullValues`, `Expiration`, `TTL`, retry, fallback, default, invalidation e stale-if-error;
3. identifique a primeira fronteira que possa persistir, repetir ou projetar o erro;
4. confronte essa fronteira com o runtime e com churn de pods/processos;
5. se pods novos continuarem falhando, diferencie cache recontaminado, falha remota recorrente e mecanismo independente; não descarte o cache sem testar recontaminação.

Código que aceita ou armazena `null`, TTL ou fallback demonstra uma janela possível de persistência. Ele não explica sozinho uma duração maior que o TTL. Para ligar um pico curto a horas de impacto, exija no runtime ao menos uma repetição, recontaminação, ressincronização falha, estado ainda inconsistente ou outro evento que renove o mecanismo. Sem essa evidência, escreva `fronteira de persistência compatível; prolongamento completo não demonstrado`.

## 5. Saída

O primeiro ponto anômalo deve citar a matriz que o sustenta. Um evento de alto volume sem famílias discriminadas é somente candidato. Uma família não consultada permanece lacuna, mesmo que outra explique parte do sintoma.

Mantenha quatro relógios independentes até o fim: primeiro onset técnico amplo, primeiro erro específico do produto, último erro correlato e normalização contemporânea declarada. Uma atualização operacional contemporânea fornecida no trigger pode sustentar os relógios declarados; comunicado final e post-mortem continuam em quarentena. Compare o último erro bruto com retorno à baseline e atualização operacional, sem condensá-los num único horário.

Antes de gerar o artefato, confira no JSON de saída que: (a) o onset técnico usa o melhor timestamp bruto disponível; (b) cada família próxima do onset aparece como evidência, refutação ou lacuna; (c) o último erro bruto não foi substituído pelo fim de um bucket; e (d) recuperação de workload, dependência, fila e cache foi consultada separadamente. Se qualquer item falhar, continue a investigação ou declare a lacuna — não finalize com um relógio arredondado tratado como exato.

Confira ainda que todas as células que executam saltos plausíveis da jornada foram varridas de forma comparável. Se apenas a célula do tenant foi varrida e existe backend compartilhado não refutado, o onset permanece provisório e o artefato não está pronto para congelamento.

No grafo, um nó só pode ser `OBSERVADO` quando todo o texto do nó estiver demonstrado no runtime. Se o nó combinar um erro observado com uma transformação vista apenas no código, divida-o em dois nós: o erro fica `OBSERVADO` e a transformação fica `INFERIDO`. Aresta sustentada apenas por código também é inferida, mesmo quando os nós das pontas foram observados.

(End of file - total 73 lines)
