# Voidr Testing plugin for GitHub Copilot CLI

This plugin guides a developer from “I want to develop tests in Voidr” through:

1. creating or selecting a Test Plan;
2. selecting and confirming the planning inputs before generating a draft;
3. selecting or bootstrapping one test repository;
4. implementing and validating Playwright cases;
5. requiring a PR already merged into the repository default branch;
6. deploying that exact commit as an immutable release after confirmation;
7. verifying `latest` and platform sync independently;
8. creating an execution after a second confirmation.

The current build uses Voidr production for browser authentication, application
discovery, Test Plans, repository provisioning, deploy, and execution. Service
Accounts use the standard production store at
`~/.voidr/service-accounts.json`, shared with the Playwright framework. It does
not call `npx voidr login` and never returns a client secret to Copilot.
`/voidr-connect` opens the official Voidr connect page, which persists the local
callback state before starting Auth0 and asks the user to choose an organization
when necessary. The temporary user token is kept only in the local Node process
and discarded after the account is created and validated.

## Local development

```sh
npm run check
copilot plugin marketplace add .
copilot plugin install copilot@voidrco
copilot plugin list
copilot mcp get voidr --json
```

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
repositories.

## Developer-first flow (recommended for feature developers)

After finishing a feature, say:

> Cria os testes da minha feature.

The `/voidr-test` skill infers the feature from the current branch and diff,
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

## Security

The local MCP bridge exposes a small allowlist of application, Test Plan, and
execution tools. A `preToolUse` hook independently blocks direct, nested, and
shell-based attempts to dispatch Hive processes.

See [architecture](docs/architecture.md), [E2E strategy](docs/e2e-strategy.md),
and [authentication flow](docs/auth-roadmap.md).
