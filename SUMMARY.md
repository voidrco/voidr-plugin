# Suporte ao Claude Code, mantendo o Copilot

Branch `feat/claude-code-support` → `main` · 5 commits · 23 arquivos ·
+1687 / −87

O plugin passa a servir **dois hosts a partir de um repo**: GitHub Copilot CLI
e Claude Code. Nenhum arquivo do Copilot mudou de lugar, e os 186 testes
originais passam sem edição.

---

## Por que um repo, e não dois

~95% do que existe aqui é compartilhado: `scripts/lib/` (21 módulos), o bridge
MCP (~1.600 linhas), `policy/tool-policy.json`, `templates/`, as 8 skills, os
23 arquivos de teste. O que diverge são 3 manifestos e uma camada fina de
adaptação.

O argumento decisivo não é economia de código, é **segurança**: o
`validate-plugin.mjs` tem asserções que casam regex no texto literal das
SKILL.md para garantir os gates de aprovação humana, e o bridge é onde vive a
filtragem dos tools de Hive. Dois repos = duas superfícies de política que vão
divergir, e o modo de falha é um repo esquecer um gate.

Análise completa em [`docs/claude-plugin-support.md`](docs/claude-plugin-support.md).

## O que foi construído

`scripts/lib/host.mjs` resolve as três diferenças reais entre os hosts. A
detecção vem do payload — o Claude carimba `hook_event_name` em todo hook e o
Copilot não — então os dois CLIs convivem na mesma máquina.
`VOIDR_PLUGIN_HOST` força um dos dois em teste.

| | GitHub Copilot CLI | Claude Code |
|---|---|---|
| Nome do plugin | `copilot` | `voidr` |
| Manifesto | `plugin.json` | `.claude-plugin/plugin.json` |
| Marketplace | `.github/plugin/marketplace.json` | `.claude-plugin/marketplace.json` |
| Hooks | `hooks.json` | `hooks/hooks.json` |
| MCP | `.mcp.json` | `mcp/claude.json` |
| Plugin root | `${PLUGIN_ROOT}` | `${CLAUDE_PLUGIN_ROOT}` |
| Invocação | `/copilot:voidr-connect` | `/voidr:voidr-connect` |

O único conflito de arquivo era o `.mcp.json`, por causa da variável de root; o
manifesto do Claude aponta para um arquivo próprio, e o validador assere
paridade campo a campo entre os dois.

### As três diferenças que exigiram projeto

- **`UserPromptSubmit` não reescreve o prompt.** A nota de roteamento sai do
  `prompt-router.mjs` como `guidance`, e cada host serializa do seu jeito.
- **`Stop` do Claude** lê `decision`/`reason` no topo e entrega
  `last_assistant_message` direto — o gate de evidência não parseia transcript
  nesse caminho.
- **Tools escopados** `mcp__plugin_voidr_voidr__*`. O `canonicalToolName` já
  removia o prefixo; agora tem teste, porque quebrar isso abre todos os gates em
  silêncio.

## Bugs corrigidos durante a revisão

Duas passadas de revisão (manual + automatizada) acharam 7 problemas. Os quatro
primeiros eram **fail-open ou deadlock**, nenhum visível nos testes — porque a
primeira leva de testes cobria formato de wire e não fluxo.

| # | Problema | Impacto |
|---|---|---|
| 1 | Respostas do `AskUserQuestion` nunca gravadas | **Bloqueante.** Parser só entendia o formato Copilot. No Claude o usuário clicava em "Criar novo Test Plan", nada era registrado, e todo tool call seguinte era negado para sempre. O fluxo travava na primeira pergunta obrigatória. |
| 2 | `NotebookEdit`, `Grep`, `Glob` invisíveis | **6 gates abertos.** `Grep` lia `.env`; `NotebookEdit` escrevia fora do repositório selecionado. Os padrões exigem fronteira antes da palavra, e "notebook" precede "edit". |
| 3 | `permissionDecision: 'allow'` com `updatedInput` | No Claude o `allow` pula o prompt de permissão: injetar evidência num defect **aprovava a mutação automaticamente**. |
| 4 | Timeout de 5s num gate de segurança | Um `PreToolUse` cancelado por timeout no Claude **falha aberto**. O guard roda em ~80ms; subido para 15s e asserido no validador. |
| 5 | `??` no lugar de `\|\|` | Regressão do Copilot: com `transformedPrompt` vazio, a mensagem do usuário era substituída pela nota de roteamento. |
| 6 | Gate de `Stop` sem saída | O Claude não tem `stop_hook_active`. Um modelo que não produzisse os links travava a conversa para sempre. |
| 7 | Nota de roteamento com nome errado de skill | `/voidr-develop-tests` não existe no Claude. |
| 8 | Parágrafo de recuperação de tool só descrevia o Copilot | As 7 skills que o têm fechavam com `If no activation entry lists it … stop.` No Claude nunca existe activation entry, então lido literalmente isso instruía o modelo a **desistir** de um tool que estava a um `ToolSearch` de distância. Agora nomeia os dois mecanismos. |

