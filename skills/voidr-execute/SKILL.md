---
name: voidr-execute
description: Executa testes na plataforma Voidr em dois modos — LIVE run (casos já automatizados e publicados) ou validation run (publica a versão local via PR, faz o deploy imutável e executa como SHADOW) — e acompanha a execução até o estado terminal. Use quando o usuário pedir para "executar/rodar os testes na plataforma", "fazer um validation run", "rodar em shadow", ou depois que o /voidr-generate deixou os specs verdes. Cada escrita (deploy, execução) tem seu próprio gate de confirmação.
---

# Execute Voidr tests on the platform

> Host note: `ask_user` names the host's native question tool — `ask_user` on
> GitHub Copilot CLI, `AskUserQuestion` on Claude Code. Wherever this skill
> says `ask_user`, use that tool with selectable options; plain chat text is
> never a substitute.

Never call a tool that starts a Hive process. Obey the shared contracts in `../CONTRACTS.md`. Platform execution is created
only with `executions_create_execution`, and every gate below is confirmed by
the user before the write.

Read `manifest-context.json` at the test repository root for the plan,
application, environment, and repository identity. Absent manifest →
`/voidr-context` first.

## Choose the mode

Ask (or infer from the request) which mode applies:

1. **LIVE run** — the selected cases are already automated and deployed;
   just execute them.
2. **Validation run** — the local specs changed (typically after
   `/voidr-generate`) and have to be published, deployed, and executed as a
   SHADOW validation before touching LIVE governance.

## Mode A — LIVE run

1. **Sync verification** (read-only): `test_plans_get_test_plan` +
   `test_plans_get_test_counts` — confirm the selected cases are automated
   and the platform artifact is in sync. An "Only automated test cases can be
   executed" error later means the cases need a deploy, never re-creation.
2. **Confirmation gate**: show plan, environment, and target cases; wait for
   the user's explicit go.
3. `executions_create_execution` for the selected scope. Share the execution
   link the platform returns.
4. **Follow to completion** (see "Monitoring").

## Mode B — Validation run

1. **Local gate**: the selected specs passed `voidr_smoke_build` in this
   session (zero failures/skips). Never deploy code that did not pass.
2. **Publish**: `voidr_workspace_publish_tests` — branch + pull request with
   the implemented specs. Hand the PR to the user; the merge is theirs.
3. **Immutable deploy**: after the merge, `voidr_release_inspect` to verify
   the merged state, then `voidr_release_deploy_merged_pr` behind its own
   confirmation gate.
4. **Shadow execution**: `executions_create_execution` with
   `executionType: "SHADOW"` so the run validates without affecting LIVE
   governance/monitoring. If the platform rejects the parameter, fall back to
   a normal execution tagged `validation-run` and tell the user the shadow
   flag is not available yet.
5. **Follow to completion** (see "Monitoring").

## Execution call contract

`executions_create_execution` takes the manifest's `applicationId` and
`planId`, the selected Voidr `environment`, `provider: "PLAYWRIGHT"`, and
`source: "STORAGE"`. For the full Test Plan, omit `targets`; for a subset,
pass `targets` entries by `testCaseSlug`, `suiteSlug`, or `moduleSlug`
exactly as the platform returned them. Do not call another tool to discover
values the manifest already carries. Do not call the tool until the user
confirms, and call it exactly once per confirmed request: Create one
idempotency key per confirmed request. Keep that same
key if the confirmed call must be retried after a network failure, and never
reuse it for a new request. For validation runs add `executionType: "SHADOW"`.

Always end the report with the execution link:
`Execution: [Open execution](<VOIDR_PLATFORM_URL>/execution/<executionId>)`.

## Monitoring

Track the execution until a terminal state (completed, failed, cancelled):

- in a harness with background monitors, arm one that polls
  `executions_get_execution` and reports the terminal result;
- otherwise poll `executions_get_execution` with at least 30 seconds between
  calls — never a tight loop.

On completion report pass/fail/flaky counts (`playwright_get_execution_analytics`
when totals are needed) and the execution link. On failures, offer
`/voidr-failure-analysis` for the evidence-backed diagnosis; never trigger
self-healing or any Hive process.

## Tool routing

- `test_plans_get_test_plan` / `test_plans_get_test_counts` — sync
  verification reads.
- `voidr_smoke_build` — local gate evidence (validation mode).
- `voidr_workspace_publish_tests` — branch + PR publish.
- `voidr_release_inspect` / `voidr_release_deploy_merged_pr` — merged-PR
  verification and immutable deploy.
- `executions_create_execution` — the ONLY execution write; SHADOW for
  validation runs.
- `executions_get_execution` / `playwright_get_execution_analytics` —
  monitoring and result reporting.
