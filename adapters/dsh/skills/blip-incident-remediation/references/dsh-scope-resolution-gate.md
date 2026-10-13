# Portão de resolução de escopo e vínculo causal

Use este portão antes de aprofundar a investigação e novamente antes de gerar o PDF. Ele evita fechar o caso no primeiro cluster que responde, no serviço que apenas exibe o sintoma ou em um caminho de código plausível que não executou no incidente.

## 1. Âncoras que não podem se perder

Extraia do trigger apenas o que foi realmente fornecido: cliente/tenant ou identificador equivalente, produto/jornada, sintoma, janela e IDs. Mantenha `desconhecido` quando ausente. Não substitua uma âncora desconhecida por um valor conveniente encontrado na topologia atual.

Monte candidatos separados para:

- célula/cluster físico;
- serviço que recebe a ação do usuário;
- serviços a montante e a jusante da jornada;
- dependências de dados, mensageria e identidade;
- versão/revisão efetivamente executada.

Trate o escopo físico como potencialmente plural. Localizar o cliente numa célula dedicada prova onde a identidade ou a borda apareceu; não prova que todo o processamento da jornada ocorreu nessa mesma célula. Para jornadas multi-tenant ou com backends compartilhados, mantenha separadamente a célula do cliente, as células dos serviços compartilhados e as dependências comuns até ligar cada salto por runtime ou código compatível.

## 2. Passagem localizadora comparável

Quando o cluster/célula não estiver confirmado, execute em sequência a mesma consulta mínima e a mesma janela curta nos candidatos plausíveis. Use primeiro identificadores do trigger; depois, termos do sintoma. Faça no máximo uma reformulação substantiva por candidato.

Um candidato ganha sustentação somente quando há pelo menos dois dos sinais abaixo, sendo um deles o primeiro item sempre que o trigger fornece identidade:

1. cliente/tenant/bot ou identificador equivalente aparece no escopo;
2. ocorre anomalia compatível com o sintoma na janela;
3. o volume ou a distribuição muda contra uma baseline saudável;
4. um correlation/trace ID liga serviços da jornada;
5. o runtime observado expõe a versão, workload ou dependência candidata.

Não selecionam escopo: HTTP 200 genérico, tráfego normal, existência de deployment, datasource funcional, nome semelhante de serviço ou ausência de erros numa consulta ainda não vinculada ao tenant.

Se nenhum candidato satisfizer o portão, registre `ESCOPO FÍSICO NÃO CONFIRMADO`. Continue apenas com afirmações independentes de cluster ou produza diagnóstico parcial.

A ausência do nome do tenant, bot ou cliente não refuta uma célula que hospeda serviço compartilhado. Nesse tipo de célula, localize pelo fingerprint da jornada — serviço, rota, EventType, exceção, fila, endpoint ou versão — e execute a mesma janela e baseline usadas na célula do cliente. Antes de congelar o onset, compare pelo menos um candidato tenant-facing e cada candidato compartilhado que carregue um salto da jornada. Só elimine uma célula compartilhada por incompatibilidade de workload/mecanismo ou por ausência comprovada do fingerprint de serviço, nunca apenas por ausência da identidade do cliente nos logs.

## 3. Jornada antes do componente

O serviço citado no ticket pode ser somente a superfície visível. Antes de encerrar a busca:

1. verifique o serviço de entrada;
2. percorra ao menos um salto a montante e um a jusante;
3. siga dependências indicadas por erros reais, como identidade, diretório, storage, fila, cache, template hosting ou integração externa;
4. mantenha mais de um candidato enquanto os sinais não discriminarem o iniciador.

Ausência de anomalia no serviço de entrada não prova ausência do incidente. Ela pode indicar que o erro foi aceito, projetado, assíncrono ou originado em dependência adjacente.

## 4. Fingerprint de runtime antes do código

Comece por linhas/eventos brutos na janela curta. Derive nomes de exceção, mensagens, rotas, serviços, tópicos, filas, dependências, versões e IDs realmente observados. Agregue apenas depois de conhecer a forma dos dados.

Abra código e GitHub usando esses fingerprints. Código prova mecanismo possível. Para promovê-lo a mecanismo executado, exija ao menos um vínculo com runtime: mensagem compatível, métrica discriminante, trace, configuração efetiva, versão implantada ou mudança aplicada e seguida de recuperação.

## 5. Varredura de início comum antes de escolher o primeiro ponto anômalo

O erro do serviço visível ao cliente pode ser uma projeção tardia de uma falha anterior. Antes de promovê-lo a `primeiro ponto anômalo`, faça uma passagem curta de amplitude no mesmo cluster e numa janela que comece antes do primeiro impacto declarado:

1. agrupe erros, cancelamentos, timeouts e latência por serviço e por família de dependência; dentro da mesma família, preserve endpoints, bancos, filas, clusters e clientes distintos em vez de fundi-los num único rótulo;
2. compare cada assinatura com uma janela saudável equivalente e, quando a retenção permitir, com o mesmo horário em um período adjacente;
3. diferencie assinatura crônica, pico isolado e elevação sustentada;
4. procure aumentos sincronizados em serviços ou dependências independentes; teste explicitamente cache, fila/broker, banco, HTTP interno/externo, DNS/rede e storage quando existirem no runtime, mesmo que o ticket cite apenas uma delas;
5. se duas ou mais famílias independentes divergirem juntas antes do sintoma específico, trate o evento comum como candidato anterior e siga sua propagação até o produto;
6. se nenhuma falha comum existir, preserve o sinal específico como candidato, sem ampliar artificialmente o blast radius.

