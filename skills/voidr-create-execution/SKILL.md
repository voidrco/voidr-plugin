---
name: voidr-create-execution
description: Creates one confirmed Voidr platform execution with executions_create_execution, after the mandatory automation-sync verification with test_plans_get_test_plan and test_plans_get_test_counts. Use when the user asks to run an already-automated Test Plan or selected test cases and the application, plan, environment, and optional target slugs are already known.
---

# Create a Voidr execution

> Host note: `ask_user` names the host's native question tool — `ask_user` on
> GitHub Copilot CLI, `AskUserQuestion` on Claude Code. Wherever this skill
> says `ask_user`, use that tool with selectable options; plain chat text is
> never a substitute.

Never call a tool that starts a Hive process. Use only the sync-verification
reads and `executions_create_execution`, as routed below.

A routed tool missing from your available tools is grouped, not absent, and
each host reveals it differently. On GitHub Copilot CLI, past a tool-count
threshold the editor collapses tool sets into groups the model has to expand
first: find the activation entry whose summary lists that tool and call it
with the exact name you were given. On Claude Code the tool is deferred
instead: load it with `ToolSearch`, selecting its scoped name
(`mcp__plugin_voidr_voidr__<tool>`) or searching the bare name as keywords,
then call it. Never invent an activation name, never report the tool as
unavailable before the host's own mechanism has been tried, and never fall
back to a terminal command or a manual step. Only when that mechanism still
does not surface it, say exactly which tool is unreachable and stop.

## Collect the request

Require:

- `applicationId`;
- `planId`;
- `environment`;
- execution scope.

Use `provider: "PLAYWRIGHT"` and `source: "STORAGE"`.

For the full Test Plan, omit `targets`. For selected cases, require one target
per case with all three fields:

- `testCaseSlug`;
- `suiteSlug`;
- `moduleSlug`.

Do not call another tool to discover missing request values: `applicationId`,
`planId`, environment, and target slugs come from the user. Ask the user for
them and stop.

## Verify automation sync

The bridge blocks execution creation until the plan and its counts were read
in this session. With the supplied `planId`:

1. Call `test_plans_get_test_plan` and confirm the plan exists and every
   requested target case is present.
2. Call `test_plans_get_test_counts` and confirm the selected scope is
   automated and available for platform execution.
3. If a requested case is missing or not automated, stop and report exactly
   that. The fix is deploying the merged tests through `/voidr-deploy-run`,
   never re-creating modules, suites, or cases, and never retrying the
   execution call.

These two reads are the only permitted calls besides the execution itself.

## Confirm

Create one idempotency key for the request before confirmation. Keep that same
key if the confirmed call must be retried; create a new key for a later,
separately requested execution.

Show the exact `applicationId`, `planId`, environment, provider, source, scope,
targets, and idempotency key. Ask:

> Posso iniciar esta execução na plataforma?

Do not call the tool until the user confirms.

## Execute

After confirmation, call `executions_create_execution` exactly once with the
shown payload.

Do not list, inspect, poll, cancel, retry, repair, generate automation, or
trigger self-healing. If the call fails, report the error and ask before any
retry.

On success, return the execution ID, initial status, and:

`Execution: [Open execution](<VOIDR_PLATFORM_URL>/execution/<executionId>)`

Use `https://platform.voidr.co` when `VOIDR_PLATFORM_URL` is unavailable.

## Tool routing

This skill calls exactly three MCP tools:

| When you need | Call exactly |
| --- | --- |
| Verify the plan and requested cases exist | `test_plans_get_test_plan` |
| Verify the selected scope is automated | `test_plans_get_test_counts` |
| Create the single confirmed platform execution | `executions_create_execution` |

Any other Voidr MCP tool is out of scope for this skill:

- Never call another `executions_*` tool to list executions or observe the
  created one, and never call `applications_*` or another `test_plans_*` tool
  to discover, validate, or confirm missing request values. Ask the user and
  stop.
- Never call `playwright_*` tools; analyzing a failed execution belongs to
  `/voidr-failure-analysis`.
- Never call workspace, release, or deploy tools; deploying belongs to
  `/voidr-deploy-run`.
