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
   user wants the version in the main pipeline, publish with
   `voidr_workspace_publish_tests`, then `voidr_release_inspect` +
   `voidr_release_deploy_live`.

## Reading a failed run

### First group, then diagnose, then edit

Group by `failureSignature` (`playwright_list_execution_failures`) BEFORE
reporting or proposing anything:

- cases sharing one signature are ONE problem, not N. Diagnose the
  representative case and say how many cases the signature covers; never open
  one investigation — or one subagent — per case of the same signature;
- a signature that covers every case is a shared precondition. Report it as
  such: fixing it is what unblocks the plan;
- distinct signatures are independent problems and may be worked in parallel.

### The error message is the symptom, never the cause

`errorMessage` says what the runner observed, not why. "Test timeout of 40000ms
exceeded" is compatible with a slow page, a selector that matches nothing, and a
selector that matches something the test can never act on — three different
fixes. Reporting the message back as the diagnosis is not a diagnosis.

Before naming a cause, read the representative case's runtime evidence:

- `playwright_get_step_timeline` — the step sequence with durations. Read it
  first and read it whole. Where the time actually went is the strongest signal
  available: a step that consumed the remaining budget was waiting on something,
  and the steps that passed before it tell you how far the flow really got.
- `playwright_get_test_dom` / `playwright_get_step_frames` — what the page held
  at the failing step. This is how a locator is confirmed to be absent, or
  present but not actionable.
- `playwright_get_trace_events` / `assistant_context_get_step_detail` — the
  detail behind one step when the timeline leaves the question open.
- `failure_analysis_get_context` — the platform's own prior analysis, when it
  has one.

A green step is not proof that its effect happened: `fill` reports success for
writing into an element the application never read. Trust the timeline and the
DOM over the step's own verdict.

### Waiting longer is not a fix

Never raise a timeout to make a failure go away. A timeout is only ever the
correction when the timeline PROVES the operation was progressing and simply
needed more room — and then say which step, and how long it actually took.

When a step consumed its budget without progressing, the target was wrong or
unreachable; a larger timeout buys the same red result later. An element that is
present but hidden, disabled, or covered is the common case, and no amount of
waiting changes it.

### Then correct

Corrections belong to `/voidr-generate`, and only after the evidence above named
a cause. When the user asks to re-run after a correction, execute ONLY the
previously failing targets — a green case does not need to pay for another run,
and a narrower scope returns its verdict sooner.

If two attempts at the same signature fail, stop and report what the evidence
shows instead of trying a third edit. Repeated blind edits bury the original
failure under new ones.

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

- **Claude Code**: arm the `Monitor` tool with an until-loop that polls
  `executions_get_execution`. A bare `sleep` is refused by this host, and
  working around it with a backgrounded sleep floods the user with completion
  notices that mean nothing — one observed run spent three consecutive messages
  explaining that the previous notifications meant nothing.
- **GitHub Copilot CLI**: poll `executions_get_execution`
  with at least 30 seconds between calls — never a tight loop.

Name the mechanism by host instead of guessing: offering a fallback the host
forbids costs several rounds before the flow recovers.

On completion report pass/fail/flaky counts (`playwright_get_execution_analytics`
when totals are needed) and the execution link. On failures, offer
`/voidr-failure-analysis` for the evidence-backed diagnosis; never trigger
self-healing or any Hive process.

## Closing: read the state back before describing it

Never report a governance state you have not just read. Finish every run by
calling `test_plans_get_test_plan` and reporting each target case's literal
`current_tag`.

Two different things are called "promoting", and reporting one as the other is
the failure this section exists to prevent:

| Word | What it moves |
| --- | --- |
| **deploy** | `latest` → an immutable `codebaseVersion` (the release) |
| **promote** | a case's `current_tag`, `DEV` → `LIVE` (governance) |

`voidr_release_deploy_live` does the first. It leaves every case at `DEV`.
Observed twice in one session: the run announced "promovido com sucesso …
governança LIVE" and "todos promovidos em produção" while all eight cases sat
at `DEV` — the second time after the tags had already been read six times.

Use "deploy" only for the release and "promote" only for a tag, and never write
`LIVE` in a report without the read-back that proves it.

## Promoting a case to LIVE

A case at `DEV` is deployed but ungoverned: outside monitoring and outside
self-healing auto-trigger — the reason the plan was automated at all. Promotion
is a separate, explicit step, never bundled into a deploy:

1. Report each target case's current tag, read from the platform.
2. Say plainly what `LIVE` changes: the case starts being monitored and becomes
   eligible for self-healing.
3. Ask for confirmation with `ask_user`. Never promote on your own initiative.
4. Confirm `canWrite: true`, then call `test_plans_update_test_case_tag` once
   per confirmed case.
5. Read the plan back and report the persisted tag of each one. If a case did
   not move, name it and stop.

### A failing case is not automatically ineligible

Eligibility follows the **cause** of the failure, never the pass/fail count. A
test that fails because the product is broken is a test doing its job, and
holding it at `DEV` is the one outcome that guarantees nobody finds out — `DEV`
is outside monitoring, so the defect it proves goes unwatched.

Read the cause from `/voidr-failure-analysis`, which labels it, and treat the
labels differently:

| Cause | Promotion |
| --- | --- |
| **Application defect** | Eligible. The case is correct and proves a real bug. |
| **Outdated test** | Never. The spec is wrong; fix it first. |
| **Test-data gap** | Never. The case cannot prove anything yet. |
| **Environment instability** | Not yet. Re-run before deciding. |
| **Indeterminate** | Not yet. The evidence does not support a decision. |

Never infer `Application defect` from a red run. It requires the evidence the
analysis produces — the response, exception, or behavior that contradicts the
approved AAA — and without that evidence the case is `Indeterminate`, not
eligible.

Before promoting a case that is failing on an application defect:

1. Say which defect it proves, and that the case will be red under monitoring
   from the moment it goes `LIVE` — that is the intent, not an accident.
2. Record it with `/voidr-failure-analysis`, so the red result has a defect
   attached instead of looking like an unexplained regression to whoever reads
   the plan next.
3. Ask for confirmation naming the case and the defect together.

Then take the five steps above, ending in the read-back.

When the user asks to promote a failing case without a diagnosis, do not
refuse and do not promote: run the analysis first and come back with the cause.
Promoting a case whose failure is really an `Outdated test` publishes a broken
expectation as if it were a finding.

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
  `voidr_release_deploy_live` — the promotion path, only after a passing
  validation and an explicit user decision.
- `executions_get_execution` / `playwright_get_execution_analytics` —
  monitoring and result reporting.
- `playwright_list_execution_failures` — the per-case failures with their
  `failureSignature`, which is what groups one problem from many cases.
- `playwright_get_step_timeline` — the failing case's steps and durations; the
  first read of any diagnosis, never skipped.
- `playwright_get_test_dom` / `playwright_get_step_frames` — the page at the
  failing step, to tell an absent locator from an unactionable one.
- `playwright_get_trace_events` / `assistant_context_get_step_detail` — one
  step in detail, when the timeline leaves the question open.
- `failure_analysis_get_context` — the platform's prior analysis of the run.
