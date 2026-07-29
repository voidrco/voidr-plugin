---
name: voidr-test-plan
description: Creates or selects a Voidr Test Plan with mandatory user-selected feature, scope collection, visible draft, and explicit human approval gates. Use after the user has said whether the plan is new or existing.
argument-hint: "[novo|existente] [objetivo]"
---

# Voidr Test Plan

Never call a tool that starts a Hive process. Draft plans locally from the
user's answers and repository context; use only Test Plan CRUD tools to
persist an approved result.

## Authentication gate

Unless the calling workflow already confirmed authentication, call
`voidr_auth_status` before any application or Test Plan tool. It is read-only:
call it immediately without asking the user for permission to validate
authentication or continue.

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
3. Use `ask_user` when available to present application names and their
   returned `type` as selectable options. Keep IDs and types internally; never
   ask the user to type an `applicationId`.
   Confirm the application even when the MCP returns only one.
   Never auto-select a single result.
4. Keep the returned application ID as the authoritative `applicationId` and
   its `type` as the authoritative WEB/API classification.
5. If the list response omits `type`, call `applications_get_application` for
   the selected ID. Stop if a supported `WEB` or `API` type is still absent.

Never ask the user whether the selected application or feature is WEB or API.
That decision belongs to the Voidr product configuration.

One application may be implemented by multiple product repositories. Repository
selection is a later, separate decision and cannot change `applicationId`.

## Select the Voidr platform environment

After the application is explicitly confirmed:

1. Call `applications_list_environments` with its `applicationId`.
2. Present only environments returned by MCP, using `name`, `slug`, and
   `applicationUrl`.
3. Ask the user to select or confirm one, even when only one is returned.
4. Preserve that environment separately from the local smoke target.

Never ask the user to type a platform URL when MCP returned environments.
Never substitute localhost for the selected Voidr `applicationUrl`.

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

### Gate 1: user-selected feature

Before reading a product repository or calling any Test Plan mutation, ask
exactly:

> Qual feature ou jornada da aplicação selecionada você quer testar primeiro?

Use `ask_user` with free-text input and end the response. If the Voidr MCP
response contains real feature names, they may be selectable options. Otherwise
do not invent feature options.

Never infer the feature from:

- the application name;
- a repository or directory name;
- routes, README files, or source code;
- a generic happy path.

If the user already named a feature, repeat it and ask for confirmation.

### Gate 2: local smoke

After the feature is confirmed:

1. Carry the selected application's MCP `type` into the plan without asking
   the user to classify it.
2. Ask whether the local smoke should use:
   - the selected Voidr `applicationUrl`; or
   - localhost.
3. If localhost is chosen, ask for the exact URL and port. Store it as
   `localSmokeBaseUrl`, never as the platform environment.

### Gate 3: test context

After the feature is confirmed, ask only the missing questions, preferably in
one small group:

1. Which scenarios inside the selected feature are critical?
2. What is the expected behavior or acceptance criterion?
3. Which behavior is explicitly out of scope?
4. What data, accounts, or preconditions are available?

Use product repositories only as read-only supporting context and only after
the user identifies them.

### Gate 4: visible draft and approval

Create a visible draft with:

- plan name and objective;
- the exact user-selected feature or journey;
- selected application `type` returned by Voidr;
- selected Voidr environment name, slug, and `applicationUrl`;
- local smoke mode and `localSmokeBaseUrl`;
- assumptions and open questions;
- modules and suites;
- cases with stable proposed slugs;
- Arrange, Act, Assert;
- priority/severity;
- source or evidence for each case;
- total case count.

Ask the user to approve or revise the draft. Do not persist a partial or
unapproved plan. Do not call `test_plans_create_test_plan`,
`test_plans_create_module`, `test_plans_create_suite`,
`test_plans_create_case`, or `test_plans_populate_test_plan` before this
approval.

After approval:

1. Call `test_plans_create_test_plan`.
2. Use the returned ID, never a guessed or sentinel ID.
3. Call `test_plans_populate_test_plan` with the approved structure.
4. Read it back with `test_plans_get_test_plan`.
5. Compare the persisted modules, suites, and case slugs to the approved
   draft.
6. Stop on any mismatch and report it. Do not silently add missing cases.

Never create an empty DRAFT to complete later. The approved draft must contain
at least one case before the first mutation.

Do not create automation, generate code remotely, deploy, or execute from
this skill.
