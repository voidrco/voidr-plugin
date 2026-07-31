---
name: voidr-develop-tests
description: Inicia e orquestra o desenvolvimento de testes na Voidr. Use SEMPRE quando o usuário disser "quero desenvolver testes na Voidr", "quero criar testes na Voidr", "automatizar testes na Voidr", "criar um Test Plan", "usar um Test Plan existente" ou pedir para implementar, publicar ou executar testes Playwright pela Voidr. Antes de qualquer tool, pergunta se o Test Plan é novo ou existente; depois exige seleção humana de aplicação e ambiente via MCP, usa o tipo WEB/API do produto, coleta feature e smoke local, apresenta draft e exige aprovação.
---

# Develop tests in Voidr

Treat this as a gated workflow. Never call a tool that starts a Hive process,
including indirectly through a generic or batch tool.

## Non-negotiables

Read this entire skill file once when it activates, before the first
question or tool call; never act from a partial read.

1. The first response of a new workflow asks exactly one decision — new
   versus existing Test Plan — unless the user's message already states
   that choice unambiguously.
2. Never ask the user to type an organization ID, application ID, Test
   Plan ID, case slug, or repository path. Every choice is selected from a
   platform listing rendered with `ask_user`.
3. Never run Git, npm, npx, or the Voidr CLI in the terminal. Repository
   discovery, setup, validation, publishing, and deploy happen only
   through the bridge tools routed at the end of this file.
4. Test Plan content is created or changed only inside `/voidr-test-plan`,
   behind its typed approval gates. A request for a new case in an
   existing plan follows its “Add cases to an existing plan” section —
   never a fallback to implementing existing cases.
5. The platform environment and the local smoke target are different
   values; never substitute one for the other.
6. Never delegate any part of this workflow to a subagent. Approval gates
   are recorded per chat session, and a subagent session can never receive
   the user's typed approval — its platform writes are always denied.

Selection contract: every choice in this workflow — plan mode, application,
environment, Test Plan, repository, planning inputs — must be rendered with
the native `ask_user` selectable options whenever that control is available.
Present free-text lists only when `ask_user` is genuinely unavailable, and say
so. The only exceptions are the two runtime gates that require a typed chat
message: `Confirmar insumos do planejamento` and `Aprovo este Test Plan`.
The question UI rejects a question with a single option. When exactly one
candidate exists, still confirm it with two options — `Usar <nome>` and
`Cancelar` — never retry a one-option question and never skip the
confirmation because the UI errored.

Secrets contract: never reproduce credentials, emails, tokens, CPF/CNPJ, or
other personal identifiers found in product code, documentation, or `.env`
files — not in chat, not in summaries, not in drafts, not in specs. Record
only the environment variable names as `{{env.VARIABLE_NAME}}` placeholders.
Never read or print `.env` contents through any tool or terminal command; if
a value was already exposed, recommend rotating it.

Data provenance contract: every platform fact — application, environment,
Test Plan, module/suite/case slug, URL, execution status — exists only when a
Voidr tool returned it in this session. Never infer platform data from folder
names, file contents, chat history, memory, or previous conversations. When a
value is unknown, call the corresponding read tool first. The bridge blocks
any call that references an applicationId, environment slug, or case slug the
platform never returned.

## 1. Establish intent before tools

For a new conversation, the first response must ask exactly one decision:

> Você quer criar um novo Test Plan ou trabalhar em um Test Plan existente?

Use the native `ask_user` question UI when available, with exactly these
selectable options:

1. `Criar novo Test Plan`
2. `Usar Test Plan existente`

End the response after this question. Do not answer it on the user's behalf.
The only exception: when the user's current message already states the
choice unambiguously (for example “implementar testes de um Test Plan
existente” or “criar um novo Test Plan”), do not re-ask an already-answered
question — restate the detected mode in one line and continue directly to
the authentication check.
Do not include application, flow, or repository questions in that first
question batch. Do not inspect `project.json`, scan repositories, or call a
platform tool before the user answers. A local file is not evidence of current
intent.

When the user selects either option, immediately call `voidr_auth_status` in
that same turn. This read-only check requires no confirmation. Do not ask
whether to validate authentication, whether to proceed, or what the user wants
to do next. The plan-mode answer already authorizes this mandatory discovery
step.

After the answer, keep these values explicit and separate:

- selected organization;
- selected application;
- selected application `type` (`WEB` or `API`) returned by Voidr;
- selected Voidr platform environment and its `applicationUrl`;
- user-selected feature or journey;
- separate local smoke target and base URL;
- selected Test Plan;
- selected writable test repository;
- optional product repositories used as read-only context;
- selected test-case slugs.

