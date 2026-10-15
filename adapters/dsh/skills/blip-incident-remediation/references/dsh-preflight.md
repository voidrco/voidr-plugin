# Preflight obrigatório de capacidades reais

Execute antes da coleta investigativa, após carregar o input inicial fornecido pelo usuário e antes de ampliar buscas. O preflight não pode ler conclusão, comunicado final, RCA ou post-mortem; use consultas de interface neutras e metadados sem resolução. Não trate a fixture do renderer como prova de acesso remoto.

## Procedimento

1. Confirme organização **Blip**, contexto autorizado e identidade de acesso sem expor credenciais. Leia `dsh-compatibility.md` e descubra os conectores/ferramentas reais.
   Nesta stack local, não invoque `observability_source`: essa operação nativa é bloqueada para a organização Blip (`Native observability access denied`). Grafana deve ser provado somente pelo conector `blip-grafana-mcp`, via `custom_connectors_list_mcp_tools` e `custom_connectors_execute_mcp_tool`.
2. Registre schema, operação, escopo, janela e fonte para cada capacidade abaixo. Só execute operações de leitura delimitadas. Não rode snapshot, alteração de assignment, rebalance, refresh de Vault ou sync de Argo.
3. Prove cada interface com uma operação real autorizada. Quando o caso ainda não fornece o identificador necessário, marque a capacidade como **não verificada**, não como disponível. Não invente datasource UID, repo, topic, application, key, trace ID ou caminho Vault.
4. Diferencie **interface executável** de **cobertura histórica do incidente**. Uma consulta neutra vazia pode provar que a interface aceita a operação; não prova amostras nem retenção para o incidente. Complete a cobertura ao resolver seus identificadores.
5. Se houver erro/403/401, operação ausente, timeout não resolvido ou recurso inacessível, registre `inacessível por permissão/interface` e o erro factual. Uma ferramenta com o nome esperado mas schema incompatível é uma interface ausente para essa operação.
   Não use `get_annotations` no conector Grafana durante estes diagnósticos locais: o endpoint corporativo de annotations resolve para um serviço interno e expira antes dos headers. Para cobrir mudanças e alertas, use `alerting_manage_rules`, dashboards, logs e métricas; registre annotations como `inacessível por interface` sem executar a chamada conhecida como falha.
   No harness local, execute chamadas do conector Grafana em sequência, nunca em paralelo. Para Loki, limite cada consulta inicial a no máximo duas horas e divida janelas maiores. Isso evita saturar o transporte MCP sem reduzir a cobertura temporal.
   Respeite os nomes exatos dos argumentos de tempo: `query_prometheus` usa `startTime` e `endTime`; `query_loki_logs` usa `startRfc3339` e `endRfc3339`. Nunca misture os dois schemas.
6. Apresente o quadro e o limite causal ao usuário **antes de investigar**. Atualize-os se novas evidências mudarem a cobertura. Não silencie uma lacuna ao escrever o PDF.

## Falha estrutural da execução

Ausência conhecida de uma interface pode reduzir o teto causal e ainda permitir um diagnóstico parcial. Isso é diferente de uma capacidade que o ambiente declarou disponível ou que o contrato da execução exige, mas falha por catálogo não carregado, autenticação/permissão incorreta, configuração local, transporte persistente ou API indisponível.

Uma capacidade é exigida para uma afirmação quando sua falha impede sustentá-la e não existe evidência independente equivalente. A mera presença no inventário não a torna essencial para todo o diagnóstico. Uma indisponibilidade decisiva só para a causa raiz não bloqueia diagnóstico operacional já comprovado; aplique [o critério por afirmação](dsh-evidence-bound-conclusion.md). Preserve bloqueios de autenticação, modelo e permissões, sem tentar contorná-los.

Se uma capacidade essencial para a conclusão pretendida falhar estruturalmente:

