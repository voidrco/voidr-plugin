---
name: voidr-test
description: Fluxo dev-first para criar e rodar testes da feature que o desenvolvedor acabou de implementar. Use SEMPRE que um dev disser "cria os testes da minha feature", "gerar testes do meu código", "testar minha feature", "acabei a feat, quero os testes", "escreve os testes dessa funcionalidade" ou invocar /voidr-test. Infere a feature do branch e do diff, confirma tudo em um único card, mostra cenários em linguagem simples e exige apenas a mensagem "Criar testes" antes de qualquer escrita.
---

# Test my feature (developer-first flow)

Never call a tool that starts a Hive process.

## Non-negotiables

Read this entire skill file once when it activates; never act from a
partial read.

1. Never expose platform vocabulary to the user.
2. The only typed gate is `Criar testes`; no platform write happens
   before it.
3. Never run Git, npm, npx, or the Voidr CLI in the terminal; use only
   the tools routed at the end of this file.
4. Platform facts exist only when a Voidr tool returned them this
   session; never invent or infer them.
5. Never delegate any part of this flow to a subagent: the typed
   `Criar testes` gate is recorded per chat session, and a subagent's
   platform writes are always denied.

This flow exists for a developer who just finished a feature and wants tests
for it, without learning the Voidr platform. The mental model is:

> desenvolvi a feature → criar os testes → rodar → analisar → corrigir

## Language contract

Never expose platform vocabulary to the user. Do not say Test Plan, module,
suite, case slug, scaffold, populate, or provisioning in any user-facing
message. Say "os testes da sua feature", "cenários", "repositório de testes".
All the platform mechanics below happen silently.

Secrets contract: never reproduce credentials, emails, tokens, CPF/CNPJ, or
other personal identifiers found in the diff, product code, or `.env` files —
not in chat, summaries, scenarios, or specs. Use `{{env.VARIABLE_NAME}}`
placeholders and never read or print `.env` contents.

Data provenance contract: every platform fact — application, environment,
Test Plan, module/suite/case slug, URL, execution status — exists only when a
Voidr tool returned it in this session. Never infer platform data from folder
names, file contents, chat history, memory, or previous conversations. When a
value is unknown, call the corresponding read tool first. The bridge blocks
any call that references an applicationId, environment slug, or case slug the
platform never returned.

## 1. Silent context discovery (no questions yet)

When the flow starts:

1. Call `voidr_auth_status`. If `authenticated: false`, reply only:

   > A Voidr não está conectada. Execute `/copilot voidr-connect` para
   > conectar. Depois volte e peça os testes de novo.

   If multiple organizations exist, ask which one with `ask_user`, then call
   `voidr_auth_select_organization` with the chosen entry's organization ID
   before any other tool.
2. Infer the feature with `voidr_workspace_git_context`, passing
   `workspaceRoot` (the absolute path of the open VS Code workspace folder).
   It returns, per repository: current branch, default branch, commits
   ahead, changed files versus the default branch, and recent commits. The
   repository whose `onFeatureBranch` is true and whose changed files match
   the developer's request is the feature. Never `cd` or run `git` in the
   terminal for discovery — workspace paths with spaces break shell quoting
   and the sandbox may deny reads; the tool takes the path as data. Read the
   changed files' contents (read-only) as the default planning evidence — do
   not ask the user which inputs to use.
3. Call `applications_list_applications`. If exactly one application exists,
   select it automatically. Otherwise ask with `ask_user` using the returned
   names. Use the returned `type` (WEB/API) silently. If the list is empty,
   stop and say the organization has no application configured in Voidr yet;
   do not invent one.
4. Call `applications_list_environments` for the selected application. If
   exactly one environment exists, select it automatically. Otherwise ask
   with `ask_user`, defaulting to the non-production environment when the
   names make that obvious. Keep `applicationUrl` as the execution target.
   If no environment is returned, stop and say the selected application has
   no environment configured in Voidr yet; never substitute a URL.
5. If the current repository has no feature branch or no diff against the
   default branch, ask one free-text question: which feature should be
   tested, and where is its code.

## 2. One confirmation card

Show a single `ask_user` card summarizing everything inferred:

> Criar testes para **<feature em linguagem humana>** na aplicação
> **<app>** (<type>), validando contra **<ambiente> — <applicationUrl>**?

Options: `Continuar` and `Ajustar algo`. On `Ajustar algo`, ask what to
change in one question and update only that value. Do not re-ask what was
already confirmed.

## 3. Scenarios and the single approval gate

1. Analyze the feature diff and derive the test scenarios: happy path, the
   main error paths visible in the code (validations, guards, limits), and
   the user-visible behavior. Keep it to what the diff actually shows.