An application is a Voidr platform entity identified by `applicationId`. A
workspace folder is a repository candidate, never an application candidate.
One Voidr application may use multiple product repositories and a separate test
repository, so never infer or rank applications from directory names.

Never call a tool that starts a Hive process. Plan drafting and Playwright
implementation are performed by the Copilot agent itself.

## 2. Check authentication

Call `voidr_auth_status` immediately after the plan-mode answer without an
additional user gate.

- If it returns `authenticated: false`, stop the current workflow and reply
  only:

  > A Voidr não está conectada. Execute `/copilot voidr-connect` para conectar
  > uma Service Account. Depois volte e continue este fluxo.

  Do not explain manual provisioning, suggest `npx voidr login`, ask another
  question, or call any application, Test Plan, workspace, deploy, or execution
  tool.
- If multiple organizations exist and none was explicitly chosen, show their
  names and ask which one to use.
- Call `voidr_auth_select_organization` only after the user chooses.
- If `write` is absent, allow read-only discovery but stop before plan,
  deploy, or execution mutations. Direct the user to
  `/copilot voidr-connect` before a mutation.
- Never ask the user to paste a client secret into chat.

## 3. Select the Voidr application through MCP

After authentication and organization selection:

1. Call `applications_list_applications`.
2. Build application choices exclusively from that tool response.
3. Always use `ask_user` when available to show each returned application name
   and `type` as selectable options and ask the user to choose one. Keep each
   returned ID and `type` internally, but do not require the user to copy or
   type an `applicationId`.
   Even when there is only one application, ask the user to confirm it.
   A single result is not user confirmation; a native question and answer are
   still required.
4. If the user named an application, match it only against the MCP response.
   Ask on multiple matches and stop if no match exists.
5. Treat the selected application's MCP `type` as authoritative for whether
   tests target WEB or API. Never ask the user to decide WEB versus API.
6. If `type` is absent from the list response, call
   `applications_get_application` for the selected ID. Stop if that response
   still does not contain a supported `WEB` or `API` type.

Never use `voidr_workspace_inspect`, Explorer folders, Git remotes,
`package.json`, or `project.json` to populate the application question. Do not
offer a generic “application or flow” choice based on workspace directories.
Never ask the user to provide an `applicationId` manually.

Keep the selected `applicationId` and `type` authoritative for all Test Plan
and implementation steps.

## 4. Select the Voidr platform environment through MCP

Only after the user confirms the application:

1. Call `applications_list_environments` with the selected `applicationId`.
2. Build choices exclusively from that response. Show `name`, `slug`, and
   `applicationUrl`.
3. Use `ask_user` to select or confirm one returned environment. A single
   environment must still be confirmed.
4. Keep the selected `name`, `slug`, and `applicationUrl` as the platform
   execution target.

Do not ask for a platform environment or base URL as free text. Do not use
localhost as the platform environment unless localhost was actually returned
by `applications_list_environments`. If no environment is returned, stop and
tell the user to configure one in the selected Voidr application.

The platform environment and local smoke target are different values. Never
overwrite the selected platform `applicationUrl` with localhost.

## 5. Route by Test Plan mode

Before calling any Test Plan mutation tool, explicitly load the
`/voidr-test-plan` skill and follow its full instructions. Mentioning that skill
is not enough. If it cannot be loaded, stop.

For a new Test Plan, use this mandatory sequence:

1. Ask exactly:

   > Qual feature ou jornada da aplicação selecionada você quer testar
   > primeiro?

   Use a free-text `ask_user` field. Offer selectable features only when their
   names came from the Voidr MCP response or the user; never invent options from
   the application name or a repository. End the response and wait.
2. Carry the selected application's MCP `type` into the Test Plan. Do not ask
   the user whether the feature is WEB or API.
3. Ask:

   > Para o smoke local, deseja usar a URL do ambiente Voidr selecionado ou
   > localhost?

   Present exactly:

   - `Usar ambiente Voidr — <applicationUrl>`
   - `Usar localhost`

   If localhost is selected, ask for the exact local URL including port. Do not
   guess it. Keep this URL only as `localSmokeBaseUrl`. Present this question
   immediately after the feature answer; do not ask whether the user wants to
   see the options.
4. Immediately after the local smoke answer, ask exactly:

   > Com base em quais insumos devo montar o Test Plan?

   Use `ask_user` with these selectable options:

   - `Analisar código-fonte do workspace`
   - `Usar documentação ou requisitos`
   - `Descrever regras e cenários no chat`
   - `Combinar código, documentação e contexto do negócio`

   End the response and wait. Application name, application type, environment,
   feature name, and base URL are routing metadata, never sufficient test-design
   evidence. Do not draft cases from those values.
