---
name: voidr-failure-analysis
description: Analyzes a failed Voidr Playwright execution or test using ClickHouse-backed evidence. Use when the user asks why a test failed, whether a failure is recurring, what evidence supports the cause, or whether to create, update, assign, or transition a defect or change the test governance tag.
---

# Analyze Voidr failures

Never call a tool that starts a Hive process. Do not trigger self-healing,
automation generation, video generation, or another agent workflow.

A routed tool missing from your available tools is grouped, not absent: past
a tool-count threshold the editor collapses tool sets into groups the model
has to expand first. Find the activation entry whose summary lists that tool
and call it with the exact name you were given — never invent an activation
name, never report the tool as unavailable, and never fall back to a terminal
command or a manual step. If no activation entry lists it, say exactly which
tool is unreachable and stop.

## Authentication

Call `voidr_auth_status` before any remote tool.

If it returns `authenticated: false`, stop and reply only:

> A Voidr não está conectada. Execute `/copilot voidr-connect` para conectar
> uma Service Account. Depois volte e continue este fluxo.

Read-only analysis does not require write access. Every defect mutation and
tag change requires `canWrite: true`.

## Resolve the execution

If the user supplied an execution ID:

1. Call `playwright_get_execution_analytics`.
2. Keep its `applicationId`, `planId`, and environment as authoritative.

If the user did not supply an execution ID:

1. Resolve the application with `applications_list_applications`.
2. Ask the user when no application is explicit or uniquely matched.
3. Call `playwright_list_executions` with that `applicationId`,
   `status: "FAILED"`, and a relevant date range when the user supplied one.
4. Show the failed executions and ask the user to select one.
5. Call `playwright_get_execution_analytics` for the selected execution.

If analytics are still indexing, retry once. If they remain unavailable,
report that detailed analysis is incomplete and stop. Never infer a cause
from execution status alone.

## Resolve the execution URL

After analytics resolves the canonical execution ID, build:

`executionUrl = <VOIDR_PLATFORM_URL>/execution/<executionId>`

Use the configured `VOIDR_PLATFORM_URL`, without a trailing slash. If that
configuration is unavailable, use `https://platform.voidr.co`. Never use the
API URL, execution code, test result ID, or failure signature in this route.

Keep this URL attached to the selected execution and test throughout the
workflow. Never finish a test-case failure analysis without a clickable
`Execution` link to this URL. If the canonical execution ID is unavailable,
report that the analysis is incomplete and do not create a defect.
Render the link on its own line as:

`Execution: [Open execution](<executionUrl>)`

## Select one failed test

Call every required page of `playwright_list_execution_failures` for the
execution.

- If the user supplied `testCaseSlug`, select that exact row.
- If no row matches, report that the test is not a recorded failure in this
  execution and stop.
- If exactly one failure exists, select it automatically.
- If multiple failures exist, show slug, title, classification, error summary,
  and file/line; ask the user to select one.
- Do not group or deduplicate rows by `failureSignature`.

Treat `failureSignature` only as an identifier from the analytical store. Do
not pass it to tools that require another signature format.

## Gather evidence

For the selected `testCaseSlug`, gather:

1. `playwright_get_test_timeline` for steps, console, network, stdout, and
   stderr.
2. `playwright_get_trace_events` for the trace-backed step and DOM timeline.
3. `playwright_get_test_history` with the authoritative `applicationId` for
   cross-execution recurrence.
4. `playwright_get_test_dom` when the failure row says a DOM snapshot exists.
5. `playwright_list_test_results` until the selected row is found, to resolve
   its module and suite.
6. `test_plans_get_case` when `planId`, module, suite, and case slugs are all
   available.
7. `test_plans_get_tag_history` when the Test Plan mapping is available.

Use trace evidence when it exists. If trace, DOM, console, network, or Test
Plan context is absent, continue with the remaining evidence and state the
missing source explicitly.

## Reach the diagnosis

Separate observed evidence from inference.

Use these cause labels in the response:

- **Application defect**: the application returned an erroneous response,
  exception, or behavior contradicted by the expected result.
- **Outdated test**: the test expectation or selector no longer matches an
  intentional application change.
- **Test-data gap**: required data or account state was absent, expired, or
  consumed.
- **Environment instability**: network, dependency, authentication, or timing
  failed outside the product behavior under test.
- **Indeterminate**: available evidence does not support one cause.

Do not classify a missing selector as an outdated test unless DOM or trace
evidence shows the intended element changed or moved. Do not call a failure
flaky on its first occurrence. Mark recurrence only when test history shows
the same behavior across executions; mention intervening passes when present.

Return:

- selected execution and test, including the clickable `Execution` URL;
- cause and confidence;
- observed evidence with step, URL, status code, console message, DOM element,
  or file/line where available;
- recurrence from test history;
- expected behavior from the Test Plan, when available;
- recommended next action;
- missing evidence and alternative explanations.

## Optional defect

Resolve the existing defect before any defect mutation:

1. Call `defects_list_defects` with `testCaseId: testCaseSlug`, sorted by
   `updatedAt` descending.
2. Prefer the most recently updated non-closed defect. If none exists, select
   the most recently updated closed defect. Call `defects_get_defect` with its
   `slug` or ID, then show the complete returned defect and the required
   `Execution` link.
3. If the list result has no usable slug or ID, or the detail lookup fails,
   report that the existing defect could not be loaded and stop. Never mutate
   a defect from a list summary and never create a possible duplicate.

### Create

Create only when no non-closed matching defect exists. If only closed defects
exist, show the latest one and ask whether to reopen it or create a new defect.

1. Call `issue_tracker_list`.
2. If no active issue tracker exists, prepare a plain Voidr defect.
3. If one active tracker exists, call `issue_tracker_list_projects` with its
   `connectorContextId`. If several trackers or projects exist, ask the user
   to select one. If no project is accessible, explain that linked creation is
   unavailable and offer a plain Voidr defect.
