# Preflight obrigatório de capacidades reais

Execute antes da coleta investigativa, após carregar o input inicial fornecido pelo usuário e antes de ampliar buscas. O preflight não pode ler conclusão, comunicado final, RCA ou post-mortem; use consultas de interface neutras e metadados sem resolução. Não trate a fixture do renderer como prova de acesso remoto.

## Procedimento

1. Confirme organização **Blip**, contexto autorizado e identidade de acesso sem expor credenciais. Leia `dsh-compatibility.md` e descubra os conectores/ferramentas reais.
2. Registre schema, operação, escopo, janela e fonte para cada capacidade abaixo. Só execute operações de leitura delimitadas. Não rode snapshot, alteração de assignment, rebalance, refresh de Vault ou sync de Argo.
3. Prove cada interface com uma operação real autorizada. Quando o caso ainda não fornece o identificador necessário, marque a capacidade como **não verificada**, não como disponível. Não invente datasource UID, repo, topic, application, key, trace ID ou caminho Vault.
4. Diferencie **interface executável** de **cobertura histórica do incidente**. Uma consulta neutra vazia pode provar que a interface aceita a operação; não prova amostras nem retenção para o incidente. Complete a cobertura ao resolver seus identificadores.
5. Se houver erro/403/401, operação ausente, timeout não resolvido ou recurso inacessível, registre `inacessível por permissão/interface` e o erro factual. Uma ferramenta com o nome esperado mas schema incompatível é uma interface ausente para essa operação.
6. Apresente o quadro e o limite causal ao usuário **antes de investigar**. Atualize-os se novas evidências mudarem a cobertura. Não silencie uma lacuna ao escrever o PDF.

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

Quando a entrada identificar Zendesk, descubra também o coletor `zendesk-browser-v1` e os schemas de leitura de tickets conforme [dsh-zendesk-tickets.md](dsh-zendesk-tickets.md). Inventário não prova consulta nem conteúdo inicial disponível. Não carregue histórico/resolução para testar o preflight: até a leitura autorizada do caso, mantenha a consulta e sua cobertura como `não verificadas`. Registre separadamente se a interface consegue isolar o relato original; o contrato atual devolve a captura mais recente, sem filtro inicial-only. Antes da leitura, informe essa limitação da fase cega. Ao consultar, registre conector, ticket, captura, cobertura, paginação e consulta na linha ticket/registro inicial do Anexo B, além das capacidades do template.

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
