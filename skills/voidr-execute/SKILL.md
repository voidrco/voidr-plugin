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
2. **Confirmation gate**: name the plan, the environment, and the cases, and
   say that this is the run whose result counts. Wait for the explicit go. See
   "Writing the confirmation gates".
3. `executions_create_execution` for the selected scope. Share the execution
   link the platform returns.
4. **Follow to completion** (see "Monitoring").

## Mode B — Validation run

1. **Build gate**: `voidr_build` completed in this session. The build is the
   local syntax and packaging gate; tests never run locally. Never deploy a
   repository that did not build.
2. **Validation deploy**: `voidr_release_deploy_validation` uploads this
   version of the code without replacing the one running today, and returns
   its identifier. Behind its own confirmation gate — ask it as "subir esta
   versão para a Voidr rodar? Ela fica guardada separada e não substitui a que
   está no ar hoje", not in terms of candidates, promotion, or `latest`.
3. **Pilot execution**: `voidr_create_validation_execution` with that
   identifier and a SINGLE representative target — the shortest case
   that still exercises the shared preconditions (login, environment, base
   URL). Every case in a plan repeats those preconditions, so a broken one
   fails all of them: the pilot buys that verdict for one case's runtime
   instead of the whole plan's. Confirm the scope first — "rodar o CASO na
   Voidr agora? Roda em paralelo, sem contar como resultado oficial" — and
   share the execution link. Say how long it takes when the case is long.
4. **Branch on the pilot verdict**:
   - If its tests PASSED, execute the remaining targets in ONE full execution.
     Never split a plan into one execution per case: results are already
     reported per case, and separate executions pay queue and pod startup again
     for the same answer.
   - If its tests FAILED, diagnose the failure. Correct and retry only within
     the three-run budget owned by `/voidr-generate`. When that budget ends, do
     not run the remaining targets: continue to the delivery and LIVE offer
     with the final candidate that actually ran.
   - If the execution was cancelled or produced no test verdict, it does not
     count as an exercised candidate. Do not offer LIVE from it.
5. **Follow each execution to completion** (see "Monitoring"). A PASSED verdict
   can continue directly. A FAILED verdict must be read with "Reading a failed
   run" below before continuing. Both verdicts remain eligible for LIVE.
6. **Local checkpoint**: use `voidr_workspace_publish_tests` with
   `pushToRemote: false` to save the validated source in a local feature-branch
   commit. Do not push, open a pull request, or merge here. A local Git failure
   is reported but never blocks LIVE and must not trigger a retry loop.
7. **LIVE deploy is a separate decision**: after its own confirmation, call
   `voidr_release_deploy_live` with the SAME `codebaseVersion` returned by
   `voidr_release_deploy_validation` and exercised by the completed validation
   run, whether its tests PASSED or FAILED. A FAILED verdict is eligible only
   after it has been diagnosed.
   Do not rebuild. Do not call `voidr_release_inspect`. No Git commit, push,
   pull request, or merge is a deploy prerequisite.
8. **GitHub choice through PreToolUse**: only after LIVE is verified, call
   `voidr_repository_sync_github`. Its `PreToolUse` hook asks the user whether
   to synchronize the local commit with GitHub. Never answer on the user's
   behalf and never replace this with an `ask_user` question. If denied, stop:
   LIVE stays valid and the commit stays local. If approved, the tool first
   tries the user's local Git and GitHub CLI session. A merged pull request is
   synchronized; an open pull request is queued. Only when local delivery
   cannot reach a pull request does the Voidr Bot receive the exact
   validation-time patch. Report which path ran and its separate result:
   synchronized, queued, conflict, missing permission, or failure. LIVE is
   valid for every Git result.

## Writing the confirmation gates

Every gate in this skill asks a person to authorize a write. That person often
does not work at Voidr and has never seen this vocabulary. Observed live, on the
deploy gate:

> Sobe a build **content-addressed** e devolve um **codebaseVersion** imutável.
> O **latest** NÃO é tocado — monitoramento, **self-healing** e **governança
> LIVE** ficam intactos.

Six internal terms in two lines, none defined, plus the tool name. Nothing in it
answers what the person actually needs to decide.

A gate answers three questions, in the reader's language:

1. **What changes** — for the product, not for the system. "Nothing that runs
   today changes" beats "`latest` is untouched".
2. **Can it be undone** — or why it does not need to be.
3. **How long it takes**, when the answer is minutes rather than seconds.

Rules for the wording:

