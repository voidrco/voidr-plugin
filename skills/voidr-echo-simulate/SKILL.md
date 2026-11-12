---
name: voidr-echo-simulate
description: Author Echo journeys and scenarios, bind simulation data, run persona simulations, and inspect transcripts and judge evidence through the external harness. Use for Echo simulation workflows; ordinary Playwright repository development follows its own skills.
---

Read [shared contracts](../CONTRACTS.md) and the
[Echo workflow](../../docs/echo-simulation-workflow.md). Echo simulation plans
do not require cloning, building or deploying a test repository.

Never call a tool that starts a Hive process through generic job dispatch or
delegated authoring. The shared contract permits supported Echo execution and
judging operations within the user's authorization.

Use the native `ask_user` control (`AskUserQuestion` on Claude Code) for
unresolved choices. Preserve selections and authorization already supplied by
the user; validate platform identities through current tool reads.

## Authoring and execution

Separate the opening utterance, complete customer objective, expected results
and prohibited behavior. Give each scenario observable success and failure
endings. Error-stop rules belong in the objective and prohibited behavior, never
in scenario or terminal-node `expectedOutcomes`. Verify this in the saved draft
before publishing; a terminal node does not itself establish success. Keep a scenario focused enough to make its outcome explainable from
the transcript. Original scenarios need no invented document references.

Review the graph, scenario matrix and validation before publishing the exact
draft revision. Read back published cases after edits; verify that future
executions use the intended objective. Existing session snapshots remain
historical evidence.

For library-backed journeys, inspect available field keys and expectation
templates before assigning data. Distinguish persona-visible information from
evaluation references. Do not expose account values or credentials in output.

Prepare the selected transport, environment, scenarios, personas and judge
profiles. Present the returned matrix and reuse existing authorization when
it covers that exact operation. Execution requires fresh server confirmation;
real phone calls require explicit real-call authorization. An uncertain launch
response requires inspecting the existing execution before attempting another.

Follow conversations and evaluations separately to terminal states. Read full
paginated transcripts and criterion evidence, including failures and skipped
stages. A completed run is not a passing result, and a score is not a guarantee
against hallucinations. Dialect configuration in text does not prove acoustic
accent fidelity. Report target, adapter and profile limitations explicitly.

## Existing scenario selections and schedules

For chat across several journeys of the same plan, use
`voidr_echo_selection_login` with the official browser sign-in. Browser use is
limited to sign-in. Use `voidr_echo_selection_read` to find the journeys by name,
fetch eligible scenarios in batches, load a saved selection, or preview the exact scope.
Use `catalog_page` with `q` and `page` for a large journey, and use `q` on
`list` or `list_schedules` to find groups or schedules by name.
Build scope targets from each selected catalog row’s moduleSlug, suiteSlug, and testCaseSlug.
Use scenario names for user-facing review. Include the persona rule, repetitions,
account strategy, judge profiles, and approved journey version policy. Use the
accounts, judge_profiles and personas read operations to discover current options.
Only Voidr staff can use the devices read operation or select the mobile channel.
For the whole journey, use catalog_targets with the chosen channel. Pass
the canonical scope and fingerprint returned by preview to run or schedule.
Use `voidr_echo_selection_write` to save that scope, save it as a schedule, or
run it now. Saving a selection or a paused schedule does not start a run. Reuse
the same request ID if a write response is lost. For a run, give the user the
returned dispatch ID and track it in Evidence. Preserve the selected
organization, application and plan throughout.

## Tool routing

- Discover scope: `echo_list_applications`, `echo_list_environments`,
  `echo_list_journey_plans`, `echo_list_personas`, `echo_list_judge_profiles`.
- Author: `echo_journeys_create_plan`, `echo_journeys_create_draft`,
  `echo_journeys_update_draft`, `echo_journeys_publish_draft`.
- Bind data: `echo_journeys_get_data`, `echo_journeys_set_data`.
- Prepare and launch: `echo_prepare_execution`, `echo_create_execution`.
- Follow results: `echo_get_execution`, `echo_list_sessions`,
  `echo_get_session_transcript`, `echo_get_session_evaluation`,
  `echo_list_session_judge_evaluations`.
- Inspect snapshot evidence: `echo_read_evidence`; follow the returned JSON
  pointer paths rather than inventing field names.
- Recover a diagnosed evaluation failure: `echo_rejudge_session`, preserving
  the intended ORIGINAL or CURRENT methodology and previous attempts.
