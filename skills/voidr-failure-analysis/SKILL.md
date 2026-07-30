---
name: voidr-failure-analysis
description: Analyzes a failed Voidr Playwright execution or test using ClickHouse-backed evidence. Use when the user asks why a test failed, whether a failure is recurring, what evidence supports the cause, or whether to create a defect or change the test governance tag.
---

# Analyze Voidr failures

Never call a tool that starts a Hive process. Do not trigger self-healing,
automation generation, video generation, or another agent workflow.

## Authentication

Call `voidr_auth_status` before any remote tool.

If it returns `authenticated: false`, stop and reply only:

> A Voidr não está conectada. Execute `/copilot voidr-connect` para conectar
> uma Service Account. Depois volte e continue este fluxo.

Read-only analysis does not require write access. Defect creation and tag
changes require `canWrite: true`.

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

Creating a defect is a separate mutation:

1. Call `defects_list_defects` with `testCaseId: testCaseSlug`, sorted by
   `updatedAt` descending.
2. If a non-closed defect already exists, call `defects_get_defect` with that
   defect's `slug` or ID. Show the complete returned defect and the required
   `Execution` link instead of creating another. If the list result has no
   usable slug or ID, or the detail lookup fails, report that the existing
   defect could not be loaded and do not create a duplicate.
3. Otherwise draft title, severity, priority, application, environment,
   description, reproducibility, and relations to the execution and test.
   The draft must show the clickable `Execution` URL. Include that URL in the
   description under `Evidence execution`, set
   `relations.executions: [executionId]`, and set
   `relations.testCases: [testCaseSlug]`.
4. Show the complete draft and ask for explicit confirmation.
5. Confirm `canWrite: true`, then call `defects_create_defect` once.
6. Return the created defect and end with the same required `Execution` link.

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
