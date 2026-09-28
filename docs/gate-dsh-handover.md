# Gate no DSH — recorte inicial

## Use cases observados em produção (NSTech)

Fonte: 22 conversas com `assistantMode=voidr-gate` na organização NSTech. As contagens abaixo são de mensagens, não de pessoas nem de PRs distintos.

| Caso | Prompt observado | Evidência | Estratégia DSH | Estado |
| --- | --- | --- | --- | --- |
| 1. PRs bloqueados | “Quais os PRs bloqueados atualmewnte?” | [Conversa](https://platform.voidr.co/c/6aab0bbce535a7c79f415395) | `voidr_gate_list_pr_analyses`, paginação e filtro pelo `action` do veredito; distinguir Gate de estado vivo do provedor | Validado pelo usuário no smoke local em 28/09/2026 |
| 2. Detalhar PR | “Consegue me falar detalhadamente sobre o pr 2173?” | [Conversa](https://platform.voidr.co/c/6aab0bbce535a7c79f415395) | `voidr_gate_get_pr_analysis`, depois impacto/evidência quando necessário | Validado pelo usuário no smoke local em 28/09/2026 |
| 3. Explicar bloqueio | “Por que bloqueia?” no contexto de uma decisão | [Conversa](https://platform.voidr.co/c/6a906fd71e7f2cc074077161) | Resolver `analysisId` do contexto e ler governança, evidência e estado da pipeline | Validado pelo usuário no smoke local em 28/09/2026 |
| 4. URL do PR | “consegue me mandar a url do pr?” | [Conversa](https://platform.voidr.co/c/6aab0bbce535a7c79f415395) | Retornar somente URL presente no resultado autenticado da análise | Validado pelo usuário no smoke local em 28/09/2026 |
| 5. Criar jornada de negócio | “I want to create a new business journey.” / “Quero criar uma nova jornada de negócio.” | [Exemplo](https://platform.voidr.co/c/6ab18ae2c4398e47f16ffd73) | Resolver aplicação e repositórios; no modo manual, usar `JourneyProposalConfirm` e só chamar `voidr_gate_create_journey` após submissão; mostrar `MatchJobProgress` | Validado pelo usuário no smoke local em 28/09/2026 |

Não interpretar `BEHAVIOR_DELTA` sozinho como “bloqueado”: o PR 2173 analisado no histórico tinha `action=comment` e posteriormente foi mesclado. A resposta deve declarar a data/fonte do veredito e não afirmar estado atual do provedor sem consulta ao vivo.

## Smoke local

- Worktrees isoladas `codex/gate-dsh` em Service, Hive, Platform, Plugin, Gate e Collector. O core do Gate não foi alterado para a integração.
- Service `:3000`, Hive `:3001`, Platform `:3030`, gateway DSH `:3071`, Gate `:3090`, Mongo `:27017` e Redis `:6379` responderam localmente.
- O Mongo `voidr-gate` contém o recorte NSTech: 17 repositórios, 10 jornadas, 924 análises de PR, 6.606 regras, 361 avaliações, 1.623 eventos de regra, 66.664 nós e 120.724 arestas. O `voidr.application` local recebeu 13 metadados NSTech.
- Os testes de roteamento/guia do Service, os 38 testes direcionados da Platform e a suíte do Plugin passaram. O TypeScript global da Platform ainda tem erros preexistentes; nenhum erro apareceu nas linhas novas do Gate.
- A NSTech local abriu `/voidr-gate`, exibiu os dados importados e usou o Assistant com DSH. O usuário validou os cinco casos acima na UI local em 28/09/2026.
- Para o smoke, o Gate local aceitou a audiência da credencial ADC apenas em loopback e desenvolvimento; o Service local não requisitou o token do broker para o Gate em loopback. Essas adaptações são locais e não fazem parte da integração de produção.
- Após reiniciar o DSH, uma conversa anterior continuou listada no Mongo, mas seu histórico retornou `session-not-found`. Uma nova conversa criou sessão e carregou histórico normalmente; o usuário continuou o smoke nela.
