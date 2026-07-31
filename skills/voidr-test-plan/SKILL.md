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

If the user already supplied an explicit Test Plan ID, call
`test_plans_get_test_plan` with that exact ID. If it is absent from the current
Voidr environment, stop and report that exact result. Do not list plans, search
for a similarly named plan, or substitute another ID. Continue only after a
new user-authored message explicitly selects a different Test Plan.

Otherwise:

1. Call `test_plans_list_test_plans` for the selected application.
2. Use `ask_user` when available to show each returned plan name, status, and
   test count as selectable options. Keep IDs internally and never ask the user
   to type a `testPlanId`.
3. Call `test_plans_get_test_plan` for the selected ID.
4. Ask whether to implement all pending cases, a named subset, or to add
   new cases (see “Add cases to an existing plan”).
5. Repeat the exact selected case slugs and wait for confirmation.

Never resolve the plan from `project.json`.
Never silently replace a Test Plan after any not-found, authorization, or
environment mismatch response.

## Add cases to an existing plan

When the user wants new scenarios in an already-persisted plan (for example
answering a case-selection question with "quero criar um novo caso"), this
is the supported route. Do not push the user back to implementing existing
cases, do not treat the request as a new Test Plan, and do not call a
creation tool directly:

1. Read the selected plan with `test_plans_get_test_plan` and show its
   modules and suites.
2. Ask whether the new cases belong to an existing module and suite or to
   new ones, and collect from the user (or from an explicitly authorized
   repository or document) the scenarios, expected behavior, and
   preconditions.
3. Show a draft containing only the additions: target module and suite
   (exact existing slugs, or proposed names for new structure), each case
   with Arrange/Act/Assert, priority/severity, and
   `{{env.VARIABLE_NAME}}` placeholders only.
4. Instruct the user to type exactly `Aprovo este Test Plan` in the normal
   chat input and end the response. The runtime hook blocks these writes
   until that new user-authored message arrives; `ask_user` selections do
   not satisfy it.
5. Only after that approval, call `test_plans_create_module` and
   `test_plans_create_suite` for genuinely new structure, then
   `test_plans_create_case` once per approved case, referencing only the
   exact slugs each creation response returned.
6. Read the plan back with `test_plans_get_test_plan`, verify the added
   content, and report it.

New cases enter the plan as not automated. Implementing and deploying them
follows the normal `/voidr-implement-tests` and `/voidr-deploy-run` gates.

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

After the feature and local smoke target are confirmed, ask exactly:

> Com base em quais insumos devo montar o Test Plan?

Use `ask_user` with exactly these selectable options:

- `Analisar código-fonte do workspace`
- `Usar documentação ou requisitos`
- `Descrever regras e cenários no chat`
- `Combinar código, documentação e contexto do negócio`

End the response and wait. The application name, WEB/API type, environment,
feature name, and base URL are routing metadata. They are never sufficient
evidence for test cases, expected results, business rules, priorities, or
severity. Never draft a Test Plan from those values alone.

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
   Never open `.env`, `.env.*`, credential stores, source fixtures, or source
   files containing literal accounts, passwords, tokens, personal names,
   emails, CPF/CNPJ, phone numbers, or other identifiers. If a relevant file
   is blocked by policy, continue from routes, schemas, public interfaces,
   errors, and existing placeholder names. Never quote, summarize, echo, or
   display a literal value discovered in source, even temporarily.
4. Cite files or symbols as evidence and label every conclusion as
   `code-derived` or `user-confirmed`.
5. Treat business priority, intended policy, and explicit exclusions as
   unknown when the code cannot establish them. Put those unknowns in the
   draft as assumptions or open questions instead of blocking analysis.

The codebase may provide scenarios and behavior, but it must never select a
different feature or application than the user confirmed.

When the user selects code analysis without naming a repository, call
`voidr_workspace_inspect`, present the returned workspace repositories, and ask
which exact product repository or repositories to analyze. Do not select one
from its name.

When the user selects documentation, ask them to attach it, paste it, or provide
an exact accessible path or URL. Read the actual content before deriving any
scenario. Cite the document section, requirement, or source location used.

When the user selects chat context, ask these questions in one group:

1. Which scenarios inside the selected feature are critical?
2. What is the expected behavior or acceptance criterion?
3. Which behavior is explicitly out of scope?
4. What data, accounts, or preconditions are available?

For combined context, collect each chosen source and label every conclusion by
source. Ask only for material business decisions that code or documentation
cannot establish.

After collecting the inputs, show a `Resumo dos insumos do planejamento` with:

