---
name: voidr-execute
description: Executa testes na plataforma Voidr em dois modos — LIVE run (casos já automatizados e publicados) ou validation run (build local, deploy de candidato versionado sem promote e execução SHADOW pinada na versão) — e acompanha a execução até o estado terminal. Use quando o usuário pedir para "executar/rodar os testes na plataforma", "fazer um validation run", "rodar em shadow", ou depois que o /voidr-generate deixou os specs buildando. Cada escrita (deploy, execução) tem seu próprio gate de confirmação.
---

# Execute Voidr tests on the platform

> Host note: `ask_user` names the host's native question tool — `ask_user` on
> GitHub Copilot CLI, `AskUserQuestion` on Claude Code. Wherever this skill
> says `ask_user`, use that tool with selectable options; plain chat text is
> never a substitute.

Never call a tool that starts a Hive process. Obey the shared contracts in `../CONTRACTS.md`. Platform executions are
created only with `executions_create_execution` (LIVE) or
`voidr_create_validation_execution` (validation), and every gate below is
confirmed by the user before the write.

Read `manifest-context.json` at the test repository root for the plan,
application, environment, and repository identity. Absent manifest →
`/voidr-context` first.

## Choose the mode

Ask (or infer from the request) which mode applies:

1. **LIVE run** — the selected cases are already automated and deployed;
   just execute them.
2. **Validation run** — the local specs changed (typically after
   `/voidr-generate`) and have to be validated on the platform. No pull
   request or merge is involved: the candidate is deployed under its own
   immutable version and never touches `latest`, so the main pipeline —
   monitoring, self-healing, LIVE governance — is unaffected.

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

1. **Build gate**: `voidr_build` completed in this session. The build is the
   local syntax and packaging gate; tests never run locally. Never deploy a
   repository that did not build.
2. **Validation deploy**: `voidr_release_deploy_validation` — uploads the
   content-addressed candidate WITHOUT promoting it (`latest` stays exactly
   as it was) and returns the immutable `codebaseVersion`. Behind its own
   confirmation gate.
3. **Pilot execution**: `voidr_create_validation_execution` with that
   `codebaseVersion` and a SINGLE representative target — the shortest case
   that still exercises the shared preconditions (login, environment, base
   URL). Every case in a plan repeats those preconditions, so a broken one
   fails all of them: the pilot buys that verdict for one case's runtime
   instead of the whole plan's. Confirm the scope with the user first and
   share the execution link.
4. **Full run**: only after the pilot passes, execute the remaining targets in
   ONE execution. Never split a plan into one execution per case: results are
   already reported per case, and separate executions pay queue and pod
   startup again for the same answer.
5. **Follow to completion** (see "Monitoring") and read the outcome with
   "Reading a failed run" below.
6. **Promotion is a separate decision**: when the validation passes and the
   user wants the version in the main pipeline, that is the reviewed path —
   publish with `voidr_workspace_publish_tests`, merge by the user, then
   `voidr_release_inspect` + `voidr_release_deploy_merged_pr`.

## Reading a failed run

Group the failures by `failureSignature` (`playwright_list_execution_failures`)
BEFORE reporting or proposing anything:

- cases sharing one signature are ONE problem, not N. Diagnose the
  representative case and say how many cases the signature covers; never open
  one investigation — or one subagent — per case of the same signature;
- a signature that covers every case is a shared precondition. Report it as
  such: fixing it is what unblocks the plan;
- distinct signatures are independent problems and may be worked in parallel.

Corrections belong to `/voidr-generate`. When the user asks to re-run after a
correction, execute ONLY the previously failing targets — a green case does
not need to pay for another run, and a narrower scope returns its verdict
sooner.

## Execution call contract

`executions_create_execution` (LIVE) takes the manifest's `applicationId` and
`planId`, the selected Voidr `environment`, `provider: "PLAYWRIGHT"`, and
`source: "STORAGE"`. For the full Test Plan, omit `targets`; for a subset,
pass `targets` entries by `testCaseSlug`, `suiteSlug`, or `moduleSlug`
exactly as the platform returned them. Do not call another tool to discover
values the manifest already carries. Do not call the tool until the user
confirms, and call it exactly once per confirmed request: create one
idempotency key per confirmed request. Keep that same key if the confirmed
call must be retried after a network failure, and never reuse it for a new
request.

`voidr_create_validation_execution` (validation) takes the same
`applicationId`, `testPlanId`, `environment`, and optional `targets`, plus
the `codebaseVersion` returned by `voidr_release_deploy_validation` — never a
version from memory or a previous session. The bridge pins the SHADOW run to
that candidate and derives a stable idempotency key itself.

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
- `voidr_build` — local build gate evidence (validation mode).
- `voidr_release_deploy_validation` — candidate deploy, no promote; returns
  the `codebaseVersion`.
- `voidr_create_validation_execution` — the ONLY validation-execution write;
  SHADOW pinned to the candidate.
- `executions_create_execution` — the ONLY LIVE execution write.
- `voidr_workspace_publish_tests` / `voidr_release_inspect` /
  `voidr_release_deploy_merged_pr` — the reviewed promotion path, only after
  a passing validation and an explicit user decision.
- `executions_get_execution` / `playwright_get_execution_analytics` —
  monitoring and result reporting.
- `playwright_list_execution_failures` — the per-case failures with their
  `failureSignature`, which is what groups one problem from many cases.
