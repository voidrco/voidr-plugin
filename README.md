# Voidr Testing plugin for GitHub Copilot CLI

This plugin guides a developer from “I want to develop tests in Voidr” through:

1. creating or selecting a Test Plan;
2. selecting or bootstrapping one test repository;
3. implementing and validating Playwright cases;
4. requiring a PR already merged into the repository default branch;
5. deploying that exact commit as an immutable release after confirmation;
6. verifying `latest` and platform sync independently;
7. creating an execution after a second confirmation;
8. analyzing a failed execution from ClickHouse-backed Playwright evidence.

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
repositories, then say:

> Quero desenvolver testes na Voidr.

The first question must always be whether the Test Plan is new or existing.
No `project.json` is used to infer that choice.

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

## Security

The local MCP bridge exposes a small allowlist of application, Test Plan,
execution, Playwright analytics, defect, and governance-tag tools. A
`preToolUse` hook independently blocks direct, nested, and shell-based
attempts to dispatch Hive processes.

See [architecture](docs/architecture.md), [E2E strategy](docs/e2e-strategy.md),
and [authentication flow](docs/auth-roadmap.md).
