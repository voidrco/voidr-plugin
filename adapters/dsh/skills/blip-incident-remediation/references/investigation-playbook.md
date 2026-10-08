# Playbook de investigação viva

## 1. Transformar linguagem natural em uma busca operacional

O usuário pode informar apenas algo como “as mensagens parecem estar indo para o contato errado” ou “o checkout está falhando”. Converta isso em uma ficha inicial sem exigir formulário:

| Campo | Como obter |
|---|---|
| Sintoma | comportamento observado, sem presumir a causa |
| Fluxo | produto, canal, integração ou jornada afetada |
| Escopo | cliente, tenant, região, conta ou todos; `desconhecido` se ausente |
| Janela | horário informado; caso contrário, últimas 2 horas |
| Resultado esperado | o que deveria acontecer |
| Termos de busca | nomes, erros, rotas, eventos, campos e sinônimos |

Faça uma pergunta ao usuário somente quando uma informação ausente impedir todas as consultas úteis. Caso contrário, comece e refine a partir das evidências.

Antes da busca ampla, use a ontologia para acrescentar à ficha:

| Coordenada | Pergunta operacional |
|---|---|
| Jornada | qual comportamento de negócio está falhando? |
| Serviço | quais APIs, consumidores ou aplicações materializam a jornada? |
| Dados | quais bancos, coleções, tópicos, filas ou contratos atravessam o fluxo? |
| Escopo lógico | qual tenant, bot, ambiente, célula ou rótulo está afetado? |
| Runtime físico | qual cluster, namespace, workload e pod estão executando? |
| Mudança | qual digest, build, commit, PR, configuração ou GMUD chegou ao runtime? |

## 2. Triangulação das fontes

### Slack: contexto humano e cronologia

Pesquise exclusivamente no canal `#comunicação-de-incidentes` (`C08MGJ6F596`) salvo se o usuário ampliar o escopo. Use combinações de:

- produto ou funcionalidade;
- cliente/tenant, quando fornecido;
- mensagem de erro ou comportamento;
- serviço, integração, evento ou campo;
- termos em português e inglês.

Leia threads completas. Extraia horários, primeiro relato, impacto confirmado, responsáveis, mitigação e links. Uma afirmação no Slack é contexto até ser confirmada por runtime ou código.

### Grafana: comprovação do comportamento

Escolha primeiro a stack, datasource, tenant/célula e identidade física corretos. Depois use a janela inicial e compare com um período saudável equivalente. Procure:

- aumento de erros e códigos de resposta;
- queda ou desvio de volume;
- latência e timeouts;
- backlog, retries, DLQ ou consumidor parado;
- saturação de CPU, memória, conexões ou dependências somente quando compatível com o sintoma;
- logs e traces que revelem serviço, rota, handler, exceção, correlation ID ou payload estrutural;
- marcadores de deploy, alteração de configuração ou início abrupto.

Não conclua “infra” só porque há saturação, nem “aplicação” só porque há stack trace. Explique o mecanismo causal.

#### Logs: consulte a fonte, não dependa do dashboard

Um dashboard contém consultas e transformações preparadas para acompanhamento recorrente; ele não é o conjunto completo de logs. Use as ferramentas do Grafana MCP para inspecionar o painel apenas quando precisar descobrir nomes de serviço, datasource, labels, campos e janelas relevantes. Na investigação, consulte as linhas diretamente no Loki ou Elasticsearch pelas ferramentas MCP correspondentes. Não abra o Grafana no browser nem troque para API direta sem autorização explícita do usuário.

Escolha a fonte a partir da configuração observada:

- se o datasource for Loki, use LogQL e comece pelos labels realmente disponíveis, como cluster, namespace, application, container ou pod;
- se o datasource for Elasticsearch/OpenSearch, use os campos e o índice observados, como `@timestamp`, `service.name`, `kubernetes.namespace_name`, `kubernetes.pod_name`, nível e mensagem;
- se a fonte não puder ser identificada, inspecione a query do painel ou a lista de datasources antes de formular a consulta; não invente labels, índices ou campos.

Fluxo de consulta:

1. Fixe datasource, ambiente/célula, serviço e janela absoluta com fuso.
2. Busque linhas brutas em uma janela curta ao redor do início do sintoma. Comece amplo pelo serviço e escopo; não comece por uma mensagem de erro presumida.
3. Observe a forma real dos registros e só então aplique parser JSON/logfmt ou filtros por nível, exceção, rota, tenant anonimizado e correlation/trace ID.
4. A partir de uma linha concreta, expanda para eventos anteriores e posteriores do mesmo correlation/trace ID e para serviços adjacentes.
5. Compare volume, padrão e distribuição com uma janela saudável equivalente. Agregações como `count_over_time` ou histogramas vêm depois da inspeção das linhas, não antes.
6. Registre na evidência: datasource, consulta exata, intervalo, fuso, quantidade retornada, truncamento/amostragem e link para reprodução quando existir.