4. Draft title, severity, priority, application, environment, description,
   reproducibility, and relations to the execution and test. Show the selected
   tracker and project when creating a linked issue. Include the clickable
   `Execution` URL in the description under `Evidence execution`, set
   `relations.executions: [executionId]`, and set
   `relations.testCases: [testCaseSlug]`.
5. Show the complete draft and ask for explicit confirmation.
6. Confirm `canWrite: true`. Call `defects_create_defect_with_issue` once when
   a tracker and project were selected; otherwise call
   `defects_create_defect` once.
7. Call `defects_get_defect` with the created slug or ID and verify the stored
   defect. Return it and end with the required `Execution` link.

### Update content

Use `defects_update_defect` only for title, severity, priority, description,
fix version, or target date. Use the dedicated flows below for status and
assignee changes.

1. Show the current value and proposed value for every changed field.
2. Ask for explicit confirmation.
3. Confirm `canWrite: true`, then call `defects_update_defect` once.
4. Call `defects_get_defect` and verify every confirmed field. Report any
   mismatch and end with the required `Execution` link.

### Update status

1. Show the current status, proposed status, and evidence-based reason.
2. Ask for explicit confirmation.
3. Confirm `canWrite: true`, then call `defects_update_defect_status` once.
   Pass `assignee` for `in_progress` and `fixVersion` for `resolved` when they
   are known. Use `reopened` to reopen a closed defect.
4. Call `defects_get_defect`, verify the persisted status, and end with the
   required `Execution` link.

### Assign

1. Show the current assignee and proposed assignee.
2. Use `@me` only when the user asks to assign the defect to themselves. If
   the user names another person without supplying an exact user ID, stop and
   explain that user lookup is unavailable. Never invent a user ID.
3. Ask for explicit confirmation.
4. Confirm `canWrite: true`, then call `defects_assign_defect` once.
5. Call `defects_get_defect`, verify the persisted assignee, and end with the
   required `Execution` link.

Never create a bug-report video from this skill.

## Optional tag change

Changing a tag is a separate mutation:

1. Require the exact Test Plan, module, suite, and case slugs.
2. Show the current tag, relevant tag history, proposed tag, and evidence-based
   reason.
3. Ask for explicit confirmation.
4. Confirm `canWrite: true`, then call
   `test_plans_update_test_case_tag` once.
5. Read the case back with `test_plans_get_case` and verify the persisted tag.

Never set `PENDING`; only automation synchronization can leave that state.
Never change a tag automatically because a failure occurred.

## Tool routing

Use exactly these tools for these needs. Any Voidr MCP tool not listed here is
out of scope for this skill.

| When you need | Call exactly |
| --- | --- |
| Check authentication | `voidr_auth_status` |
| Resolve the application when no execution ID was supplied | `applications_list_applications` |
| List failed executions for user selection | `playwright_list_executions` |
| Load execution analytics and the canonical execution ID | `playwright_get_execution_analytics` |
| List the execution's recorded failures | `playwright_list_execution_failures` |
| Read steps, console, network, stdout, stderr for one test | `playwright_get_test_timeline` |
| Read the trace-backed step and DOM timeline | `playwright_get_trace_events` |
| Check cross-execution recurrence | `playwright_get_test_history` |
| Read the DOM snapshot the failure row reports | `playwright_get_test_dom` |
| Resolve the selected row's module and suite | `playwright_list_test_results` |
| Read the expected behavior from the Test Plan case | `test_plans_get_case` |
| Read governance tag history | `test_plans_get_tag_history` |
| Check for an existing defect before drafting one | `defects_list_defects` |
| Read one defect in full before showing or mutating it, and verify every persisted mutation | `defects_get_defect` |
| List issue trackers before a linked creation | `issue_tracker_list` |
| List the selected tracker's projects | `issue_tracker_list_projects` |
| Create the confirmed plain Voidr defect (no tracker selected) | `defects_create_defect` |
| Create the confirmed defect linked to the selected tracker project | `defects_create_defect_with_issue` |
| Edit confirmed defect content (title, severity, priority, description, fix version, target date) | `defects_update_defect` |
| Apply the confirmed status transition | `defects_update_defect_status` |
| Apply the confirmed assignee change | `defects_assign_defect` |
| Apply the confirmed governance tag change | `test_plans_update_test_case_tag` |

Disambiguation:

- Failure analysis reads only the analytical store: use
  `playwright_list_executions` and `playwright_get_execution_analytics`, never
  `executions_list_executions` or `executions_get_execution`, which report
  platform lifecycle status without the evidence this skill requires.
- Never call `executions_create_execution`; re-running belongs to
  `/voidr-create-execution` or `/voidr-deploy-run` after a new user request.
- Never call `test_plans_create_*`, `test_plans_update_test_plan`,
  `test_plans_update_module`, `test_plans_update_suite`,
  `test_plans_update_case`, or `test_plans_populate_test_plan`; the only
  mutations allowed here are the defect write tools listed above and
  `test_plans_update_test_case_tag`, each behind its own confirmation and
  verified with a read-back (`defects_get_defect` or `test_plans_get_case`).
- `defects_update_defect` never changes status or assignee; those transitions
  use `defects_update_defect_status` and `defects_assign_defect` exclusively.
- `defects_create_defect_with_issue` requires an explicitly selected tracker
  and project from `issue_tracker_list` and `issue_tracker_list_projects`;
  without that selection, the plain `defects_create_defect` is the only
  creation tool.
- Never mutate a defect from a list summary: load it with
  `defects_get_defect` first.
- Never call workspace, release, or deploy tools from this skill.