1. confirme o erro com uma única repetição segura ou uma operação neutra equivalente;
2. emita o marcador literal **`FALHA ESTRUTURAL DE CAPACIDADE`**, com ferramenta, operação e erro factual;
3. pare a afirmação dependente dessa capacidade e não a apresente como concluída; preserve o diagnóstico operacional quando fontes independentes suficientes o sustentarem;
4. sem evidência suficiente para qualquer fronteira, não gere nem valide um PDF final para avaliação comparativa; preserve os artefatos da falha. Com uma fronteira independente sustentada, entregue o PDF limitado a ela, com a falha e a consequência explícitas, sem alegar RCA completa ou execução da capacidade indisponível.

Erro de sintaxe de consulta, consulta vazia, filtro incorreto ou tentativa que o próprio agente consegue reformular não é falha estrutural. Também não é falha estrutural a ausência de Slack quando o relato inicial foi fornecido integralmente e a execução já declarou essa interface como indisponível. Grafana inacessível sem recibos primários suficientes, ticket/trigger não recuperável quando ele é a única âncora, código indisponível quando sua execução é a afirmação pretendida, ou isolamento histórico incompatível invalidam a conclusão dependente dessas fontes até correção; não alegue capacidade executada nem substitua a prova ausente por inventário.

Quando o prompt trouxer um ADO, execute primeiro apenas `issue_tracker_list`. Chame `issue_tracker_get_issue` somente se a listagem retornar um contexto de work items executável e use o identificador exato devolvido. Se não houver contexto, registre ADO como `inacessível por interface`; não invoque `get_issue` com o contexto padrão ausente e não tente encontrar o ADO pela busca global do Zendesk.

Em um smoke limitado a inventário, diga “smoke de catálogo aprovado; preflight operacional parcial”. Não diga “preflight concluído sem falhas”, “ambiente pronto” ou que as consultas estão liberadas se ainda há capacidades não verificadas. Sem ticket, não prometa um diagnóstico nem classifique antecipadamente um PDF: informe somente o teto atual, sujeito às evidências do caso futuro. Responda no idioma do usuário e mantenha separados o resultado do smoke e a prontidão investigativa.

| Capacidade | Prova mínima de interface | O que NÃO prova |
| --- | --- | --- |
| Loki | Consulta LogQL delimitada a datasource/labels autorizados, backend sem erro, resultado ou vazio explícito | Datasource listado, dashboard ou inventário de logs |
| Prometheus | Consulta PromQL delimitada, backend sem erro | Nome do datasource, scrape configurado ou dashboard |
| Tempo | TraceQL real **ou** busca de `trace_id` real autorizado; registrar qual modalidade funciona | Datasource Tempo listado, links de trace sem leitura |
| GitHub `blip-ai` | Leitura de recurso autorizado de repo `blip-ai`, por revisão quando aplicável | Login válido, organização listada, repo público de outro owner |
| Histórico Argo | Ler histórico de deploy/sync de application/ambiente autorizado | Manifesto Git desejado ou estado atual sem histórico |
| Kafka assignments/rebalances | Ler histórico/registro efetivo de assignments/rebalances do group/topic autorizado | Métrica de lag, listagem de topics ou estado atual isolado |
| Snapshots Redis | Ler snapshot/histórico existente pertinente, somente leitura; nunca criar snapshot | Ping, conectividade, contagem atual ou inventário de instâncias |
| Configuração efetiva Vault | Ler metadados/configuração aplicada da versão e consumidor autorizados, com valores secretos redigidos | Secret declarado no Git, variável local, lista de mounts ou auth bem-sucedida |

Também verifique Slack (busca exata e pai/thread) e Docs/Drive (leitura inicial autorizada) porque são necessários para o fluxo ticket/CCH-first. Ausência de Docs pode ser não aplicável se o input não aponta para documento; explique. Não classifique indisponível como não aplicável para esconder falta de interface.

