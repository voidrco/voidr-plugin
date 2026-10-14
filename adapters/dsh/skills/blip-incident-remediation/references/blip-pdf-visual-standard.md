# Padrão visual de diagnósticos no Assistant e Slack

A rota ativa é `evidence_reports_create` do Service, carregando `voidr-evidence-report` e suas referências de contrato e design informacional. O Service mantém identidade por organização autenticada, fonts locais, HTML privado e PDF A4. Nunca substitua o cliente por outro para gerar.

Use Space Grotesk Light nos títulos e Inter Light/Medium no conteúdo; logo oficial Blip adequado ao branco e Voidr oficiais, sem recriar, recolorir ou distorcer. O modelo não envia logos, CSS, HTML ou URLs remotas. Legibilidade vem de hierarquia, contraste, espaço e blocos pagináveis, não de reduzir fontes para caber.

Abra com decisões e próximos passos, depois achados técnicos com fontes adjacentes e anexos referenciados. Preserve matriz de cobertura, escada causal, timeline e livro de evidências com todos os campos, sem exigir uma tabela de oito colunas. Cada classificação é escrita; cor não substitui significado. Limitações acompanham conclusões afetadas.

Sempre gere e anexe o PDF da investigação no Slack, incluindo diagnóstico parcial. `ready` confirma geração; o upload confirmado na conversa confirma entrega. Preserve leitura de imagens, sanitização e métricas do transporte.

Revise todas as páginas, especialmente fontes, marcas, tabelas/continuações, relações nos diagramas, imagens, cortes e títulos sem conteúdo. Verifique também leitura digital e referências navegáveis. Registre limitações quando não houver capacidade de revisão visual.

## Compatibilidade offline legada

Os assets Lexend, capas e `scripts/render_blip_postmortem.py` permanecem para consumidores offline existentes. Sua ordem literal e suas fontes não se aplicam ao Assistant/Slack. O arquivo `blip-postmortem-format.md` continua como inventário de conteúdo técnico, não como ordem visual obrigatória dessa rota.