Não copie payloads completos quando contiverem PII ou segredos. Preserve apenas campos estruturais necessários para provar o mecanismo. Ausência de linhas não prova ausência do evento sem validar retenção, filtros, tenant do datasource e limites da consulta.

### GitOps e runtime: estado desejado não é estado observado

Quando a hipótese envolver mudança ou configuração, rastreie:

`PR/GMUD → commit → build → imagem/digest → deployment → workload/pod`

O manifesto no Git ou a revisão do Argo provam intenção/configuração declarada; não provam isoladamente que a imagem, a configuração e o pod estavam efetivos e saudáveis no período. Registre separadamente:

- o que estava declarado;
- o que foi reconciliado;
- o que o workload executava;
- quando cada estado passou a valer.

### Codebase e histórico: explicar o mecanismo

Use primeiro as pistas do runtime para selecionar o repositório e a revisão implantada. Busque com `rg` por mensagens de log, nomes de exceção, rotas, eventos, filas, configurações e campos. Reconstrua:

1. ponto de entrada;
2. validações e decisões;
3. escrita/leitura de estado;
4. side effects e integrações;
5. cache, filas e projeções derivadas;
6. caminho de erro e retries.

Depois use Git/GitHub para verificar alterações recentes naquele caminho. Se houver ticket ou PR mencionado no Slack, trate-o como candidato e valide o diff.

O repositório da aplicação, o repositório de testes e o repositório GitOps podem ser distintos. Não atribua ausência de teste apenas porque ele não existe no repo da aplicação.

## 3. Hipóteses que podem ser refutadas

Para cada hipótese, registre:

| Item | Exemplo de conteúdo |
|---|---|
| Hipótese | mecanismo técnico proposto |
| Explica | quais sintomas e sinais ela cobre |
| Previsão | qual evidência adicional deveria existir |
| Refutação | qual resultado a tornaria falsa |
| Estado | sustentada, enfraquecida ou inconclusiva |

Prefira uma hipótese que explique toda a cadeia com menos suposições. Não esconda evidência contraditória.

Para cada afirmação importante, retenha também: fonte, escopo, período de validade, método de coleta e estado de verificação. Quando duas fontes divergirem, tente primeiro reconciliar ambiente, célula, tenant, versão e horário antes de tratá-las como contraditórias.

## 4. Critério para causa raiz

Use `causa raiz` apenas quando:

- o mecanismo de código/configuração explica o impacto observado;
- o momento do início é compatível com deploy, dado, evento ou mudança externa;
- métricas/logs/traces mostram a execução do mecanismo;
- não existe evidência forte que contradiga a conclusão.

Se faltar qualquer peça importante, use `causa provável` e liste exatamente o que falta verificar. Nível de confiança:

- `alta`: mecanismo confirmado por runtime e código/histórico;
- `média`: múltiplos sinais consistentes, mas falta uma ligação direta;
- `baixa`: hipótese plausível ainda baseada em indícios parciais.

## 5. Mudanças e PRs relacionados

Somente depois de localizar o caminho provável:

1. busque PRs/commits por ticket, mensagem de erro, classe, método ou configuração;
2. compare datas com o início do incidente;
3. leia o diff e os testes;
4. classifique como causal, contenção/rollback, corretivo ou hardening;
5. não confunda documentação ou deploy com correção de código.

Quando a correção envolver estado inconsistente, extraia o padrão completo: validar a invariante, reconciliar referências conflitantes, invalidar caches/projeções, limpar dados históricos, adicionar regressão e monitorar o rollout.

## 6. Formato de apresentação

Leia e siga [blip-postmortem-format.md](blip-postmortem-format.md). Para incidente ativo, use `POST MORTEM — RELATÓRIO PRELIMINAR` e mantenha como `em investigação` todo campo ainda não comprovado. Inclua o trace observado ou o grafo causal reconstruído no Anexo Técnico A.

## 7. Regras de escrita

- Abra com a conclusão, não com o histórico da investigação.
- Use horários absolutos e informe o fuso.
- Não misture ação executada com recomendação.
- Inclua links diretos para evidências sempre que possível.
- Traduza detalhes de implementação para impacto operacional, mantendo nomes técnicos necessários para reprodução.
- Nunca preencha lacunas com um post-mortem antigo; incidentes anteriores servem apenas como comparação quando a evidência atual aponta para o mesmo mecanismo.