- No term that does not exist outside Voidr. `codebaseVersion`, `latest`,
  SHADOW, content-addressed, promote, governance tag — none of them belong in a
  question. If a concept is unavoidable, name it by what it does: "a versão que
  está no ar hoje", "roda em paralelo, sem contar como resultado oficial".
- No tool names. `voidr_release_deploy_validation` tells the reader nothing
  about what they are approving.
- Say the consequence, not the mechanism. "Não substitui a que está no ar" is
  the consequence; "sem promote" is the mechanism.
- Keep the option labels concrete: "Sim, subir" and "Não, parar aqui" beat
  "Prosseguir" and "Cancelar".

The technical detail still belongs in the report AFTER the action — the
`codebaseVersion`, the execution link, the tags read back. There it is a record.
In the question it is noise standing between the person and the decision.

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

### When to offer cancelling instead of waiting

An execution that is clearly not going to answer anything is worth stopping, and
until now the only way out was the platform UI. Offer `executions_cancel_execution`
when the run was created against the wrong plan, environment, or
`codebaseVersion`; when the specs it is running were already superseded by an
edit; or when it has sat in the same state far past the duration its own history
suggests. Say which execution and why, and let the user decide — cancelling
destroys the evidence a failure would have produced, so a run that is merely slow
is not a candidate. Never cancel to retry faster.

After a cancel, read the execution back and report its persisted state. A cancel
that did not take is not a cancel.

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

### LIVE is where an automated case is supposed to end up

`PENDING` and `DEV` are outside monitoring. A case parked there is a case nobody
is watching, which is the opposite of the reason it was automated. So `LIVE` is
the destination by default, for every case that was deployed — not a reward a
case earns by being green.

That includes cases that are failing. A red `LIVE` case reports something; a
`DEV` case reports nothing at all.

Read the cause from `/voidr-failure-analysis` when there is a failure. It no
longer decides eligibility — it decides what you SAY when proposing the
promotion, so the person confirming knows what the red will mean:

| Cause | What to say alongside the proposal |
| --- | --- |
| **Application defect** | The case is right and the product is broken. Red is the finding. Record the defect so the red carries its explanation. |
| **Environment instability** | The failure was not about the product. Monitoring will show whether it repeats. |
| **Indeterminate** | The evidence did not settle the cause. Monitoring is how it gets settled. |
| **Outdated test** | The SPEC is what is wrong. Promoting publishes a broken expectation as if it were a finding — say so plainly and recommend fixing the spec first. |
| **Test-data gap** | Same: the case cannot prove anything until the data exists. |

The last two still go `LIVE` when the user wants them to. Say the cost once, in
one sentence, and do not repeat the objection.

A case can only be promoted after it reached `latest` — that is
`voidr_release_deploy_live`, not a validation deploy. A validation candidate
leaves `isAutomated: false`, and a tag on a case the platform does not consider
automated changes nothing.

Propose the whole batch at once, with one confirmation for all of it, naming the
cases whose failures have a cause worth hearing. Never promote silently: the
default is what you OFFER, not what you do without asking.

When a case is failing and no diagnosis was run, run `/voidr-failure-analysis`
before proposing the promotion — not to decide whether to offer it, but so the
proposal carries the cause. If the analysis cannot run, offer the promotion
anyway and say the cause is unknown.

## Tool routing

- `test_plans_get_test_plan` / `test_plans_get_test_counts` — sync
  verification reads.
- `voidr_build` — local build gate evidence (validation mode).
- `voidr_release_deploy_validation` — candidate deploy, no promote; returns
  the `codebaseVersion`.
- `voidr_create_validation_execution` — the ONLY validation-execution write;
  SHADOW pinned to the candidate.
- `executions_create_execution` — the ONLY LIVE execution write.
- `executions_cancel_execution` — stops a run still in progress. A write, and
  the user's call: never cancel on your own initiative.
- `voidr_release_deploy_live` — publishes the exact `codebaseVersion` that
  produced a PASSED or diagnosed FAILED validation verdict, only after an
  explicit user decision. It never rebuilds or writes to GitHub.
- `voidr_repository_sync_github` — after LIVE, asks through `PreToolUse` whether
  the user wants to synchronize the exact validated source patch with GitHub.
  Denial leaves the local commit and LIVE untouched. Approval first uses the
  user's local GitHub session and falls back to the Voidr Bot only when local
  delivery cannot reach a pull request.
- `voidr_workspace_publish_tests` — best-effort delivery to the default branch
  when `pushToRemote` is true; this flow uses false for its pre-LIVE local
  checkpoint. Its failure is reported but never blocks LIVE.
- `voidr_release_inspect` — optional Git delivery inspection; never a LIVE
  deploy gate.
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