5. Collect the selected inputs:
   - For code, call `voidr_workspace_inspect`, ask which exact product
     repository or repositories to analyze, and inspect only the selected
     feature's routes, UI or API handlers, validations, domain errors, fixtures,
     existing tests, and environment-variable names. If the user already named
     a repository, treat that as authorization for read-only inspection and do
     not ask permission again.
     Never open `.env`, `.env.*`, credential stores, or any source/fixture
     containing literal accounts, passwords, tokens, personal names, emails,
     CPF/CNPJ, phone numbers, or other identifiers. Never quote or summarize
     such values. Continue from routes, schemas, errors, public interfaces, and
     placeholder names when a sensitive file is blocked.
   - For documentation, ask the user to attach it, paste it, or provide an
     exact accessible path or URL. Read the actual content before deriving a
     scenario.
   - For chat context, collect critical scenarios, expected behavior,
     out-of-scope behavior, and test data or preconditions in one question
     group.
   - For combined context, collect every selected source and distinguish which
     conclusion came from which source.
   Never request secret values.
6. Show a `Resumo dos insumos do planejamento` containing the selected sources,
   concrete evidence, derived scenarios, expected behavior, assumptions, open
   questions, and preconditions. Then instruct the user to type exactly
   `Confirmar insumos do planejamento` in the normal chat input and end the
   response. Do not use `ask_user`, selectable options, or an agent-authored
   message for this confirmation: tool-result selections do not reach the
   runtime approval hook. The confirmation must arrive as a new user-authored
   chat message. Do not show a Test Plan draft yet. Show test data only as
   `{{env.VARIABLE_NAME}}`; never add example/sample/default values or literal
   emails, passwords, tokens, CPF/CNPJ, phone numbers, personal names, or URLs.
7. Only after that exact confirmation, present a complete Test Plan draft
   containing at least one case with
   Arrange/Act/Assert.
8. Ask the user to approve or revise that exact draft. Instruct the user to
   type exactly `Aprovo este Test Plan` in the normal chat input and end the
   response. Do not use `ask_user`, selectable options, or an agent-authored
   message for this approval: tool-result selections do not reach the runtime
   approval hook. A generic `Sim` is not approval. The approval must arrive as
   a new user-authored chat message after the complete draft is visible.
9. Only after explicit approval may the agent call
   `test_plans_create_test_plan` and `test_plans_populate_test_plan`.
   The Voidr MCP provisions and links a private GitHub repository as part of
   `test_plans_create_test_plan`. Capture the returned `repository` object,
   including `url`, `cloneUrl`, `defaultBranch`, `destination`, and `created`.
   Treat a missing repository as a failed creation flow and stop; do not create
   a second unrelated repository locally. Do not call
   `test_plans_populate_test_plan` after an incomplete create response and do
   not retry creation with a different name or ID. The plugin bridge enforces
   this ordering even if the model attempts to continue.
10. When `test_plans_create_test_plan` fails, stop immediately. Show the user
    the exact error returned by the tool, then offer only two choices: retry
    the same creation, or cancel. Never call `test_plans_list_test_plans`,
    never pick an existing Test Plan, and never switch from new to existing
    mode after a creation failure. Switching modes requires the user to
    explicitly say `Usar Test Plan existente` in a new message. The bridge and
    the runtime hook both block the listing fallback.

The runtime hook blocks every `test_plans_*` mutation until planning inputs
were explicitly confirmed and the Test Plan draft was explicitly approved. If
blocked, do not retry or switch to lower-level create/update tools. Return to
the missing visible gate.

Until the platform-linked test repository is selected and prepared, do not
create, edit, delete, or rewrite any local file. This includes memory/policy
documents, README files, `.env.example`, fixtures, product source, and test
files. Product analysis and Test Plan drafting are read-only.

Do not infer a feature from the application name, product repository, route,
README, or existing source code. Do not create an empty DRAFT and fill it later.
Do not ask for a `testPlanId`; Voidr returns it after the approved plan is
created.

For an existing Test Plan, follow `/voidr-test-plan` in select mode. Call
`test_plans_list_test_plans` for the selected application, then use `ask_user`
when available to present the returned plan names as selectable options. Keep
the selected ID internally and never ask the user to type a `testPlanId`.
When the user asks for a new case or scenario instead of implementing the
pending ones, stay in `/voidr-test-plan` and follow its
“Add cases to an existing plan” section — never push the user back to the
existing cases and never convert the request into a new Test Plan.
When the user already supplied an explicit Test Plan ID, read only that exact
ID. If it is not available in the current Voidr environment, stop and ask for
a new explicit selection. Never list plans as a fallback or silently replace
the selected plan with a similarly named one.