2. Present the scenarios as a short plain-language checklist, for example:
   - ✓ login com MFA válido redireciona para o dashboard
   - ✓ código MFA errado exibe mensagem de erro
   - ✓ terceira falha bloqueia a conta
   Show test data only as `{{env.VARIABLE_NAME}}` placeholders.
3. End the response instructing the user to reply exactly `Criar testes` in a
   normal chat message to approve, or to describe any scenario to add or
   remove. Do not use `ask_user` for this approval: it is the runtime gate
   and must arrive as a new user-authored message. This is the only phrase
   the developer ever has to type in this flow. Exception for a stale prompt hook: when a write was denied and the denial reports that the typed approval was never recorded, collect it with an `ask_user` question containing a single free-text field where the user types exactly `Criar testes` — typed free-text answers are recorded reliably and preserve authorship. Never present the phrase as a clickable option.
4. When the user asks to add, remove, or change a scenario instead of
   approving, apply the change, show the full updated checklist, and ask for
   `Criar testes` again. Only the checklist shown immediately before that
   message is the approved scope.

The runtime hook blocks every platform write until that message arrives.

## 4. Silent plumbing after approval

Only after `Criar testes`:

1. Call `test_plans_list_test_plans` for the selected application, then pick
   the plan with this exact precedence:
   1. a plan whose name exactly matches the application name — reuse it;
   2. otherwise, when exactly one plan exists — reuse it;
   3. otherwise, when multiple plans exist with no exact name match — ask
      with `ask_user`, in plain language ("Em qual conjunto de testes devo
      adicionar os testes desta feature?"), listing the returned plan names
      plus the option `Criar um novo`; never pick one silently;
   4. when no plan exists — create one, as described below.
   - When reusing a plan, add the feature as a new module with
     `test_plans_create_module`, a suite with `test_plans_create_suite`, and
     one case per approved scenario with `test_plans_create_case`
     (Arrange/Act/Assert derived from the scenario, placeholders only).
     Create strictly one structure call at a time — never module and suite
     in the same batch; each call waits for the previous response and uses
     only the exact `slug` that response returned (the platform generates
     slugs; never derive one from the name, and never invent, abbreviate,
     or re-case an identifier).
     On a not-found error, read the plan with `test_plans_get_test_plan` to
     get the real slugs; never retry the same identifier. The bridge blocks
     invented slugs and not-found retries.
     For a reused plan, read it with `test_plans_get_test_plan` and use its
     `gitProviderConfig.repositoryUrl` as the linked `repositoryUrl` for the
     preparation step. If the reused plan has no linked repository, stop and
     direct the user to `/voidr-develop-tests`, which handles repository
     selection; never pick or create a repository inside this flow.
   - If none exists, call `test_plans_create_test_plan` named after the
     application and `test_plans_populate_test_plan` with the approved
     scenarios. Capture the returned `repository` object.
   - If a creation call fails, stop, show the exact error, and offer retry or
     cancel. Never silently switch to another plan.
2. Call `voidr_workspace_prepare_test_repository` once with the selected IDs,
   environment slug, the server-returned linked `repositoryUrl`, the approved
   case slugs, and `workspaceRoot` set to the absolute path of the open
   VS Code workspace folder. This single tool materializes and prepares the
   repository itself: it locates an existing checkout by Git `origin`
   anywhere in the workspace, or clones the linked repository inside the
   workspace when none exists. Never run `git clone`, `npx voidr login`, or
   any manual setup command, never use terminal `find`/`ls` to decide whether
   a checkout exists, and never place the repository outside the workspace
   (the tool rejects `/tmp`). If it reports that the destination exists but
   is not a checkout of the linked repository, ask the user what to do with
   that stale directory — do not delete it and do not clone elsewhere.
3. Implement one Playwright spec per approved scenario inside the test
   repository only. Read the product code read-only for selectors and flows.
   No literal credentials or fallbacks; API endpoints come from the deployed
   product runtime, never from the frontend origin.

Report progress in one short line per step ("Preparando o repositório de
testes…", "Escrevendo os testes…"), not tool-by-tool narration.

## 5. Run, analyze, fix

1. Run the new specs once with `voidr_smoke_build`, passing the prepared
   repository path, the linked `repositoryUrl`, the plan ID, only the new
   spec paths, and the confirmed environment's `applicationUrl` as `baseUrl`.
   Run it automatically — the approval already covers this run.
2. Present the result in developer terms: passed/failed per scenario, and for
   each failure your own classification derived from the returned `failures`
   and traces (problema no teste × comportamento do produto × dado/ambiente)
   with the exact error line and a suggested next step. The tool returns raw
   evidence, not a classification.
3. Always close the smoke report by directing the user to the Playwright
   trace for analysis. The tool returns a `traces` list with one trace per
   scenario; show the exact ready-to-run command for each one, failures
   first:

   ```sh
   npx playwright show-trace <trace path>
   ```

   Explain in one line that the trace replays every step with screenshots,
   network calls, and console logs. Never omit this section, even when all
   scenarios pass.
4. Stop after presenting. One smoke run per user message: investigate, edit,
   or rerun only after the user asks (for example "corrige e roda de novo").
5. When a failure looks like real product behavior, say so explicitly — that
   is the developer's bug to decide on, not something to paper over in the
   test.

If `npm install` or another step fails with a network error, say the shell has
no network access (Copilot sandbox) and ask once to rerun with network. If the
tools report an unsupported Node version, ask the user to activate Node 22
(volta/nvm) and retry — never install, switch, or pin Node yourself. Never
change registry, cache, lockfile, or package manager, and never read or print
`.env` contents.

## 6. Ship: PR, publish, run on the platform

When all scenarios pass locally:

1. Show exactly what will be published — the feature branch name (for
   example `feat/<feature-slug>-tests`), the files changed, the commit
   message, and the PR title — and ask for one explicit authorization. Only
   after the user authorizes, call `voidr_workspace_publish_tests` with the
   prepared repository path, the linked `repositoryUrl`, the branch, and the
   commit message. Never run `git commit`, `git push`, or `gh` in the
   terminal: the sandbox has no Git credentials, and pushing to the default
   branch is forbidden — the tool runs outside the sandbox, enforces the
   feature branch, and opens (or reuses) the pull request. Report the
   returned pull request link.
2. After the user confirms the PR is merged, call `voidr_release_inspect`
   on the test repository to rediscover the merged PR, Test Plan ID, and
   repository URL — never ask the user for identifiers — then load
   `/voidr-deploy-run` and
   follow its gates to publish the merged commit as an immutable release and
   create the platform execution. Translate its questions into simple terms
   ("Publicar os testes na Voidr?", "Rodar os testes na plataforma?") but keep
   its confirmations and verifications exactly as specified. The translation
   changes vocabulary only: the deploy gate and the execution gate remain two
   separate questions, each awaiting its own explicit affirmative answer
   before its tool call. Never merge them into a single
   "publicar e rodar?" confirmation.
3. Report the final platform result with the execution link when available.

Never auto-deploy, never auto-execute, and never expand beyond the approved
scenarios without a new user request.

## Tool routing

Use exactly these tools for these needs. Any Voidr MCP tool not listed here is
out of scope for this flow.

| When you need | Call exactly |
| --- | --- |
| Check authentication | `voidr_auth_status` |
| Apply the user's organization choice when several exist | `voidr_auth_select_organization` |
| Infer the feature from branch and diff | `voidr_workspace_git_context` |
| List applications | `applications_list_applications` |
| List environments of the selected application | `applications_list_environments` |
| Find an existing plan for the application | `test_plans_list_test_plans` |
| Read a reused plan's linked `repositoryUrl`, or the real slugs after a not-found error | `test_plans_get_test_plan` |
| Add the feature to an existing plan | `test_plans_create_module`, `test_plans_create_suite`, `test_plans_create_case` |
| Create and fill a new plan | `test_plans_create_test_plan`, then `test_plans_populate_test_plan` |
| Materialize and prepare the test repository | `voidr_workspace_prepare_test_repository` |
| Run the new specs locally | `voidr_smoke_build` |
| Publish branch, commit, and pull request | `voidr_workspace_publish_tests` |
| Rediscover the merged PR and IDs before deploy | `voidr_release_inspect`, then load `/voidr-deploy-run` |

Disambiguation:

- Feature inference uses `voidr_workspace_git_context` only; never use
  `voidr_workspace_inspect` or terminal Git for it.
- Repository materialization uses `voidr_workspace_prepare_test_repository`
  only; never call `voidr_workspace_bootstrap_test_repository` or
  `voidr_workspace_select_test_repository` in this flow.
- Never call `test_plans_update_*` tools here; this flow only adds new
  modules, suites, and cases.
- Deploy and execution tools (`voidr_release_deploy_merged_pr`,
  `executions_create_execution`, `executions_get_execution`,
  `test_plans_get_test_counts`) run only inside `/voidr-deploy-run` and its
  gates.
- Never call `playwright_*` or `defects_*` tools; failure analysis belongs to
  `/voidr-failure-analysis`.
