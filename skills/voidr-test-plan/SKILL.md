---
name: voidr-test-plan
description: Creates or selects a Voidr Test Plan with mandatory user-selected feature, scope collection, visible draft, explicit human approval gates, and the linked repository URL as a required creation output. Use after the user has said whether the plan is new or existing.
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

Ask this choice immediately. Do not first ask whether the user wants to see the
options.

### Gate 3: test context

After the feature and local smoke target are confirmed, proceed directly to
context collection. Do not ask whether to present the options, whether to
analyze, or whether the user wants to answer now.

If the user explicitly names a product repository and asks to analyze it or use
it as context, that message is sufficient authorization for read-only
inspection. An `@repository` mention with an instruction such as “analise”,
“use como contexto”, or “desenvolva o plano com esse código” qualifies. Do not
ask for a second `Sim` or `Não`.

Inspect the named repository immediately and focus on the user-selected
feature:

1. Locate relevant routes, screens or endpoints, handlers, validations, domain
   rules, errors, fixtures, existing tests, and configuration.
2. Derive candidate critical scenarios and observable expected behavior.
3. Derive technical preconditions and environment-variable names, but never
   read or request secret values.
4. Cite files or symbols as evidence and label every conclusion as
   `code-derived` or `user-confirmed`.
5. Treat business priority, intended policy, and explicit exclusions as
   unknown when the code cannot establish them. Put those unknowns in the
   draft as assumptions or open questions instead of blocking analysis.

The codebase may provide scenarios and behavior, but it must never select a
different feature or application than the user confirmed.

Ask the user only for missing information that materially changes the proposed
Test Plan and cannot be inferred safely. If no product repository was
identified, ask the missing context questions in one group:

1. Which scenarios inside the selected feature are critical?
2. What is the expected behavior or acceptance criterion?
3. Which behavior is explicitly out of scope?
4. What data, accounts, or preconditions are available?

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

Ask the user to approve or revise the draft using the exact approval option
`Aprovar este Test Plan`. A generic `Sim` is not approval. End the response and
wait for that new user message. Do not persist a partial or unapproved plan. Do
not call `test_plans_create_test_plan`,
`test_plans_create_module`, `test_plans_create_suite`,
`test_plans_create_case`, or `test_plans_populate_test_plan` before this
approval.

The runtime hook blocks all Test Plan mutations without this approval. If a
mutation is denied, do not retry with another create or update tool; present
the complete draft and approval option.

After approval:

1. Call `test_plans_create_test_plan`.
2. Use the returned ID, never a guessed or sentinel ID. Capture the returned
   `repository` object. On the configured production backend, creation is successful only
   when the server also provisions or reuses and links a private GitHub
   repository. If `repository` is absent, stop and report the incomplete
   server response; never compensate by inventing a repository URL.
3. Call `test_plans_populate_test_plan` with the approved structure.
4. Read it back with `test_plans_get_test_plan`.
5. Compare the persisted modules, suites, and case slugs to the approved
   draft. Also verify that the persisted
   `gitProviderConfig.repositoryUrl` equals the `repository.url` returned by
   `test_plans_create_test_plan`.
6. Stop on any content or repository-link mismatch and report it. Do not
   silently add missing cases and do not continue to local repository setup.
7. Return the creation result using this mandatory Markdown shape:

   ```md
   Test Plan criado e verificado.

   - Test Plan: <plan-name> (`<test-plan-id>`)
   - Repositório vinculado: [<owner>/<repository-name>](<repository.url>)
   - Branch padrão: `<defaultBranch>`
   - Destino: `<destination>`
   - Provisionamento: `<criado|reutilizado>`
   ```

   Use the exact server-returned `repository.url` as the link target. Never
   print only a repository name or plain URL. Never invent, reconstruct, or
   substitute a GitHub link.

The skill has not completed successfully until this clickable repository link
is visible to the user. If `repository.url`, owner, name, or default branch is
missing, stop and report an incomplete MCP response instead of claiming the
Test Plan was created successfully.

Never create an empty DRAFT to complete later. The approved draft must contain
at least one case before the first mutation.

Do not create automation, generate code remotely, deploy, or execute from
this skill.