Do not proceed until the plan ID, application ID, organization ID, and exact
case scope are visible to the user.

## 6. Materialize the selected Test Plan repository locally

For a newly created Test Plan, the repository returned by
`test_plans_create_test_plan` is authoritative. Do not ask whether to use an
existing repository or create a new one, because the platform has already
created or reused and linked the correct repository.

1. Show the returned repository owner/name, URL, default branch, destination,
   and whether it was created or reused. Render the repository as a clickable
   Markdown link using the exact server-returned URL:
   `[<owner>/<repository-name>](<repository.url>)`. This output is mandatory
   before asking where to clone it.
2. Call `voidr_workspace_inspect` and look only for a checkout whose Git
   `origin` matches the returned repository URL. A matching checkout may be
   offered for confirmation; a folder with a similar name is not a match.
   Never use terminal `find` or `ls` to decide whether a checkout exists — a
   failed or empty shell command is not evidence of absence; the workspace
   tools and `voidr_workspace_bootstrap_test_repository` (which scans for a
   matching origin and returns `reusedExistingCheckout`) are the only source
   of truth. Always pass `workspaceRoot` with the absolute path of the open
   VS Code workspace folder on `voidr_workspace_inspect`,
   `voidr_workspace_select_test_repository`, and
   `voidr_workspace_bootstrap_test_repository`; if a tool reports it cannot
   resolve the workspace root, repeat the call with the exact path from the
   error or hook message. Never inspect, clone, select, or create a
   repository inside the plugin installation directory
   (`installed-plugins`); the runtime hook blocks it.
3. If no matching checkout exists, ask for the exact local destination inside
   the workspace. Show the exact `git clone` source and destination and obtain
   confirmation before cloning.
4. Clone only the server-returned `cloneUrl` or `url`. Do not construct or
   guess a GitHub URL.
5. Inspect the cloned checkout. If the provisioned repository already contains
   its Voidr Playwright package and configuration, keep those files. Only when
   the checkout is empty of test-project files, call
   `voidr_workspace_bootstrap_test_repository` with
   `allowExistingGitRepository: true` and the exact server-returned
   `repositoryUrl`. This tool verifies the local `origin` and refuses to
   overwrite existing files.
6. Explicitly load the `/voidr-implement-tests` skill before any setup or code
   work. Then call `voidr_workspace_prepare_test_repository` exactly once with:
   - the confirmed checkout path;
   - selected organization ID;
   - selected application ID;
   - selected Test Plan ID;
   - selected Voidr environment `slug`;
   - the exact server-returned linked repository URL as `repositoryUrl`;
   - the exact approved case slugs.
7. Treat that single tool as the mandatory setup gate. It performs this exact
   sequence:
   1. install repository dependencies;
   2. resolve Voidr Playwright CLI authentication by injecting the plugin's
      selected Service Account into child processes;
   3. run non-interactive `voidr link` only when `project.json` is absent;
   4. run `voidr scaffold` for the exact platform case slugs;
   5. run `voidr env pull` for the selected platform environment.
8. Never run `npx voidr login`. The plugin Service Account is the CLI
   authentication source, and its secret must remain model-invisible. Never run
   `npm install`, `npx voidr link`, `npx voidr scaffold`, or
   `npx voidr env pull` separately from the agent shell.
9. Continue only when the preparation result reports all setup steps complete,
   `interactiveLoginExecuted: false`, at least one generated spec, and the
   environment pull complete. The preparation result is the repository
   selection gate; do not call `voidr_workspace_select_test_repository` again.
10. If preparation fails, stop and report the failing setup step. Do not run
    `npm install`, `npx voidr`, Git, or any other manual fallback, and do not
    ask for case selection again.

For an existing Test Plan that already returns a linked Git repository, follow
the same origin-matching and local materialization sequence.

Only when an existing Test Plan has no linked repository, ask:

> Para implementar os testes, você quer usar um repositório de testes
> existente ou criar um novo?

For a user-selected existing repository:

1. Call `voidr_workspace_inspect` to list candidates.
2. Ask the user to select one candidate or provide an explicit path.
3. Call `voidr_workspace_select_test_repository` only after selection.

For a locally bootstrapped repository when the existing plan has no link:

1. Ask for the parent directory and repository name.
2. Show the exact destination and files to be created.
3. Obtain confirmation.
4. Call `voidr_workspace_bootstrap_test_repository` with the confirmed path,
   repository name, organization ID, application ID, and Test Plan ID.
5. Explicitly load `/voidr-implement-tests`, then call
   `voidr_workspace_prepare_test_repository` with the repository path,
   selected organization/application/Test Plan IDs, selected environment slug,
   exact server-returned linked repository URL, and exact case slugs. Do not
   execute any setup command separately.
6. If package registry authentication or any mandatory setup step fails, stop
   and report the failed step without changing another repository. Otherwise,
   continue directly with `/voidr-implement-tests`; do not call
   `voidr_workspace_select_test_repository` again.

Product repositories remain read-only. Never write to a repository merely
because it contains product code or a `project.json`.

After selecting the test repository, ask separately whether the user wants to
attach zero, one, or multiple product repositories as read-only context only
when none was already explicitly identified during planning. Do not ask again
for a repository already authorized and analyzed. Do not change the selected
application when product repositories are added.

## 7. Sandbox, network, and runtime failures

- If `npm install` or another network-dependent step fails with a resolution
  or connection error (for example `EAI_AGAIN`, `ENOTFOUND`, `ETIMEDOUT`),
  identify it explicitly as a shell without network access — the Copilot
  sandbox — and ask the user once to rerun that step with network access.
  Do not invent registry outages.
- Never change the npm registry, clean caches, delete lockfiles, add
  `--legacy-peer-deps`/`--force`, or switch package managers to work around
  an install failure. The runtime hook blocks these mutations.
- The preparation and smoke tools validate the Node.js runtime before running
  anything: Playwright 1.48 hangs on Node 23+. If they report an unsupported
  Node version, ask the user to activate the pinned Node 22 (volta/nvm) and
  retry. Do not attempt to run Playwright on the unsupported version.

## 8. Continue through the gates

Before repository setup, scaffolding, reading product code, or editing a test,
explicitly load the `/voidr-implement-tests` skill. If it cannot be loaded,
stop. Use it for the mandatory repository preparation gate, implementation,
and local validation.

Use `/voidr-deploy-run` only after local validation passes.

At each handoff, summarize:

- current state;
- identifiers and selected cases;
- files changed;
- next mutation and the confirmation it requires.

Never auto-deploy and never auto-execute.

## Tool routing

Use exactly these tools for these needs. Any Voidr MCP tool not listed here is
out of scope for this skill and belongs to the skill named for it.

| When you need | Call exactly |
| --- | --- |
| Check authentication after the plan-mode answer | `voidr_auth_status` |
| Apply the user's organization choice | `voidr_auth_select_organization` |
| List applications for user selection | `applications_list_applications` |
| Resolve a missing `type` on the selected application | `applications_get_application` |
| List environments of the selected application | `applications_list_environments` |
| List existing Test Plans for user selection | `test_plans_list_test_plans` |
| Read the explicitly selected Test Plan | `test_plans_get_test_plan` |
| Discover workspace checkouts (origin matching, read-only context candidates) | `voidr_workspace_inspect` |
| Initialize the test-project skeleton in a confirmed empty destination, or in an origin-matching checkout that has no test-project files (never clones — cloning belongs to the preparation gate) | `voidr_workspace_bootstrap_test_repository` |
| Register a user-selected existing repository when the plan has no linked repository | `voidr_workspace_select_test_repository` |
| Run the mandatory repository setup gate | `voidr_workspace_prepare_test_repository` |

Route the remaining scenarios through skills, not direct tool calls:

- Test Plan mutations (`test_plans_create_test_plan`,
  `test_plans_populate_test_plan`, `test_plans_create_*`,
  `test_plans_update_*`): only inside `/voidr-test-plan` after its gates.
- Implementation and local validation
  (`voidr_workspace_scaffold_test_cases`, `voidr_smoke_build`): only inside
  `/voidr-implement-tests`.
- Deploy and execution (`voidr_release_inspect`,
  `voidr_release_deploy_merged_pr`, `test_plans_get_test_counts`,
  `executions_create_execution`, `executions_get_execution`): only inside
  `/voidr-deploy-run`.
- Failure analysis (`playwright_*`, `defects_*`,
  `test_plans_update_test_case_tag`): only inside `/voidr-failure-analysis`.
- Browser login (`voidr_auth_login`): only inside `/voidr-connect`.

Never call `voidr_workspace_git_context` from this skill; branch/diff feature
inference belongs to the `/voidr-test` developer-first flow. Never call
`executions_list_executions` from any point of this workflow.