- selected source or sources;
- concrete code or documentation evidence;
- user-confirmed business rules;
- candidate critical scenarios and expected behavior;
- assumptions and open questions;
- data and technical preconditions.

Represent every test datum only as `{{env.VARIABLE_NAME}}`. Never include an
`Exemplo`, `Sample`, or default-value column and never invent sample emails,
passwords, tokens, CPF/CNPJ, phone numbers, personal names, or URLs. A
placeholder table may contain only the placeholder name and a non-sensitive
description.

Instruct the user to type exactly `Confirmar insumos do planejamento` in the
normal chat input and end the response. Do not use `ask_user`, selectable
options, or an agent-authored message for this confirmation: tool-result
selections do not reach the runtime approval hook. This confirmation must
arrive as a new user-authored chat message. Do not render a Test Plan draft
before it.

### Gate 4: visible draft and approval

Only after `Confirmar insumos do planejamento`, create a visible draft with:

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

Ask the user to approve or revise the draft by typing exactly
`Aprovo este Test Plan` in the normal chat input. Do not use `ask_user`,
selectable options, or an agent-authored message for this approval:
tool-result selections do not reach the runtime approval hook. A generic `Sim`
is not approval. End the response and wait for that new user-authored chat
message. Do not persist a partial or unapproved plan. Do not call
`test_plans_create_test_plan`,
`test_plans_create_module`, `test_plans_create_suite`,
`test_plans_create_case`, or `test_plans_populate_test_plan` before this
approval.

The runtime hook blocks all Test Plan mutations without both the planning-input
confirmation and this draft approval. If a mutation is denied, do not retry
with another create or update tool; return to the missing visible gate.

Before the linked test repository has been selected and prepared, do not
create, edit, delete, or rewrite any local file, including memory documents,
policy files, README files, `.env.example`, fixtures, product source, or the
test repository. Research and the visible draft are read-only conversation
steps.

After approval:

1. Call `test_plans_create_test_plan`.
2. Use the returned ID, never a guessed or sentinel ID. Capture the returned
   `repository` object. On the configured production backend, creation is successful only
   when the server also provisions or reuses and links a private GitHub
   repository. If `repository` is absent, stop and report the incomplete
   server response; never compensate by inventing a repository URL. Do not
   retry `create_test_plan` and do not call `populate_test_plan`: the server
   rolls back newly created Test Plans and repositories when provisioning
   fails, and the plugin bridge rejects population without a complete
   repository-bearing creation response.
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

## Tool routing

Use exactly these tools for these needs. Any Voidr MCP tool not listed here is
out of scope for this skill.

| When you need | Call exactly |
| --- | --- |
| Confirm authentication before any platform read | `voidr_auth_status` |
| List applications for user selection | `applications_list_applications` |
| Resolve a missing `type` on the selected application | `applications_get_application` |
| List environments of the selected application | `applications_list_environments` |
| List existing Test Plans for user selection | `test_plans_list_test_plans` |
| Read one explicitly selected Test Plan, or verify persisted content | `test_plans_get_test_plan` |
| List workspace repository candidates for read-only code context | `voidr_workspace_inspect` |
| Persist the approved new plan (first mutation) | `test_plans_create_test_plan` |
| Persist the approved structure right after a complete creation response | `test_plans_populate_test_plan` |
| Add a module, suite, or case to an already-persisted plan, after the additions draft was approved (see “Add cases to an existing plan”) | `test_plans_create_module`, `test_plans_create_suite`, `test_plans_create_case` |
| Edit an already-persisted plan, module, suite, or case only when the user explicitly requests that exact change | `test_plans_update_test_plan`, `test_plans_update_module`, `test_plans_update_suite`, `test_plans_update_case` |

Disambiguation:

- `test_plans_populate_test_plan` is only the bulk write that immediately
  follows a complete `test_plans_create_test_plan` response in the same
  approved flow. Any later addition uses the incremental `test_plans_create_*`
  tools; any later edit uses the matching `test_plans_update_*` tool.
- `test_plans_update_*` tools never repair a failed creation, a not-found
  slug, or a blocked mutation; on those errors, read the plan with
  `test_plans_get_test_plan`, stop, and report.
- `test_plans_list_test_plans` is only for user selection, never a fallback
  after a not-found, authorization, or creation error.
- Never call `executions_*`, `playwright_*`, or `defects_*` tools from this
  skill.
- Never call `voidr_workspace_prepare_test_repository`,
  `voidr_workspace_bootstrap_test_repository`,
  `voidr_workspace_select_test_repository`,
  `voidr_workspace_scaffold_test_cases`, or `voidr_smoke_build`; repository
  setup and implementation belong to `/voidr-develop-tests` and
  `/voidr-implement-tests`.