Quando a entrada identificar Zendesk, descubra o conector `zendesk-api-v1`, a leitura `custom_connectors_zendesk_evidence` no ClickHouse e, quando pertinentes, capturas legadas `zendesk-browser-v1` conforme [dsh-zendesk-tickets.md](dsh-zendesk-tickets.md). Inventário não prova consulta nem conteúdo inicial disponível. Não carregue histórico/resolução para testar o preflight: até a leitura autorizada do caso, mantenha a consulta e sua cobertura como `não verificadas`. Registre separadamente se a interface consegue isolar o relato original; versões capturadas e filtros de coleta não garantem estado inicial-only. Descubra a API apenas como fallback para lacunas explícitas; não carregue conteúdo para testar sua disponibilidade. Antes da leitura, informe essa limitação da fase cega. Ao consultar, registre conector, ticket, captura, cobertura, paginação e consulta na linha ticket/registro inicial do Anexo B, além das capacidades do template.

Quando a entrada for exclusivamente CCH/Slack, não teste Zendesk ao vivo: ele não é uma capacidade aplicável ao trigger e a busca/listagem global pode falhar por escopo. Teste somente a leitura Slack exata; se ela não existir, registre a interface como inacessível e preserve como âncora o relato inicial fornecido, sem abrir uma rota Zendesk não solicitada.

## Registro e trava de conclusão

Use `../scripts/dsh-preflight.template.json` como estrutura, preenchendo apenas evidências reais. No registro, uma capacidade pode estar:

- `disponível`: operação de leitura executada, source/escopo registrados, sucesso sem erro remoto;
- `inacessível por permissão/interface`: operação/permite acesso ausente ou tentativa falhou; razão factual obrigatória;
- `não verificada`: ainda não existe prova operacional; explicar qual dado/identificador falta;
- `não aplicável`: demonstrar por que a operação não participa do caso, sem alegar acesso que não foi testado.

Cobertura histórica: `com evidência`, `sem amostras`, `não verificada`, `fora da retenção comprovada`, `inacessível por permissão/interface` ou `não aplicável`. Retenção exige prova; janela vazia não é suficiente.

Valide o JSON com `scripts/validate_dsh_preflight.py PREFLIGHT.json`, usando o Python da instalação. O validador falha com status 2 se o contrato ou a prova declarada for inválida. Ele não chama provedores, não verifica autenticidade de evidências e não substitui testes de acesso. Uma estrutura válida com capacidades ausentes **não é** um smoke remoto aprovado.

Informe em linguagem natural, por exemplo: “Consigo consultar logs e métricas, mas não histórico Argo nem configuração efetiva do Vault. Posso reconstruir os eventos sustentados por esses sinais. Se o defeito iniciador depender de configuração/deploy, essa causa não poderá ser comprovada com o acesso atual.” Não prometa um nível só pela contagem de capacidades.

O teto causal é definido pela prova do caso, não pelo número de MCPs:

- Sem input original acessível: registrar lacuna; usar somente relato inicial fornecido. Não buscar post-mortem para completar.
- Sem telemetria histórica: no máximo relato declarado e fatos observáveis independentes; não afirmar mecanismo a partir da narrativa.
- Sem traces: não afirmar cadeia request-a-request; logs correlacionados podem sustentar apenas os vínculos efetivamente presentes.
- Sem código/revisão executada ou configuração/histórico efetivo pertinente: separar mecanismo observado de defeito iniciador não demonstrado e de origem/exposição não demonstradas.
- Sem assignments/rebalances ou snapshots necessários à hipótese: não transformar lag/estado atual em prova de ownership anterior ou do estado perdido.
- A falta de uma interface não impede uma causa comprovada por outras evidências independentes equivalentes; explicite essa equivalência, sem dar como consultada a interface ausente.

Cada ligação causal continua exigindo evidência conforme os portões canônicos. Se o defeito iniciador não estiver comprovado, a entrega é `POST MORTEM — DIAGNÓSTICO PARCIAL`, com lacunas e cobertura no padrão visual Blip.
