---
name: voidr-test-plan
description: Creates or selects a Voidr Test Plan with an explicit human approval gate. Use after the user has said whether the plan is new or existing.
argument-hint: "[novo|existente] [objetivo]"
---

# Voidr Test Plan

Never call a tool that starts a Hive process. Draft plans locally from the
user's answers and repository context; use only Test Plan CRUD tools to
persist an approved result.

## Authentication gate

Unless the calling workflow already confirmed authentication, call
`voidr_auth_status` before any application or Test Plan tool.

If it returns `authenticated: false`, stop and reply only:

> A Voidr não está conectada. Execute `/copilot voidr-connect` para conectar
> uma Service Account. Depois volte e continue este fluxo.

Do not ask for application details or continue drafting until authentication
is confirmed.

## Select the owning Voidr application

This step is mandatory for both new and existing plans:

1. Call `applications_list_applications`.
2. Build choices only from applications returned by MCP. Never use workspace
   directories, repository names, Git remotes, or local files as application
   options.
3. Use `ask_user` when available to present application names as selectable
   options. Keep IDs internally; never ask the user to type an `applicationId`.
   Confirm the application even when the MCP returns only one.
4. Keep the returned application ID as the authoritative `applicationId`.

One application may be implemented by multiple product repositories. Repository
selection is a later, separate decision and cannot change `applicationId`.

## Existing plan

1. Call `test_plans_list_test_plans` for the selected application.
2. Use `ask_user` when available to show each returned plan name, status, and
   test count as selectable options. Keep IDs internally and never ask the user
   to type a `testPlanId`.
3. Call `test_plans_get_test_plan` for the selected ID.
4. Ask whether to implement all pending cases or a named subset.
5. Repeat the exact selected case slugs and wait for confirmation.

Never resolve the plan from `project.json`.

## New plan

Ask only the missing questions, preferably in small groups:

1. Is the target WEB or API, and which environment/base URL is relevant?
2. Which critical user journeys or business risks must be covered?
3. Which behavior is explicitly out of scope?
4. What data, accounts, or preconditions are available?

Use product repositories only as read-only supporting context and only after
the user identifies them.

Create a visible draft with:

- plan name and objective;
- assumptions and open questions;
- modules and suites;
- cases with stable proposed slugs;
- Arrange, Act, Assert;
- priority/severity;
- source or evidence for each case;
- total case count.

Ask the user to approve or revise the draft. Do not persist a partial or
unapproved plan.

After approval:

1. Call `test_plans_create_test_plan`.
2. Use the returned ID, never a guessed or sentinel ID.
3. Call `test_plans_populate_test_plan` with the approved structure.
4. Read it back with `test_plans_get_test_plan`.
5. Compare the persisted modules, suites, and case slugs to the approved
   draft.
6. Stop on any mismatch and report it. Do not silently add missing cases.

Do not create automation, generate code remotely, deploy, or execute from
this skill.
