---
name: voidr-create-execution
description: Creates one confirmed Voidr platform execution with executions_create_execution. Use when the user asks to run an already-automated Test Plan or selected test cases and the application, plan, environment, and optional target slugs are already known.
---

# Create a Voidr execution

Never call a tool that starts a Hive process. Use only
`executions_create_execution`.

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

Do not call another tool to discover or validate missing values. Ask the user
for them and stop.

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