### Duas decisões que valem revisão explícita

**Autoria em `AskUserQuestion`.** Os gates dependem de saber se o texto foi
digitado ou clicado — clique nunca é autoria. O Claude não marca nenhum dos
dois, então a autoria é inferida das labels oferecidas em `questions[]`. As
labels são reunidas num conjunto único, **sem casar por pergunta**, de
propósito: casar por chave faria a inferência depender de `answers` usar
exatamente aquela chave, e se a chave diferisse todo clique passaria por
digitado — a única direção em que isso não pode falhar.

O guarda para conjunto vazio é `offered.size > 0`: `options` tem `minItems: 2`,
então uma pergunta sem opções não é uma forma que o Claude produz, e conjunto
vazio significa payload malformado — onde um clique é indistinguível de um texto
digitado, e nenhum dos dois é confiável. Texto digitado real chega pelo "Other"
que o seletor sempre oferece, como uma resposta que não é nenhuma das labels.

**O gate de `Stop` agora desiste após 3 bloqueios**, e isso vale para o Copilot
também. É a única mudança de comportamento intencional no host existente:

```
antes:  block → block → block → block → block …
agora:  block → block → block → allow (com systemMessage nomeando os links)
```

Desistir em silêncio é indistinguível de um requisito satisfeito, então o
release emite um aviso. Se preferirem manter o Copilot bloqueando
indefinidamente, é uma linha — `MAX_CONSECUTIVE_BLOCKS` condicional por host.

## Verificação

- **`npm run check`** — 202 pass, 2 skipped, 0 fail (+14 e2e).
- **Não-regressão no Copilot** — worktree em `6b85fcc`, 17 prompts e 15
  payloads de tool replicados pelos dois conjuntos de hooks; os payloads de
  tool duas vezes, fora e dentro de um workflow ativo, que é onde moram os
  gates de escrita. **50 saídas idênticas byte a byte.** O estado que um
  `ask_user` grava foi comparado campo a campo à parte, porque ali a saída é
  vazia e só o estado importa.
- **`claude plugin validate --strict`** nos dois manifestos, com o CLI real.
- **Handshake MCP** contra `mcp/claude.json` — bridge sobe, 13 tools locais +
  40 remotos, **0 tools de Hive**.
- **Carregamento real** com `claude --plugin-dir .` — as 8 skills entram como
  `voidr:voidr-<name>`, os tools como `mcp__plugin_voidr_voidr__<tool>`.
- **Formato do `AskUserQuestion`** confirmado com payload capturado de uma
  sessão real, não inferido do schema. Os fixtures reproduzem a estrutura
  observada.

## O que falta

**Exercitar a sequência gated de ponta a ponta** numa sessão interativa:
connect → plan mode → aprovação digitada → smoke → deploy. As peças estão
verificadas individualmente; a costura entre elas não.

Dois pontos para observar nesse teste:

- Os 53 tools do MCP entram como **deferred** no Claude, carregados via
  `ToolSearch`. O parágrafo de recuperação das skills agora manda o modelo por
  esse caminho (achado 8), mas **não foi verificado em sessão interativa** se ele
  de fato recorre ao `ToolSearch` a partir dessa instrução. Primeiro lugar para
  olhar se ele hesitar ao chamar um tool Voidr.
- Subagentes do Claude nunca recebem mensagem digitada do usuário, e o guard
  bloqueia escrita de Test Plan delegada. Por isso **não foram criados
  subagentes** (o equivalente aos `agents/openai.yaml`): só serviriam para
  brigar com os gates.

## Notas para quem revisar

- **A versão não foi bumpada.** Continua `0.2.22` nos quatro manifestos, e o
  validador exige que fiquem iguais. Release é decisão de vocês.
- **Cuidado ao instalar com escopo de usuário enquanto desenvolve.** Uma sessão
  limpa não é afetada — todo gate de workflow checa `workflowActive` antes.
  Mas o prompt hook arma essa flag só pelo texto, e o `isDevTestFlowPrompt`
  casa pedidos comuns como *"escreve os testes dessa funcionalidade"*, sem
  nenhuma menção a Voidr. A partir daí toda escrita de arquivo é negada até
  selecionar um repositório de teste Voidr. Use `--plugin-dir` ou
  `--scope project`.
- **Onde olhar primeiro:** `scripts/lib/host.mjs` (a camada inteira, 104
  linhas) e `collectClaudeAskAnswers` em `scripts/lib/session-state.mjs` (a
  inferência de autoria). O resto é manifesto e teste.

## Como testar

```sh
npm run check

# Sem instalar nada: carrega o plugin só nessa sessão.
cd /algum/projeto/descartável
claude --plugin-dir /caminho/para/voidr-copilot-plugin
```
