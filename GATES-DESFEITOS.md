# O que foi desfeito nesta branch

**Branch:** `release-no-gates`
**Base:** `origin/main` @ `574cf99`
**Commit:** `4769f22`
**Data:** 2026-08-19
**Propósito:** exercitar o plugin sem fricção de gates. **Não é para merge.**

---

## Resumo

Os dois hooks que **negam** foram desconectados nos dois hosts. Nada que orienta ou
enriquece foi tocado. Nenhum script foi apagado — só desligados do wiring.

| Hook | Copilot | Claude | Situação |
| --- | --- | --- | --- |
| Rota de prompt | `userPromptTransformed` | `UserPromptSubmit` | ✅ mantido |
| Policy gate | `preToolUse` | `PreToolUse` | ❌ **removido** |
| Links de execução | `postToolUse` | `PostToolUse` | ✅ mantido |
| Gate de resposta | `stop` | `Stop` | ❌ **removido** |

Arquivos alterados: 4 · 9 inserções · 75 remoções

---

## 1. `hooks.json` (Copilot) — 16 linhas removidas

Removidas as entradas `preToolUse` e `stop`. Ambas chamavam:

```
VOIDR_HOOK_ROOT="${PLUGIN_ROOT:-${COPILOT_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-…}}}"
node "$VOIDR_HOOK_ROOT/scripts/guard-hive-tools.mjs"        # preToolUse
node "$VOIDR_HOOK_ROOT/scripts/require-execution-links.mjs" # stop
```

com variante PowerShell equivalente e `timeoutSec: 5`.

## 2. `hooks/hooks.json` (Claude) — 22 linhas removidas

Removidas `PreToolUse` e `Stop`:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/guard-hive-tools.mjs"         # PreToolUse
node "${CLAUDE_PLUGIN_ROOT}/scripts/require-execution-links.mjs"  # Stop
```

ambas com `timeout: 15`.

## 3. `scripts/validate-plugin.mjs` — 5 asserts removidos

O validador **exigia** o wiring removido e falhava com:

```
- A preToolUse policy hook is required.
- The Hive guard must run on preToolUse.
- Responses backed by executions must be blocked until they include links.
- hooks/hooks.json must run guard-hive-tools.mjs on PreToolUse.
- hooks/hooks.json must run require-execution-links.mjs on Stop.
```

Removidos os blocos `preToolHooks` e `stopHooks` (lado Copilot) e as entradas
`PreToolUse` / `Stop` do mapa `claudeHookEvents` (lado Claude). Uma nota no arquivo explica
que a branch é de teste.

## 4. `tests/hook-policy.test.mjs` — 1 teste pulado

`plugin hook resolves its script when VS Code omits PLUGIN_ROOT` virou `test.skip`: ele lia
`hooks.hooks.preToolUse[0].bash` do `hooks.json` para verificar a resolução do script sem
`PLUGIN_ROOT`, e essa entrada não existe mais aqui.

Os demais testes deste arquivo continuam exercendo o script do guard **diretamente**, então
a cobertura da lógica dos gates permanece.

---

## O que deixou de ser barrado

Com o `preToolUse` fora, **nenhum** destes gates roda mais:

| Gate | O que deixou de impedir |
| --- | --- |
| guarda de processos do Hive | comando de shell que dispare processo do Hive |
| `enforceConnectFirstTool` | ação antes do `voidr_auth_status` no fluxo de connect |
| `enforceEnvFileProtection` / `enforceShellEnvFileRead` | leitura de `.env` (que o `env pull` popula com segredos) |
| proteção do diretório de credenciais | leitura do store de Service Account |
| `enforceSensitiveProductRead` | leitura de dados sensíveis do produto do cliente |
| `enforcePlatformSensitiveContent` | PII entrando em conteúdo da plataforma |
| `enforceTestSpecContentPolicy` | conteúdo indevido (inclusive credenciais) dentro de `.spec` |
| `enforcePluginInstallationBoundary` | escrita dentro da instalação do plugin |
| `enforceSelectedRepositoryBoundary` | escrita fora do repo de teste selecionado |
| `enforceExplicitWorkspaceRoot` | tool de workspace sem `workspaceRoot` explícito |
| `enforceExplicitEnvironmentSelection` | ambiente inferido em vez de selecionado |
| `enforceSelectedTestPlanIdentity` | troca silenciosa do Test Plan no meio da sessão |
| `enforceTestPlanWriteApproval` | escrita `test_plans_*` sem a aprovação digitada |
| `enforcePlanModeGate` / `enforceNewPlanModeListing` | ações fora do modo de plano |
| `enforcePostSmokeStop` | novo build/deploy sem nova mensagem do usuário |
| `enforcePreSelectionWriteGate` | escrita antes de selecionar repo de teste |
| `enforcePublishThroughBridge` | publicação fora do bridge |
| `enforceVoidrCliShellUsage` | `voidr` CLI direto no terminal |
| `enforceRuntimeInstallProtection` | instalar/trocar Node por conta própria |
| `enforceDependencyStrategyProtection` | estratégia de instalação de dependências |
| `enforceRepositoryMaterializationThroughTools` | `git init` / `git remote add` fabricando checkout |
| deploy mutável legado | `voidr deploy-latest` e `npm run voidr:deploy` |

Com o `stop` fora, uma resposta que fala de execução **não é mais bloqueada** até incluir o
link da execução.

### Consequências práticas ao testar

- o agente pode **escrever em produção** via tools de plataforma sem gate de confirmação
- pode **ler `.env` e o store de credenciais**
- pode rodar `voidr` CLI e `deploy-latest` direto no terminal
- pode escrever arquivos **fora** do repo de teste selecionado

Ou seja: use em workspace descartável e org de teste, não em repositório de cliente.

---

## Como religar

```sh
git revert 4769f22
```

Ou manualmente: restaurar `preToolUse`/`stop` em `hooks.json`, `PreToolUse`/`Stop` em
`hooks/hooks.json`, os 5 asserts em `validate-plugin.mjs`, e tirar o `.skip` do teste.

Como referência, o estado íntegro está em `origin/main`:

```sh
git diff origin/main -- hooks.json hooks/hooks.json
```

---

## Estado de verificação

```
npm run validate  →  6 skills, 74 MCP tools
npm test          →  237 testes · 234 passam · 0 falham · 3 skips
```
