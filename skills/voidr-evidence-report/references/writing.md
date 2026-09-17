# Redação técnica

Adaptado dos critérios de linguagem do `linkedin-ghostwriting` do repositório
`voidr-gtm`, sem importar persuasão comercial, hooks ou chamadas para engajamento.

- Abra com o fato, o fluxo afetado e a consequência observada.
- Prefira frases completas, voz ativa e termos precisos. Use nomes de endpoints,
  códigos HTTP e trechos de erro quando explicarem o comportamento.
- Resumo de até 650 caracteres. Como referência editorial, 3–8 páginas; o limite
  técnico é 20. Use apenas o espaço necessário para preservar as evidências.
- Separe fato, hipótese e recomendação. Diga o que não foi medido ou reproduzido.
- Não transforme uma ocorrência em taxa de falha; informe numerador e denominador
  quando ambos existirem. Nunca invente impacto financeiro ou número de usuários.
- Evite “robusto”, “poderoso”, “revolucionário”, “de forma significativa”,
  “é importante ressaltar”, “vale destacar”, “em um mundo cada vez mais”,
  “mergulhar”, “alavancar”, “desbloquear valor” e “em suma”.
- Evite perguntas retóricas, slogans, emojis, intensificadores e a fórmula
  “não é sobre X, é sobre Y”. Não repita o resumo na conclusão.
- Tabelas devem comparar dimensões equivalentes. Snippets mostram somente as
  linhas necessárias; preserve a mensagem exata e marque cortes com [...].

Ruim: “Uma falha crítica e complexa compromete significativamente a jornada.”
Bom: “O POST /recomendacao retornou HTTP 403. A execução não gerou a recomendação PJ.”

Ruim: “O CORS é definitivamente a causa raiz de todos os erros.”
Bom: “O navegador bloqueou a resposta por CORS. O material fornecido não inclui
os logs do servidor; a origem da configuração incorreta permanece em análise.”
