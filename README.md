# Voidr Testing plugin for GitHub Copilot CLI and Claude Code

One plugin, two hosts. The skills, the MCP bridge, the policy engine, and the
gate hooks are shared; only the manifest, the hook wiring, and the plugin-root
variable differ per host. See [Host support](#host-support).

This plugin guides a developer from “I want to develop tests in Voidr” through:

1. creating or selecting a Test Plan;
2. selecting and confirming the planning inputs before generating a draft;
3. selecting or bootstrapping one test repository;
4. implementing and validating Playwright cases;
5. requiring a PR already merged into the repository default branch;
6. deploying that exact commit as an immutable release after confirmation;
7. verifying `latest` and platform sync independently;
8. creating an execution after a second confirmation;
9. analyzing a failed execution from ClickHouse-backed Playwright evidence.

The current build uses Voidr production for browser authentication, application
discovery, Test Plans, repository provisioning, deploy, and execution. Service
Accounts use the standard production store at
`~/.voidr/service-accounts.json`, shared with the Playwright framework. It does
not call `npx voidr login` and never returns a client secret to Copilot.
`/voidr-connect` opens the official Voidr connect page, which persists the local
callback state before starting Auth0 and asks the user to choose an organization
when necessary. The temporary user token is kept only in the local Node process
and discarded after the account is created and validated.

To run an already-automated plan without the development workflow, invoke
`/copilot:voidr-create-execution` on Copilot, or `/voidr:voidr-create-execution`
on Claude Code.

## Host support

| | GitHub Copilot CLI | Claude Code |
|---|---|---|
| Plugin name | `copilot` | `voidr` |
| Manifest | `plugin.json` | `.claude-plugin/plugin.json` |
| Marketplace | `.github/plugin/marketplace.json` | `.claude-plugin/marketplace.json` |
| Hooks | `hooks.json` | `hooks/hooks.json` |
| MCP config | `.mcp.json` | `mcp/claude.json` |
| Plugin root | `${PLUGIN_ROOT}` | `${CLAUDE_PLUGIN_ROOT}` |
| Skill call | `/copilot:voidr-connect` | `/voidr:voidr-connect` |

Everything else is shared: `skills/`, `scripts/`, `policy/`, and
`templates/`. `scripts/lib/host.mjs` detects the host from the hook payload
(Claude stamps `hook_event_name`; Copilot does not) and serializes each hook's
output in that host's dialect. Set `VOIDR_PLUGIN_HOST=claude|copilot` to force
it.

Three host differences are worth knowing when changing hook code:

- Claude's `UserPromptSubmit` **cannot rewrite the prompt**. The routing note
  from `prompt-router.mjs` is delivered as `additionalContext` instead of being
  appended to the transformed prompt.
- Claude's `Stop` decision is read at the **top level** of the hook output, not
  inside `hookSpecificOutput`, and it hands the hook `last_assistant_message`
  directly — so the execution-link gate never parses a transcript there.
- Claude scopes plugin MCP tools as
  `mcp__plugin_voidr_voidr__<tool>`. `canonicalToolName` strips that prefix, so
  the policy allowlist and every gate keep matching. Breaking that resolution
  silently opens every gate — `tests/claude-host.test.mjs` covers it.

`npm run validate` asserts both hosts stay in step: same version, same Voidr
endpoints, and every hook event wired to its script.

## Local development

```sh
npm run check
```

On GitHub Copilot CLI:

```sh
copilot plugin marketplace add .
copilot plugin install copilot@voidrco
copilot plugin list
copilot mcp get voidr --json
```

On Claude Code, test without installing anything — the plugin loads for that
session only:

```sh
claude plugin validate .claude-plugin/plugin.json --strict
claude plugin validate .claude-plugin/marketplace.json --strict
cd /path/to/a/scratch/project
claude --plugin-dir /path/to/voidr-copilot-plugin
```

Skills appear as `/voidr:voidr-<name>` and MCP tools as
`mcp__plugin_voidr_voidr__<tool>`.

To install it for real:

```sh
claude plugin marketplace add .
claude plugin install voidr@voidrco     # --scope project to limit it to one repo
```

Prefer `--scope project`, or `--plugin-dir`, over a user-scoped install while
developing. A clean session is untouched — every workflow gate checks
`workflowActive` first — but the prompt hook arms that flag from wording alone,
and `isDevTestFlowPrompt` matches ordinary requests like "escreve os testes
dessa funcionalidade" with no mention of Voidr. Once armed,
`enforcePreSelectionWriteGate` denies every file write until a Voidr test
repository is selected, which is correct inside the workflow and surprising in
an unrelated repo. `/plugin` disables it again without uninstalling.

After every `copilot plugin install`, reload every open VS Code window
(`Developer: Reload Window`). The MCP bridge and the prompt hook keep
running with the previously loaded code until the window reloads, and a
stale prompt hook silently drops typed gate messages such as
`Aprovo este Test Plan`. The write-denial message reports when the prompt
hook last saw a user message; `never` or a stale age means the window
needs a reload, and the approval can still be collected through an
`ask_user` free-text field.

This build uses these production endpoints through the plugin MCP process:

- platform:
  `https://platform.voidr.co`;
- browser authentication callback:
  `https://platform.voidr.co/auth/cli-connect`;
- API:
  `https://api.voidr.co/v1`;
- MCP:
  `https://api.voidr.co/v1/mcp`.

Start Copilot from the workspace containing the relevant product and test
repositories. Open the product repository itself as the workspace folder
whenever possible: on a parent folder holding many checkouts, feature
inference has to inspect repositories one call at a time, and the tool
reports `repositoriesNotInspected` when the feature repository was not among
the ones it covered.

## Required VS Code setting: disable virtual tools

In VS Code, Copilot Chat groups tools into "virtual tools" once the total
tool count crosses `github.copilot.chat.virtualTools.threshold` (default and
maximum `128`, counting every built-in tool, extension tool, and MCP server
in the window). Past that threshold the model no longer sees the individual
tools: it sees groups it must activate by name, and the ones it fails to
activate are invisible. Observed effect on this plugin: only 26 of its 52
tools reached the model, `file_embeddings_search_documents` and
`voidr_smoke_build` among the missing, so documentation assimilation was
skipped and the local smoke run fell back to a forbidden terminal command.

The plugin cannot set this — it is a client-side user setting. Add it to
`settings.json`:

```json
"github.copilot.chat.virtualTools.threshold": 0
```

Zero disables grouping entirely, so every allowlisted tool stays visible.
The alternative is keeping the window's total tool count under the
threshold by disabling unrelated MCP servers and extension tools.

## Developer-first flow (recommended for feature developers)

After finishing a feature, say:

> Cria os testes da minha feature.

The `/voidr-feature-test` skill infers the feature from the current branch and diff,
auto-selects the application and environment when only one exists, confirms
everything on a single card, and shows plain-language scenarios. The only
phrase the developer ever types is `Criar testes`. Test Plans, scaffolding,
and repository provisioning happen silently with the same runtime guarantees;
after the tests pass locally, the flow assists with PR, immutable publish, and
platform execution through the existing gates.

## Full control flow

Say:

> Quero desenvolver testes na Voidr.

The first question must always be whether the Test Plan is new or existing.
No `project.json` is used to infer that choice.

For a new Test Plan, application, product type, environment, feature, and base
URL are routing metadata—not sufficient test-design evidence. After collecting
them, the plugin asks what inputs should support the plan: product code,
documentation or requirements, business context supplied in chat, or a
combination. It summarizes the evidence and requires the exact confirmation
`Confirmar insumos do planejamento` before it may generate a draft. Persisting
the draft still requires the separate approval `Aprovo este Test Plan`. Both
phrases must be typed by the user in the normal chat input; `ask_user`
selections do not satisfy these runtime gates.

Before deploy, the selected test changes must be in a merged GitHub pull
request. The plugin rebuilds from that exact merge commit, uploads a
content-addressed candidate, promotes it, and reports success only when the
platform read-back proves `latest` points to the same `codebaseVersion`.
Legacy `voidr deploy-latest` and `npm run voidr:deploy` shell paths are denied.

## Authentication prerequisite

An existing Service Account can perform discovery under the legacy empty-scope
read-only behavior. It must explicitly have `write` scope for plan creation,
deployment-related synchronization, and execution creation. If it is absent
or read-only, the plugin stops before a mutation.

Never paste a Service Account secret into the chat. Provision or rotate it in
the Voidr platform, or run `/copilot voidr-connect` and complete the official
browser login.

`voidr_auth_status` reports the active `credentialStore` path and
`credentialProfile`. For an isolated first-access test, set
`VOIDR_CREDENTIAL_PROFILE=<name>` (which resolves to
`~/.voidr/service-accounts.<name>.json`) or point
`VOIDR_SERVICE_ACCOUNTS_PATH` at a dedicated file. Production installs must
keep the default store; `npm run validate` rejects a profile configured in
`.mcp.json`.

## Corporate networks (TLS inspection and proxies)

Corporate machines often route traffic through a proxy that re-signs TLS
certificates. Browsers trust the corporate CA through the operating system,
but Node.js ships its own CA bundle, so plugin requests to the Voidr API can
fail with errors such as `SELF_SIGNED_CERT_IN_CHAIN` while the browser login
itself works.

The MCP bridge mitigates this automatically: on startup it merges the
operating system's certificate store into the Node.js TLS defaults
(`tls.getCACertificates('system')`, available on Node 22.15+/24+). The bridge
logs the outcome to stderr as `voidr-mcp-bridge: system CA trust <status>`,
visible in the editor's MCP output channel.

If the runtime is too old for that API, export the corporate root CA to a
`.pem` file, set the `NODE_EXTRA_CA_CERTS` environment variable to its path,
and restart the editor. Node.js `fetch` also ignores the system proxy by
default; the bridge sets `NODE_USE_ENV_PROXY=1` so Node 24+ honors
`HTTPS_PROXY`/`NO_PROXY` when those are configured.

## Security

The local MCP bridge exposes a small allowlist of application, Test Plan,
execution, Playwright analytics, defect, and governance-tag tools. A
`preToolUse` hook independently blocks direct, nested, and shell-based
attempts to dispatch Hive processes.

Failure analysis always links the exact platform execution used as evidence.
Confirmed defects persist that link in their description and execution
relation.

See [architecture](docs/architecture.md), [E2E strategy](docs/e2e-strategy.md),
and [authentication flow](docs/auth-roadmap.md).
