---
name: voidr-test-plan
description: Creates or selects a Voidr Test Plan with an explicit human approval gate. Use after the user has said whether the plan is new or existing.
argument-hint: "[novo|existente] [objetivo]"
---

# Voidr Test Plan

Never call a tool that starts a Hive process. Draft plans locally from the
user's answers and repository context; use only Test Plan CRUD tools to
persist an approved result.

## Existing plan

1. Call `applications_list_applications`.
2. Ask the user to select an application if it is not already explicit.
3. Call `test_plans_list_test_plans` for that application.
4. Show plan name, ID, status, and test count. Ask the user to select one.
5. Call `test_plans_get_test_plan` for the selected ID.
6. Ask whether to implement all pending cases or a named subset.
7. Repeat the exact selected case slugs and wait for confirmation.

Never resolve the plan from `project.json`.

## New plan

Ask only the missing questions, preferably in small groups:

1. Which existing Voidr application owns the plan?
2. Is the target WEB or API, and which environment/base URL is relevant?
3. Which critical user journeys or business risks must be covered?
4. Which behavior is explicitly out of scope?
5. What data, accounts, or preconditions are available?

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
