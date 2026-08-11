# Suporte ao Claude Code — análise de portabilidade

Data: 2026-08-11
Base: commit `6b85fcc`, plugin versão `0.2.22`

> **Status: implementado** no branch `feat/claude-code-support`. O README tem a
> tabela de diferenças por host e as instruções de instalação nos dois CLIs.
> O resumo do que mudou em relação a este plano está em
> [Resultado da implementação](#resultado-da-implementação), no fim.

Duas perguntas:

1. É necessário mudar código para o plugin passar a suportar o Claude?
2. É melhor separar em um repo só pro Claude, ou deixar tudo em um repo que
   serve para esses (e talvez outros) agentes?

---

## 1. Precisa mudar código? Sim, mas bem menos do que parece

O núcleo é agnóstico. O que quebra é só a **camada de integração com o host**.

### Já funciona sem tocar (e boa parte não é coincidência — alguém já preparou)

| Item | Por quê |
|---|---|
| `skills/*/SKILL.md` | Mesmo formato (frontmatter `name`/`description`), mesma pasta na raiz. Claude descobre automaticamente. |
| `scripts/voidr-mcp-bridge.mjs` | MCP stdio puro. E filtra os tools remotos pela `safeRemoteTools` em `scripts/voidr-mcp-bridge.mjs:407` — ou seja, o allowlist `tools` do `.mcp.json` (que o Claude ignora) é redundante: os tools de Hive continuam invisíveis. |
| `canonicalToolName` (`scripts/lib/policy.mjs:16`) | Já casa sufixo `__`. O Claude escopa os tools como `mcp__plugin_<plugin>_<server>__<tool>` — cai no nome canônico sozinho. **Sem isso o guard inteiro seria bypassado.** |
| `session-state.mjs:21` | Já lê `session_id` além de `sessionId`. |
| `recordAskUserSelections` (`session-state.mjs:216`) | Regex `/ask.*question/i` já casa `AskUserQuestion`. |
| Saída dos hooks | Já emitem `hookSpecificOutput` + `hookEventName` — que é justamente o formato Claude. |
| Heurísticas de tool no guard (`guard-hive-tools.mjs:87,479,485`) | `bash\|shell`, `create\|edit\|write`, `read\|view` casam com `Bash`, `Write`, `Edit`, `Read`. |
| `timeout: 360000` no `.mcp.json` | Campo suportado igual no Claude. |

### Bloqueadores reais (em ordem de esforço)

#### a) `${PLUGIN_ROOT}` → `${CLAUDE_PLUGIN_ROOT}`

`.mcp.json:7`. O Claude só expande `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA`,
`CLAUDE_PROJECT_DIR` e env vars reais. `PLUGIN_ROOT` não existe lá →
**o servidor MCP simplesmente não sobe**.

Nota: `validate-plugin.mjs:54` assere a string literal `${PLUGIN_ROOT}`, então
o validador vira por-host.

#### b) `hooks.json` — formato completamente diferente

Maior item mecânico:

```jsonc
// Copilot (hoje)                  // Claude
"userPromptTransformed"        →   "UserPromptSubmit"
"preToolUse"                   →   "PreToolUse"
"postToolUse"                  →   "PostToolUse"
"stop"                         →   "Stop"

{type, bash, powershell,       →   { "matcher": "...",
 timeoutSec}                         "hooks": [{ "type":"command", "command": "..." }] }
```

O par `bash`/`powershell` some — é um `command` único. Na prática isso
**simplifica**: `node "${CLAUDE_PLUGIN_ROOT}/scripts/x.mjs"` roda nos dois
sistemas, então some toda a duplicação PowerShell que hoje ocupa metade do
`hooks.json`.

#### c) `userPromptTransformed` não existe no Claude

O `UserPromptSubmit` do Claude **não pode reescrever o prompt** — só bloquear
ou injetar `additionalContext`. O `prompt-router.mjs` devolve
`modifiedTransformedPrompt`; precisa virar:

```json
{ "hookSpecificOutput": { "hookEventName": "UserPromptSubmit",
                          "additionalContext": "..." } }
```

Semanticamente é o mesmo efeito (o texto hoje é concatenado ao prompt de
qualquer jeito) — é um adaptador de ~10 linhas na saída de
`route-voidr-prompt.mjs`, com `routeVoidrPrompt()` intacto.

#### d) `require-execution-links.mjs` — parsing de transcript

É o único lugar realmente dependente do formato interno do Copilot
(`entry.type === 'user.message'`, `tool.execution_start`,
`entry.data.toolName`). O JSONL do Claude é outro.

**Mas o Stop do Claude entrega `last_assistant_message` direto no payload**,
então a checagem "a resposta contém os links?" fica mais simples do que hoje;
e os IDs já vêm do `requiredExecutionIds` que o PostToolUse acumula no
session-state. Dá para reescrever sem transcript nenhum no caminho Claude.

#### e) `ask_user` → `AskUserQuestion`

68 ocorrências, quase todas em texto de SKILL.md e nas asserções regex do
`validate-plugin.mjs` (linhas 249, 274, 322, 331, 376, 633). Funcionalmente
equivalente, mas o contrato difere: máx. 4 perguntas × 4 opções, e sempre há um
"Other" com texto livre — o que na verdade **ajuda** os gates de aprovação
digitada tipo `Aprovo este Test Plan`. Precisa virar um termo parametrizado por
host, não literal.

#### f) Manifesto e marketplace mudam de lugar

- `.claude-plugin/plugin.json` — o `plugin.json` da raiz não é lido pelo Claude.
- `.claude-plugin/marketplace.json` — em vez de `.github/plugin/marketplace.json`.

Campos desconhecidos são ignorados; `claude plugin validate` só emite warning.

#### g) Menores

- Fallback `$HOME/.copilot/installed-plugins/...` nos 4 hooks.
- `COPILOT_PLUGIN_DATA` em `session-state.mjs:12` precisa aceitar
  `CLAUDE_PLUGIN_DATA`.
- `skills/*/agents/openai.yaml` é ignorado pelo Claude (equivalente seria
  `agents/*.md` na raiz do plugin, opcional).

### Um ponto de atenção não-mecânico

O Claude Code usa subagentes muito mais agressivamente, e subagente nunca
recebe mensagem digitada do usuário. Os gates de aprovação
(`guard-hive-tools.mjs:883` já prevê isso) vão ser exercitados muito mais.

O lado bom: o payload do Claude traz `agent_id`/`agent_type`, então dá para
detectar subagente de forma confiável em vez de inferir.

---

## 2. Um repo ou dois? **Um repo.** Com convicção.

A proporção decide: ~95% do que existe aqui é compartilhado — `scripts/lib/`
(21 módulos), o bridge (~1.600 linhas), `policy/tool-policy.json`,
`templates/test-repository/`, as 8 skills, os 23 arquivos de teste. O que
diverge são 3 manifestos e 3 adaptadores de I/O.

O argumento decisivo não é economia de código, é **segurança**: o
`validate-plugin.mjs` tem asserções que casam regex no texto literal das
SKILL.md para garantir os gates de aprovação humana. E o bridge é onde vive a
filtragem dos tools de Hive. Duplicar isso em dois repos significa duas
superfícies de política que **vão** divergir — e o modo de falha é um repo
esquecer um gate.

### E os arquivos colidem?

Quase nenhum:

| Arquivo | Copilot | Claude | Conflito |
|---|---|---|---|
| Manifesto | `plugin.json` (raiz) | `.claude-plugin/plugin.json` | não |
| Hooks | `hooks.json` (raiz) | `hooks/hooks.json` | não |
| Marketplace | `.github/plugin/marketplace.json` | `.claude-plugin/marketplace.json` | não |
| Skills | `skills/` | `skills/` | compartilhado ✔ |
| MCP | `.mcp.json` | `.mcp.json` | **sim** |

O único conflito é o `.mcp.json`, e só por causa da variável de root. Solução
sem build step: o manifesto do Claude aceita caminho custom —
`"mcpServers": "./mcp/claude.json"` — e o `.mcp.json` da raiz continua sendo o
do Copilot. Fica um arquivo de ~60 linhas duplicado, e o `validate-plugin.mjs`
assere paridade campo a campo entre os dois (menos a variável de root). É a
única duplicação do repo inteiro.

### Forma sugerida

```text
scripts/lib/host.mjs          # detecta host, normaliza payload de entrada e formato de saída
scripts/lib/prompt-router.mjs # inalterado — só a serialização muda
hooks.json                    # Copilot
hooks/hooks.json              # Claude
mcp/claude.json               # Claude (paridade validada com .mcp.json)
.claude-plugin/plugin.json
.claude-plugin/marketplace.json
```

E `npm test` vira matriz: cada teste de hook roda com payload Copilot **e**
payload Claude. Hoje os testes já alimentam os hooks por stdin, então é
parametrizar o fixture, não reescrever.

### Quando separaria

Só se o plugin Claude ganhasse fluxos que o Copilot não tem (workflows,
subagents, monitors) *e* as skills divergissem de verdade. Mesmo aí, o core
continuaria valendo mais compartilhado do que separado.

**Custo do acoplamento que sobra:** versão única para os dois hosts. No caso de
vocês isso é feature, não bug — força paridade de política.

---

## Estimativa

- Itens (a), (b), (f), (g) — mecânicos: meio dia.
- Itens (c), (d), (e) — exigem projeto de verdade (a camada `host.mjs`):
  2 a 3 dias com a matriz de testes.

---

## Resultado da implementação

Um repo, como recomendado. Nenhum arquivo do Copilot mudou de lugar, e os 186
testes originais continuam passando sem edição.

### Arquivos novos

| Arquivo | Papel |
|---|---|
| `scripts/lib/host.mjs` | Detecta o host pelo payload e serializa a saída de cada hook no dialeto dele |
| `.claude-plugin/plugin.json` | Manifesto Claude (plugin `voidr`) |
| `.claude-plugin/marketplace.json` | Marketplace Claude |
| `hooks/hooks.json` | Os 4 hooks no formato `matcher` + `hooks[]` |
| `mcp/claude.json` | `.mcp.json` com `${CLAUDE_PLUGIN_ROOT}`, sem os campos que só o Copilot lê |
| `tests/claude-host.test.mjs` | 11 testes do contrato Claude |

### Onde o plano mudou

- **Detecção de host.** Ficou no payload, não em variável de ambiente: o Claude
  carimba `hook_event_name` em todo hook e o Copilot não. `VOIDR_PLUGIN_HOST`
  existe como override para teste.
- **Guard-rail de loop no `Stop`.** Não estava no plano. O Claude não tem o
  `stop_hook_active` que quebraria o ciclo, então o gate de evidência conta os
  próprios bloqueios e libera o turno depois de 3 — senão um modelo que não
  consegue produzir os links trava a conversa. Vale para os dois hosts, e o
  contador zera a cada nova mensagem do usuário.
- **`ask_user`.** Em vez de parametrizar as 68 ocorrências, cada SKILL.md ganhou
  uma nota de host de quatro linhas mapeando o termo para `AskUserQuestion`. O
  validador exige a nota nas 8 skills. Muito menos superfície de mudança, e o
  texto dos gates continua idêntico — nenhuma das asserções regex do
  `validate-plugin.mjs` precisou ser relaxada.
- **`tools` no `.mcp.json`.** Descartado no arquivo do Claude em vez de
  duplicado. O allowlist nunca foi o ponto de aplicação — o bridge filtra por
  `policy.safeRemoteTools` (`scripts/voidr-mcp-bridge.mjs:407`). Confirmado por
  handshake real: 53 tools expostos, 0 proibidos.
- **Subagentes Claude não foram criados.** Seriam o equivalente aos
  `agents/openai.yaml`, mas subagente nunca recebe mensagem digitada do
  usuário, e o guard bloqueia escrita de Test Plan delegada
  (`guard-hive-tools.mjs:883`). Ou seja: só serviriam para brigar com os gates.

### Verificação feita

- `npm run check` — 195 pass, 2 skipped, 0 fail (14 e2e à parte).
- `claude plugin validate .claude-plugin/plugin.json --strict` e o mesmo para
  `marketplace.json` — ambos passam com o CLI real.
- Handshake MCP contra `mcp/claude.json`: bridge sobe, 13 tools locais + 40
  remotos, nenhum tool de Hive.

### O que não foi verificado

O plugin não foi instalado num Claude Code de verdade. O `PreToolUse` bloqueia
escrita antes de um repositório de teste ser selecionado, o que quebraria uma
sessão comum — a instalação tem que ser feita num workspace descartável. É o
único passo que falta antes de publicar.

---

## Referências

- [Plugins reference](https://code.claude.com/docs/en/plugins-reference) —
  layout do plugin, schema do manifesto, formato de `hooks/hooks.json`,
  `${CLAUDE_PLUGIN_ROOT}`.
- [Hooks](https://code.claude.com/docs/en/hooks) — nomes de evento, campos de
  entrada (`session_id`, `transcript_path`, `tool_name`, `tool_input`,
  `tool_response`, `last_assistant_message`) e schemas de saída.
- [MCP](https://code.claude.com/docs/en/mcp) — servidores providos por plugin e
  o esquema de nome `mcp__plugin_<plugin>_<server>__<tool>`.
