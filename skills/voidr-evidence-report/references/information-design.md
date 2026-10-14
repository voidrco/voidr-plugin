# Design informacional de diagnósticos

Fonte integral: orientação de Milson, `prompt-design-informacional-voidr.txt`, Drive ID `1WufNUEsTpjAo6OqFUS1xVLTF2yUUqBg6`, compartilhada em 14/10/2026. Esta referência orienta futuras composições, não apenas um PDF existente.

## Antes de escrever

Extraia evidências e preserve contradições, diferenças de contexto, fontes, horários com timezone, unidades, denominadores, versões, consultas/métodos e limitações. Consolidar redundâncias não permite retirar nuances. Pergunte apenas quando faltar uma informação que altere materialmente a conclusão. Lacuna não é zero, ausência de resultado não prova inexistência, correlação não demonstra causa.

Classifique cada afirmação relevante como fato observado, relato, interpretação, hipótese, recomendação ou limitação. Uma captura lida por IA é interpretação derivada que exige conferência na imagem, não reprodução independente do incidente. Código atual não prova a versão aplicada em produção. Hipótese precisa da verificação que falta.

## Dois percursos

Use `schemaVersion: 3` e abra com `decisionSummary`: até quatro achados essenciais, impacto conhecido e próximos passos. Conclusões parciais e seu alcance aparecem nessa abertura. O leitor deve entender o problema e decidir o próximo passo sem consultar um anexo.

Em seguida explique os achados tecnicamente. Cada achado relevante conecta problema, evidência, consequência, ação e validação; use `assessment` quando esses campos estiverem sustentados. Prioridade exige critério explícito, como primeiro desbloqueio para testar a causa ou contenção de impacto observado. Não invente responsáveis, prazos, custos, severidade ou estimativas. Não repita integralmente a síntese no aprofundamento.

Títulos comunicam achados: “A consulta cobriu um repositório; a origem continua aberta”, em vez de “Integrações”. Detalhes extensos ficam em seções `appendix: true`, referenciadas no texto. Preserve conteúdo necessário à revisão técnica, inclusive consultas e resultados negativos dentro do seu escopo. Evidências ficam próximas das afirmações, não apenas agrupadas no fim.

## Formato pela informação

Texto explica relações e mecanismos. Tabelas comparam dimensões equivalentes e conservam unidades/denominadores. Diagramas estruturados mostram fluxos; cada relação é classificada e tem fonte, com hipótese/proposta visivelmente distinta. Gráficos só representam valores verificados, com janela, unidade, denominador e método explícitos; se o contrato não suportar um gráfico adequado, use comparação tabular sem inventar séries. Não force grafo causal quando só houver sequência relatada. Não converta todo conteúdo em cards, listas, três pontos ou tabelas.

## Escrita sem AI slop

Use sujeito, ação e objeto concretos. Explique como e por que com termos precisos, mantendo a riqueza técnica. Remova slogans, adjetivos promocionais, genéricos (“visibilidade”, “robustez” sem mecanismo), enchimento, perguntas retóricas, contrastes artificiais e conclusões de efeito. Não imponha frases de duas linhas nem simplifique até perder detalhes. Evite repetir a mesma ressalva em toda página; coloque-a junto à conclusão afetada e referencie o detalhe comum. Esta revisão também vale para títulos, legendas e notas.

## Visual e entrega

O servidor usa Space Grotesk Light para títulos e Inter Light/Medium para texto, logos oficiais do cliente sobre branco e Voidr. Mantenha hierarquia, contraste e espaçamento; cor nunca é o único indicador. Não envie marcas improvisadas nem distorcidas.

Inspecione todas as páginas e a leitura digital: fontes, logos, tabelas, diagramas, cortes, quebras, títulos isolados e referências. O mesmo documento estruturado gera HTML e PDF. Na investigação Blip o PDF é obrigatório mesmo parcial e deve ser anexado no Slack. Confirme separadamente geração `ready` e upload real; preserve imagens e rodapé de tempo/tokens com seus limites de medição.
