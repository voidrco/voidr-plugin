# Entradas de smoke dos cinco incidentes

Use esta referência somente quando o input citar `BLIP-INC-01` a `BLIP-INC-05`. Leia apenas a entrada solicitada. O texto abaixo representa o que estaria disponível no início da investigação e não contém causa, solução, rollback, PR, GMUD ou horário de normalização.

## BLIP-INC-01 - entrada reconstruída

Não foi encontrado no canal um comunicado CCH compatível com o incidente `429814/1053978`. Os comunicados de 20/07/2026 sobre timeout na listagem de mensagens ativas e sobre mensagens não exibidas no Desk são outros incidentes.

Trate o bloco abaixo como o ticket inicial fornecido pelo usuário:

```text
🚨 COMUNICADO INICIAL

📌 Contextualização do cenário
Recebemos relato de comportamento inesperado no envio de mensagens ativas pelo WhatsApp. Parte das mensagens de campanhas ativas pode estar sendo direcionada para contatos diferentes dos destinatários originalmente previstos.

📌 Impacto percebido
Contatos podem receber mensagens que não eram destinadas a eles, enquanto o destinatário esperado pode deixar de receber a comunicação da campanha.

📌 Status da situação
Investigação — Times técnicos mobilizados.

📌 Ações em andamento
Validação do relato, coleta de evidências e delimitação do escopo afetado nos fluxos de Active Campaign e WhatsApp.

❗ Primeiro relato conhecido: 20/07/2026 11:52 (GMT-3)
🌎 Cluster(s) com impacto: ainda não identificado.
```

## BLIP-INC-02 - entrada reconstruída

Não foi encontrado no canal um comunicado CCH compatível com o incidente `424382/1036255`. O comunicado de 15/06/2026 sobre atrasos em notificações ativas no cluster Golden foi resolvido no mesmo dia e descreve outro incidente.

Trate o bloco abaixo como o ticket inicial fornecido pelo usuário:

```text
🚨 COMUNICADO INICIAL

📌 Contextualização do cenário
Recebemos relatos de campanhas que permanecem com o status “Enviando” ou aparecem como enviadas, mas os disparos das mensagens não são realizados.

📌 Impacto percebido
Os contatos das campanhas afetadas não recebem as mensagens previstas, apesar de a interface indicar processamento ou envio da campanha.

📌 Status da situação
Investigação — Times técnicos mobilizados.

📌 Ações em andamento
Coleta de exemplos de campanhas afetadas, validação do fluxo de disparo e análise inicial do processamento no Broadcast.

❗ Primeiro comportamento conhecido: 15/06/2026 12:17 (GMT-3)
🌎 Cluster(s) com impacto: ainda não identificado.
```

## BLIP-INC-03 - CCH real

- Incidente: `423935/1035378`
- Correspondência: comprovada por data, sintoma e produto.
- Comunicado CCH inicial: https://blip-ai.enterprise.slack.com/archives/C08MGJ6F596/p1781701473911959
- Sintoma declarado: dificuldade para selecionar templates cadastrados em envios de mensagens ativas.
- Escopo inicialmente declarado: Caramelo e Husky, com potencial impacto em outros clusters.

Trate o bloco abaixo como o ticket inicial fornecido pelo usuário:

```text
🚨 COMUNICADO INICIAL

📌 Contextualização do cenário
Identificamos um cenário que pode impactar clientes na utilização de templates previamente cadastrados para envios de mensagens ativas. Alguns clientes estão relatando dificuldade para selecionar templates cadastrados.

📌 Status da situação
Investigação — Times técnicos mobilizados.

📌 Ações em andamento
Análises em conjunto com a Engenharia, coleta de evidências e tentativas de reprodução do comportamento.

❗ Início da falha: 16/06/2026 18:16 (GMT-3)
🌎 Cluster(s) com impacto: Caramelo e Husky, com potencial impacto para os demais clusters.
```

## BLIP-INC-04 - CCH real

- Incidente: `438455/1095813`
- Correspondência: comprovada por data, sintoma, produto e cluster.
- Primeiro comunicado CCH encontrado: https://blip-ai.enterprise.slack.com/archives/C08MGJ6F596/p1789479611472789
- Alerta humano anterior: https://blip-ai.enterprise.slack.com/archives/C08MGJ6F596/p1789477659966009
- Sintoma declarado: notificações ativas via Growth permanecem com status `NOT PROCESSED`.
- Escopo inicialmente declarado: principalmente clientes do cluster Beagle.

Use a mensagem CCH como âncora e o alerta humano apenas para estabelecer a primeira comunicação conhecida.

Trate o bloco abaixo como o ticket operacional fornecido pelo usuário:

```text
🚨 ATUALIZAÇÃO

📌 Impacto para os clientes
Os clientes podem continuar enfrentando dificuldades no envio de mensagens ativas, com mensagens apresentando o status NOT PROCESSED.

🌎 Cluster(s) com impacto: Beagle.

📌 Ações realizadas
- Análise do cenário pelos times mobilizados.
- Testes práticos de disparo, com o problema ainda ocorrendo.

📌 Ações em andamento
- Análise dos logs do cluster Beagle, incluindo falhas em comandos direcionados ao Builder, requisições de Flow States e validações de campanhas.
- Cruzamento dos chamados e investigação de registros relacionados a nomes de campanhas duplicados e falhas pontuais na exclusão ou validação de campanhas.
- Avaliação de possível impacto associado a uma alteração recente de validação de parâmetros em requisições.

❗ Início da falha declarado: 15/09/2026 08:40 (GMT-3)
Total de tickets associados no momento da atualização: 17.
```

## BLIP-INC-05 - CCH real

- Incidente: `432759/1060258`
- Correspondência: comprovada por data, sintoma e cluster.
- Comunicado CCH inicial: https://blip-ai.enterprise.slack.com/archives/C08MGJ6F596/p1786047919418789
- Sintoma declarado: respostas de bots levando de 10 segundos a 1 minuto.
- Escopo inicialmente declarado: cluster Take.

Trate o bloco abaixo como o ticket inicial fornecido pelo usuário:

```text
🚨 COMUNICADO INICIAL

📌 Contextualização do cenário
Identificamos que os clientes podem estar sentindo lentidão ou demora nas respostas do bot para o contato, levando entre 10 segundos e 1 minuto para responder.

📌 Status da situação
Investigação — Times técnicos mobilizados.

📌 Ações em andamento
As equipes identificaram uma atualização recente que pode estar associada à ocorrência e iniciaram sua reversão. O ambiente permanece em monitoramento.

❗ Início da falha: 05/08/2026 20:00 (GMT-3)
🌎 Cluster(s) com impacto: Take.
```

## Proveniência e limites

- `BLIP-INC-01` e `BLIP-INC-02` são reconstruções, não mensagens publicadas no Slack.
- `BLIP-INC-03`, `BLIP-INC-04` e `BLIP-INC-05` apontam para mensagens reais do app CCH Custom Alert.
- Não use os post-mortems como fonte durante o smoke. Eles serviram apenas para produzir as duas entradas reconstruídas e para confirmar a correspondência dos três comunicados reais.
