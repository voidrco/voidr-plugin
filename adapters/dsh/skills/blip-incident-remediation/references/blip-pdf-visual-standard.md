# Padrão visual do PDF Blip

O diagnóstico final deve ser entregue como PDF A4 com a identidade visual do post-mortem oficial da Blip. Markdown e JSON são artefatos intermediários; não substituem o PDF.

## Fonte canônica do layout

Use o gerador [scripts/render_blip_postmortem.py](../scripts/render_blip_postmortem.py). Ele combina:

- `assets/blip-cover-pages.pdf`: separador de idioma e capa azul oficial;
- `assets/blip-content-page.pdf`: cabeçalho, logotipo e estrutura visual oficial das páginas internas;
- `assets/Lexend-Regular.ttf` e `assets/Lexend-Bold.ttf`: tipografia do documento;
- conteúdo estruturado do diagnóstico em JSON.

Os PDFs de assets contêm somente a identidade visual de referência. O gerador mascara o conteúdo do incidente usado como referência antes de inserir o diagnóstico atual. Nunca extraia ou reutilize fatos do incidente de referência.

## Regras visuais obrigatórias

- tamanho A4, orientação retrato;
- página inicial `Versão em Português`, seguida da capa azul `POST MORTEM`;
- cabeçalho interno com logotipo Blip, faixa azul, título `POST MORTEM`, classificação e `PÁGINA N DE N`;
- rodapé com linha, classificação do documento e aviso de propriedade;
- fonte Lexend; títulos em negrito, texto regular;
- títulos numerados e em caixa alta;
- tabelas com bordas cinza, cabeçalho cinza e linhas alternadas discretas;
- azul Blip somente para navegação, destaque e relações confirmadas;
- grafo legível dentro da largura útil, com estado da evidência escrito no nó;
- nenhuma PII, segredo ou payload sensível.

Não reconstrua o documento por HTML/CSS ou impressão do browser quando o gerador estiver disponível. Isso cria variação de fonte, paginação e margens.

## Contrato de entrada

O JSON deve conter:

- `title`, `classification`, `partial`, `status` e `conclusion`;
- `incident_info` com todos os oito campos obrigatórios do template;
- `events` com `datetime`, `event` e `evidence`;
- `sections` com `root_cause`, `investigation`, `solution`, `result` e `future_actions`;
- `graph`, com `title`, `legend`, `nodes` e `edges`, ou uma `image` local;
- `evidence` com as oito colunas do livro de evidências;
- `causal_ladder`;
- `coverage`;
- `limitations` e `next_unlock`.

Cada nó do grafo deve ter `id`, `label`, `state` e, para o primeiro ponto anômalo, `anomaly: true`. Cada aresta deve ter `from`, `to`, `label` e `inferred`; arestas inferidas aparecem tracejadas.

Use `classification: "INTERNA — RASCUNHO"` por padrão. `PÚBLICA` exige `public_release_authorized: true` e autorização explícita do usuário.

## Geração

Use o Python do runtime do workspace quando disponível:

```bash
python3 scripts/render_blip_postmortem.py diagnostico.json post-mortem.pdf
```

O arquivo de saída deve ter nome estável, por exemplo `POST_MORTEM_<ticket>.pdf`.

## Verificação antes da entrega

1. execute `pdfinfo` e confirme A4, quantidade de páginas e ausência de erro;
2. renderize todas as páginas em PNG com `pdftoppm`;
3. inspecione visualmente separador, capa, primeira página interna, páginas de tabelas, grafo e última página;
4. confirme que nenhum texto se sobrepõe, é cortado ou sai das margens;
5. confirme que a classificação e a paginação estão corretas em todas as páginas;
6. confirme que as seções, campos e colunas obrigatórias continuam presentes;
7. se houver problema, corrija o JSON ou o gerador e repita o ciclo.

Entregue o PDF final e, quando ajudar a auditoria, mantenha o JSON ao lado dele. O PDF é o artefato principal.
