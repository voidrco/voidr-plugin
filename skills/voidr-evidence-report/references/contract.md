# Contrato de geração

Ferramentas: `evidence_reports_create` e `evidence_reports_get` (`id` UUID).
O host qualifica os nomes MCP. O schema retornado pela ferramenta é a autoridade.
O exemplo abaixo é fictício: substitua todos os dados antes de chamar a ferramenta.

```json
{
  "applicationId": "0123456789abcdef01234567",
  "idempotencyKey": "f90ad9c4-f8de-4a1c-87c4-4e1202114ba2",
  "title": "Recomendação PJ bloqueada na consulta",
  "summary": "O material fornecido registra HTTP 403 no POST /recomendacao. A recomendação PJ não foi concluída. Não há evidência suficiente para atribuir a falha a uma mudança específica.",
  "observedAt": "2026-09-16T10:00:00-03:00",
  "environment": "Produção — informado pelo solicitante",
  "sources": [{
    "id": "E1", "kind": "supplied-document",
    "label": "Registro fornecido pelo solicitante",
    "detail": "Trecho de resposta da consulta PJ; horário informado no documento."
  }],
  "sections": [{
    "title": "Evidência da resposta",
    "blocks": [
      {"type": "paragraph", "text": "A consulta retornou HTTP 403 antes da geração da recomendação.", "evidence": ["E1"]},
      {"type": "code", "label": "Resposta HTTP", "language": "http", "code": "HTTP/1.1 403 Forbidden", "evidence": ["E1"]},
      {"type": "table", "columns": ["Esperado", "Observado"], "rows": [["Recomendação gerada", "Requisição recusada"]], "evidence": ["E1"]}
    ]
  }]
}
```

Para uma fonte de plataforma, use `kind: execution` e `executionId` ObjectId real.
O servidor verifica organização e aplicação da execução. Fontes fornecidas não
recebem selo de reprodução: são explicitamente identificadas no relatório.
Uma captura tem `type: screenshot`, `caption`, `base64` (sem prefixo data:) e
`evidence`. Somente PNG/JPEG; até quatro capturas. Não use URLs como base64.

Títulos até 110 caracteres; resumo até 650; parágrafos até 1.800; snippets até
6.000 caracteres e 160 linhas. Até 12 seções, 16 blocos por seção e 30 fontes. Tabelas têm 2–4 colunas e
até 30 linhas; cada célula até 240 caracteres. Conteúdo extenso deve ser resumido
com rastreabilidade, não copiado integralmente. O servidor rejeita blocos que não
cabem na página e não reduz a fonte para escondê-los.

A resposta contém `id`, `status`, `url`, `pages`, `expiresAt`, versão do template
e SHA-256 dos arquivos. Não contém bytes nem credenciais. O link exige sessão
ativa e associação atual à Serasa; conhecer o UUID não concede acesso. O arquivo
expira após 30 dias e pode ser revogado por um administrador da organização.

## Componentes DX v2

Use `schemaVersion: 2`. V1 permanece aceito. Cada fonte de execução pode incluir
`locator: {testCaseSlug, attempt?, step?, recordedAt?, artifact?}`. Artifact é um de
result, trace, console, network, dom ou screenshot.

- `finding`: label, status (observed/hypothesis/limitation), text, verificationGap
  (obrigatório para hipótese), evidence.
- `timeline`: label, events [{attempt, at, stage, outcome, durationMs?, evidence}],
  evidence. Outcome: passed/failed/blocked/skipped. At inclui timezone.
- `reproduction`: label, provenance (captured/adapted/validated), prerequisites
  (1–6 textos), steps (1–8 textos), expected, observed, limitations, evidence;
  request e response são opcionais. Request: method, path, authentication
  (none/bearer-placeholder), headers? [{name: Accept|Content-Type, value}], body?.
  Response: status, body?, durationMs?. O serviço monta cURL com variáveis.
- `screenshot`: caption, evidence, base64 OU frame {sourceId, testCaseSlug,
  resourceName}; redactions? e highlights? [{x, y, width, height}], coordenadas
  relativas de 0 a 1. A fonte do frame deve constar nas referências do bloco.

O documento JSON sanitizado é armazenado cifrado e entregue somente pela sessão
autenticada. A UI oferece download das evidências, links para seções/fontes e Teams.
Leia references/dx.md para escolher os componentes e validar a origem.

## Contrato de composição v3 (retrocompatível com v2)

Use `schemaVersion: 3`; a versão exige `decisionSummary`. Chamadas v2 continuam válidas para manter investigações e PDFs em andamento. Os blocos, limites e fontes anteriores continuam válidos.

`classification`: `observed`, `reported`, `interpretation`, `hypothesis`, `recommendation`, `limitation`. Não classifique relato como observação própria.

`decisionSummary`: `{ findings: [claim], impact: claim, nextSteps: [action] }`. De 1 a 4 findings e de 1 a 3 ações.
`claim`: `{ text, classification, evidence, limitation? }` (text até 800, limitation 500). Hipótese requer limitation descrevendo a verificação ausente.
`action`: `{ text, rationale, validation, priority, priorityBasis, evidence, limitation? }` (text 600; rationale/validation 500; priority 80; priorityBasis 350). Não adicione owners/deadlines inventados.

`paragraph` aceita classification e limitation opcionais; `finding.status` aceita as seis classificações e mantém verificationGap obrigatório para hypothesis.
`assessment`: `{ type, label, classification, text, problem, consequence, action, limitation?, evidence }` (label 100; text 800; problem/consequence 500). Hipótese requer limitation. Action segue o contrato acima e mantém suas próprias fontes.
`diagram`: `{ type, label, caption, nodes, edges, evidence }`. Nodes 2–4: `{id, label, classification}`, id até 20 caracteres a-z/0-9/hífen, label até 100. Edges 1–8: `{from, to, label, classification, evidence}`. IDs distintos, endpoints existentes, sem self-edge; labels até 100, caption até 500. Não envie SVG/HTML. Relações hipotéticas/interpretadas/propostas são tracejadas e classificadas por texto. A existência de seta não prova causa.

Seções aceitam `appendix: true`; referências usam os mesmos anchors `section-N`. A abertura navega para as seções técnicas. Todo evidence deve existir em sources, inclusive ações e edges. Fontes e logos são server-owned. O renderer usa fonts reais Light/Medium locais, preserva paginação e acesso privado.

## Rollout e hosts ainda em v2

Leia o schema anunciado por `evidence_reports_create` antes de compor. Service v3 aceita v2 para manter sessões em andamento. Se o host ainda anunciar apenas v2, não envie campos v3: escreva a síntese em seções iniciais paragraph/finding e inclua classificações, critérios de prioridade e validação no texto, com fontes adjacentes. Isso preserva a geração/anexo obrigatório durante o rollout. A composição tipada e o leitor v3 requerem a versão correspondente do Service/Platform; não contorne a versão com HTML, Python ou outra organização.
