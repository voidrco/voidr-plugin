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
