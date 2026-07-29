# Voidr Copilot plugin — MVP architecture

## Outcome

The plugin guides a developer from an empty testing context to a deployed and
executed Voidr Playwright suite. It does not assume that `project.json`
identifies the user's intent, and it never delegates work to a Hive
orchestrator.

The primary invocation is natural language:

> Quero desenvolver testes na Voidr.

The first workflow decision is always:

1. create a new Test Plan; or
2. use an existing Test Plan.

No platform or filesystem mutation is allowed before that answer.

## Separate identities

The workflow keeps three concepts independent:

- **Voidr Test Plan**: the platform scope the user explicitly creates or
  selects.
- **Test repository**: the only repository the plugin may modify.
- **Product repositories**: optional read-only context used to understand the
  product.

`project.json` is read only after the test repository is explicitly selected.
It validates the selected organization, application, and plan. It never
selects them and is never overwritten on a mismatch without confirmation.

## State machine

```text
INTAKE
  -> PLAN_MODE_SELECTED
  -> PLAN_DRAFTED | PLAN_LOADED
  -> PLAN_APPROVED
  -> TEST_REPOSITORY_SELECTED
  -> REPOSITORY_LINK_VALIDATED
  -> TESTS_IMPLEMENTED
  -> LOCAL_VALIDATION_PASSED
  -> PR_MERGE_VERIFIED
  -> DEPLOY_APPROVED
  -> RELEASE_LATEST_VERIFIED
  -> DEPLOY_SYNC_VERIFIED
  -> EXECUTION_APPROVED
  -> EXECUTION_CREATED
  -> COMPLETED
```

Human gates are mandatory before:

- persisting a new or changed Test Plan;
- relinking or creating `project.json`;
- publishing the merged commit as an immutable release;
- deploying artifacts;
- creating a platform execution.

The agent must preserve the user's selected cases exactly. It may propose a
scope change, but cannot silently expand it.

## Authentication

The bundled local MCP bridge reuses the same per-organization Service Account
store used by the Playwright framework:

`~/.voidr/service-accounts.json`

Credentials are read by the local Node process and sent directly to the Voidr
MCP endpoint using Basic authentication. They are never returned by a tool,
written to a repository, or placed in a prompt.

This makes an already-configured developer immediately authenticated after
plugin installation. It does not make a brand-new developer magically
authenticated: a unique Service Account must first be provisioned.

An empty legacy scope list remains read-only under the current MCP contract.
If no account exists, or if its scopes do not explicitly include `write`, the
plugin stops before any platform mutation. The `/voidr-connect` skill starts a
one-shot loopback callback and opens the official browser authentication route
already used by the CLI. After explicit organization selection, the temporary
user token is delivered directly to the local process. That process creates
and validates a dedicated, role-scoped Copilot Service Account, writes the
existing store format, and discards the user token. Neither token nor secret
passes through the model.

## Security boundaries

The MCP bridge exposes only the allowlisted application, Test Plan, execution,
Playwright analytics, defect, and governance-tag tools in
`policy/tool-policy.json`. It rejects every other remote tool before any
network request.

The plugin hook independently denies:

- known tools that start Hive generation, automation, or self-healing;
- the generic batch tool, which could call a forbidden tool indirectly;
- shell commands containing known Hive dispatch identifiers.

This is defense in depth. Skill instructions are not treated as a security
boundary.

The hook intentionally returns `{}` for allowed calls so normal Copilot
permission prompts still apply.

## Deployment contract

Deployment is fail-closed and has four proofs:

1. The selected PR is `MERGED` into GitHub's current default branch. Its merge
   commit is reachable from `origin/<default-branch>`, the worktree is clean,
   and local `HEAD` is exactly that commit.
2. A fresh build from that commit is uploaded only to the content-addressed
   `versions/<codebaseVersion>` namespace and registered with matching
   checksums.
3. That exact immutable version is promoted. A platform read-back must prove
   the latest deploy contains the same `codebaseVersion`.
4. The Test Plan and counts independently confirm that every selected case is
   synchronized and runnable.

Only after all four proofs may the plugin describe deployment as complete or
offer the execution gate. An uploaded candidate is not a deploy. A promotion
without latest read-back is not a completed deploy. A synchronized plan whose
latest version differs is not a completed deploy.

The pre-tool hook denies `voidr deploy-latest` and
`npm run voidr:deploy`, because the legacy framework command deletes and
rewrites mutable storage under `latest`. There is no fallback. Environments
that do not yet expose `deploy-candidate`, immutable version promotion, and
latest read-back remain blocked until those capabilities are released.

The local release tool uses GitHub CLI only for read-only PR/default-branch
evidence. It never creates or merges a PR. It reruns the evidence checks inside
the same operation that builds, publishes, promotes, and verifies the release.

The current platform manifest identifies immutable content with
`codebaseVersion`; the plugin response also records the merged commit that
produced it. Persisting that Git SHA inside the platform deploy record is a
recommended audit enhancement, but is not used as a substitute for the live
merge check.

## Greenfield repository compatibility

The bootstrap template keeps test files in the existing `.spec.js` format but
declares the repository as CommonJS and loads a CommonJS Playwright config.
This is intentional: the published framework pins Playwright 1.48, and an E2E
smoke test on the supported Node 22.22 runtime found its ESM loader could hang
while listing an ESM spec. The CommonJS project boundary still lets
Playwright's transformer consume the generated `import` syntax and completed
both `--list` and a real smoke test.

`voidr.runner.config.mjs` remains present for the framework build and cloud
runner contract.

## MVP boundaries

Included:

- reuse an existing Service Account;
- create or select a Test Plan;
- select one writable test repository;
- scaffold and implement selected Playwright cases;
- validate locally;
- deploy after confirmation;
- require a PR merged into the default branch;
- publish and promote an immutable release;
- verify that `latest` points to that release;
- verify automation sync;
- create and observe a platform execution.
- analyze one failed test from ClickHouse-backed Playwright evidence;
- always link the exact platform execution that supports the analysis;
- optionally create a confirmed defect with that execution linked in its
  description and relations, or change a confirmed governance tag.

Not included:

- Hive test-plan generation;
- Hive automation generation;
- self-healing dispatch;
- automatic repository creation;
- creating or merging pull requests;
- automatic deploy or execution;
- automatic diagnosis, repair, or failure grouping after execution failure.