Não escolha o candidato apenas por combinar melhor com o texto do ticket. Um sinal tardio e específico não supera um evento anterior com maior amplitude temporal e topológica. Também não conclua falha comum só porque várias linhas compartilham palavras: exija simultaneidade, mudança contra baseline e serviços ou dependências realmente distintos.

Antes de congelar o primeiro ponto anômalo, monte uma matriz compacta `família × endpoint/instância × serviço × janela × baseline`. Preencha todas as famílias que aparecerem nos logs brutos do onset e consulte uma janela estreita ao redor do candidato. Não promova uma única família enquanto outra assinatura sincronizada observada continuar sem consulta ou classificação. Ausência comprovada pode fechar uma linha; família não testada permanece lacuna.

Ao seguir o mecanismo no código, verifique o contrato de erro entre as camadas: status não-success, exceção, conversão para `null`/vazio/default, cache desses valores, TTL, retry, fallback, invalidação e comportamento stale-if-error. Não pare na primeira transformação: siga o valor retornado até a primeira fronteira que possa persistir, repetir ou projetar a falha. Esses elos são perguntas obrigatórias quando uma falha transitória dura além do pico inicial; não presuma que qualquer um exista sem código e runtime compatíveis.

Depois do pico, avance até a recuperação técnica. Correlacione o primeiro sinal saudável com mudanças observadas no workload, configuração, cache, fila ou dependência. Em Kubernetes, não use apenas contadores de restart: compare também horários de criação e desaparecimento de pods, replica count, rollout hash, imagem/digest e eventos, porque excluir e recriar um pod pode manter `restarts_total = 0`. Se duas ou mais variáveis mudarem na mesma janela, aplique a regra de intervenção composta e não atribua contribuição individual sem evidência discriminante.

Mantenha relógios de encerramento separados: último erro correlato, retorno da taxa à baseline, primeira evidência de jornada saudável e normalização declarada. Eles podem divergir e não devem ser condensados num único horário. Ausência de mensagem operacional acessível não prova ausência de contenção; nesse caso, registre a ação como desconhecida.

## 6. Compatibilidade entre runtime e snapshot

Registre imagem, tag, digest, build ou versão observada. Mapeie-a para commit/revisão e para o snapshot isolado do caso.

- correspondência demonstrada: código pode sustentar o mecanismo histórico;
- versão apenas aproximada ou mapeamento ausente: código fica como `INFERIDO` e genérico;
- incompatibilidade demonstrada: descarte o snapshot para afirmações históricas e registre a lacuna.

Não use `HEAD`, branch atual ou arquivo indexado sem revisão para afirmar o comportamento do incidente.

## 7. Auditoria de contradições

Antes de congelar a conclusão, responda explicitamente:

1. O cliente/tenant ou identificador equivalente foi localizado no escopo escolhido?
2. O serviço/dependência escolhido emitiu anomalia compatível com o sintoma na janela?
3. Os candidatos alternativos de cluster e jornada foram comparados ou refutados?
4. O código citado corresponde à versão executada ou foi rotulado apenas como mecanismo genérico?
5. Primeiro impacto, primeira anomalia, contenção e recuperação usam relógios compatíveis?
6. Alguma evidência negativa veio de tráfego genérico, escopo não confirmado ou consulta vazia?
7. A ação preventiva deriva de um sinal de runtime que antecedeu ou acompanhou o impacto?
8. O candidato a primeiro ponto anômalo sobreviveu à comparação com eventos anteriores e com a amplitude do cluster?
9. Se o impacto persistiu além do pico inicial, o prolongamento por cache, fila, retry, fallback ou projeção foi testado no código e no runtime?
10. A recuperação foi procurada até o primeiro sinal saudável, sem encerrar a janela quando apenas um erro local diminuiu?
11. A varredura preservou dependências e endpoints distintos, ou agregou sinais diferentes sob um rótulo genérico cedo demais?
12. A investigação de workload comparou criação/substituição de pods, hashes e imagens, além de `restarts_total`?
13. Último erro, retorno à baseline, jornada saudável e normalização declarada foram mantidos como relógios separados?
14. A matriz de dependências do onset classificou todas as famílias vistas nos logs brutos, ou a conclusão parou na primeira assinatura convincente?
15. O contrato de erro foi seguido até uma fronteira de persistência, repetição ou projeção, incluindo TTL/invalidação quando houver cache?
16. A conclusão explica todas as superfícies materiais vistas no ticket ou no runtime, ou somente o primeiro sintoma para o qual apareceu uma cadeia plausível?
17. A duração atribuída a cada mecanismo é compatível com seu último erro, repetição, TTL e recuperação observados?

Qualquer resposta `não` ou `desconhecido` limita a conclusão correspondente. Não declare causa raiz, blast radius fechado ou sinal preventivo comprovado enquanto a contradição relevante permanecer aberta. Registre o próximo teste de maior poder discriminatório.

## 8. Saída permitida

- Escopo confirmado + runtime compatível + mecanismo ligado à revisão: pode avançar para causa técnica conforme a escada causal.
- Escopo confirmado + mecanismo observado, mas revisão/defeito iniciador ausente: `mecanismo causal confirmado; defeito iniciador não determinado`.
- Escopo não confirmado ou apenas código plausível: `POST MORTEM — DIAGNÓSTICO PARCIAL`.
- Ferramenta obrigatória falhou estruturalmente: siga `dsh-preflight.md`, marque `FALHA ESTRUTURAL DE CAPACIDADE` e não aceite a execução como diagnóstico concluído.
