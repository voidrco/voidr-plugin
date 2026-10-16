# Insumos, correlação e prontidão no runtime

Leia ao registrar `blip_investigation_checkpoint`. Este contrato implementa os controles de proveniência do playbook v0.6.4; não certifica causalidade nem substitui a escolha dos testes.

## Fonte de cada insumo

O runtime retém o documento retornado pela ferramenta e decodifica envelopes JSON. `blip_investigation_status` inclui `roots` com caminhos canônicos através dos envelopes. Use `blip_read_receipt({callId,mode:"browse"})` para listar os campos da raiz útil, ou informe `pointer`, `offset` e `limit` (1–60) para navegar/paginar. A lista contém caminhos, tipos e tamanhos, sem despejar valores. Ponteiro inválido retorna `valueOmitted:true`, motivo e navegação; objeto grande retorna seus campos. Texto grande pode ser lido em janelas com `offset/limit` (100–20000), identificadas como parciais; não confunda trecho com valor integral. `blip_investigation_status` lista os recibos disponíveis; `blip_read_receipt({callId,pointer})` lê campos sem nova coleta. Use JSON Pointer (RFC 6901): `""` é a raiz, `/rows/0` é o primeiro registro, `~1` representa `/` e `~0` representa `~` em nomes de campos. Use os caminhos retornados; o prefixo do envelope faz parte da referência de evidência.

Cada item de `inputs` contém:

- `id`: nome local do insumo, usado em `requires` e nas correlações.
- `kind`: `ticket`, `organization`, `bot`, `operation`, `attempt`, `url`, `payload` ou `value`.
- `stage`: `example`, `prepared`, `observed` ou `consumed`.
- `timeBasis`: `incident`, `current` ou `unknown`. Classifique conforme a versão/instante da fonte, não conforme a conclusão desejada.
- `source`: `{callId,recordPointer,valuePointer}`. `recordPointer` seleciona um objeto; `valuePointer` seleciona o campo dentro dele. O valor é extraído pelo runtime.

Para um ID/URL em texto, `source.selection` pode selecionar um trecho literal único dentro do campo. Não normaliza, não executa regex e não aceita um valor ausente ou ambíguo. Texto puro é exposto pelo runtime como `{text:...}`. Em envelopes MCP, o caminho pode ser `/content/0/text/rows/0`; confira o documento recebido, não presuma esse caminho.

Recibos inexistentes, de outra solicitação, com falha ou documento truncado não comprovam insumos. Campo nulo/vazio também não. Código, exemplos, campos preparados e variáveis não resolvidas não podem ser promovidos a entradas consumidas. A classificação semântica do evento continua exigindo análise da fonte: o gate verifica o campo, não interpreta sozinho todos os formatos de log.

## Correlações tipadas

Cada item de `correlations` contém `{id,kind,from,to,source}`. `from` e `to` referenciam IDs de `inputs`; `source` contém `{callId,recordPointer,fromPointer,toPointer}` e, quando necessário, `fromSelection`/`toSelection` para texto. Os dois valores precisam estar no mesmo registro. Não atravesse arrays para ligar linhas diferentes; seleções na mesma coluna de texto precisam coexistir na mesma linha.

| `kind` | Relação permitida |
|---|---|
| `identity` | Mesma categoria de identidade, ou mapeamento operação/tentativa |
| `ownership` | Organização → bot ou bot → operação/tentativa |
| `occurrence` | Ticket com ID igual a `anchor.ticketId` → operação/tentativa relatada |
| `consumption` | Operação/tentativa → URL/payload/valor com `stage:consumed` |

O vínculo de propriedade não substitui o vínculo com a ocorrência. Uma URL consumida em outra tentativa não libera o teste; é necessário o mesmo ID de operação ou uma ponte explícita de identidade. `consumed` exige recibo da fronteira de consumo, não apenas um payload construído anteriormente. Coocorrência de identificadores ainda precisa de interpretação para estabelecer o significado da relação.

## Prontidão e resultados dos pré-requisitos

Cada teste declara:

- `collection`: `discovery` para metadados/descoberta, `telemetry` para consulta de logs da ocorrência, `other` para código ou outros registros.
- `prerequisites`: lista de `{inputId,role,reason}`. Papéis: `datasource`, `workload`, `cell`, `other`. Não há mais pré-requisito em texto livre fora desse contrato.
- `requires`: exatamente os mesmos IDs únicos de `prerequisites`; não omita insumos necessários. Mesmo em localização, `collection:telemetry` exige um insumo por papel `datasource`, `workload` e `cell`. Eles podem vir de inventário/labels reais; dados de escopo atuais não são prova de cobertura histórica.
- `occurrenceId`: ID da correlação `occurrence`; obrigatório para discriminação `scope:case` pronta/executada. Inclua a operação de destino em `requires`. Nos demais testes pode ser `""`.
- `temporalScope`: `incident` ou `current`. Teste da ocorrência exige insumos com `timeBasis:incident`; uma prova atual não substitui o estado histórico.
- `produces`: `{supports_hypothesis:[ids],supports_alternative:[ids]}`. Declare antes da consulta quais insumos cada ramo conclusivo deve localizar; use listas vazias quando não produz insumos.
- `dependsOn`: `[{testId,outcome,inputIds}]`, ou `[]`. Cada ID precisa constar em `requires` e no contrato `produces` do ramo aceito. `either_supported` exige o mesmo insumo nos dois ramos.

`available:true` ou `status:executed` exige todos os insumos declarados. Dependências precisam estar executadas com o resultado aceito, e os insumos precisam vir dos recibos de resultado do teste anterior. O texto “localizado”, o resultado favorável ou só parte dos campos não bastam.

Um teste de localização com `collection:discovery` pode começar com `inputs:[]`, `correlations:[]`, `prerequisites:[]`, `requires:[]`, `occurrenceId:""`, `dependsOn:[]` se nenhum insumo concreto for necessário para aquela consulta. Esse plano permite inventário, labels e estatísticas, mas não autoriza `query_loki_logs`. Antes da busca de logs registre um plano `telemetry` com os três papéis. O UID deve ser o da consulta, e o workload deve constar como valor exato no seletor LogQL. Célula/workload precisam vir de recibo do mesmo conector/datasource; célula pode ser selecionada no nome do mesmo registro de inventário que contém o UID. Um regex abrangendo vários workloads não substitui um seletor pareado. Campos de listas de labels podem ser selecionados por índice dentro do documento; correlações entre dois valores continuam proibidas de atravessar registros distintos.

O teste dependente permanece `pending/not_tested`, `available:false`. Depois de localizar o necessário, registre novo plano pronto antes de executá-lo.

O plano prospectivo preserva tanto o contraste quanto as referências e valores de entrada. Mudança de insumo/proveniência exige novo checkpoint antes da próxima consulta; resultados antigos não podem executar esse plano novo. Checkpoints legados sem o contrato precisam ser atualizados.

Ausência de campo, documento truncado ou texto ambíguo é uma limitação daquela evidência, não prova de falta de acesso. Localize um registro menor/mais preciso usando as fontes autorizadas; só registre barreira de acesso após tentativa que a demonstre. Esses controles não inferem automaticamente todos os insumos necessários, a suficiência causal, a cobertura de uma busca vazia ou a verdade histórica de uma classificação.

Validar a origem do escopo não comprova sua pertinência ao ticket. Uma célula candidata deve continuar identificada como candidata até haver vínculo com o tenant/ocorrência; um resultado vazio nessa fonte não estabelece ausência. As regras determinísticas não interpretam toda condição que o modelo possa omitir do plano.
