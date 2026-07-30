---
name: voidr-test
description: Fluxo dev-first para criar e rodar testes da feature que o desenvolvedor acabou de implementar. Use SEMPRE que um dev disser "cria os testes da minha feature", "gerar testes do meu código", "testar minha feature", "acabei a feat, quero os testes", "escreve os testes dessa funcionalidade" ou invocar /voidr-test. Infere a feature do branch e do diff, confirma tudo em um único card, mostra cenários em linguagem simples e exige apenas a mensagem "Criar testes" antes de qualquer escrita.
---

# Test my feature (developer-first flow)

Never call a tool that starts a Hive process.

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

## 1. Silent context discovery (no questions yet)

When the flow starts:

1. Call `voidr_auth_status`. If `authenticated: false`, reply only:

   > A Voidr não está conectada. Execute `/copilot voidr-connect` para
   > conectar. Depois volte e peça os testes de novo.

   If multiple organizations exist, ask which one with `ask_user`.
2. Infer the feature from the repository the developer is working in,
   read-only: current branch name, commits not on the default branch, and
   `git diff <default-branch>...HEAD` (names and structure first; read file
   contents only as needed). This diff is the default planning evidence — do
   not ask the user which inputs to use.
3. Call `applications_list_applications`. If exactly one application exists,
   select it automatically. Otherwise ask with `ask_user` using the returned
   names. Use the returned `type` (WEB/API) silently.
4. Call `applications_list_environments` for the selected application. If
   exactly one environment exists, select it automatically. Otherwise ask
   with `ask_user`, defaulting to the non-production environment when the
   names make that obvious. Keep `applicationUrl` as the execution target.
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
   the developer ever has to type in this flow.

The runtime hook blocks every platform write until that message arrives.

## 4. Silent plumbing after approval

Only after `Criar testes`:

1. Call `test_plans_list_test_plans` for the selected application.
   - If a plan for this application already exists (single plan, or one named
     after the application), reuse it: add the feature as a new module with
     `test_plans_create_module`, a suite with `test_plans_create_suite`, and
     one case per approved scenario with `test_plans_create_case`
     (Arrange/Act/Assert derived from the scenario, placeholders only).
   - If none exists, call `test_plans_create_test_plan` named after the
     application and `test_plans_populate_test_plan` with the approved
     scenarios. Capture the returned `repository` object.
   - If a creation call fails, stop, show the exact error, and offer retry or
     cancel. Never silently switch to another plan.
2. Materialize the linked test repository. Never use terminal `find`, `ls`,
   or directory names to decide whether a checkout exists — a failed or empty
   shell command is not evidence of absence. Call
   `voidr_workspace_bootstrap_test_repository` with the server-returned
   `repositoryUrl`, `allowExistingGitRepository: true`, and `workspaceRoot`
   set to the absolute path of the open VS Code workspace folder: the tool
   itself scans the workspace for a checkout whose Git `origin` matches and
   returns `reusedExistingCheckout: true` with the existing path instead of
   creating anything. Only when it reports no existing checkout, clone the
   server-returned URL (one confirmation for the destination, only on first
   use) and call it again. Always pass `workspaceRoot` on
   `voidr_workspace_inspect`, `voidr_workspace_select_test_repository`, and
   `voidr_workspace_bootstrap_test_repository`; if a tool reports it cannot
   resolve the workspace root, repeat the call with the exact path the error
   or the hook message provides.
3. Call `voidr_workspace_prepare_test_repository` once with the confirmed
   checkout, selected IDs, environment slug, linked repository URL, and the
   approved case slugs. Never run `npx voidr login` or manual setup commands.
4. Implement one Playwright spec per approved scenario inside the test
   repository only. Read the product code read-only for selectors and flows.
   No literal credentials or fallbacks; API endpoints come from the deployed
   product runtime, never from the frontend origin.

Report progress in one short line per step ("Preparando o repositório de
testes…", "Escrevendo os testes…"), not tool-by-tool narration.

## 5. Run, analyze, fix

1. Run the new specs once with `voidr_smoke_build` against the confirmed
   environment. Run it automatically — the approval already covers this run.
2. Present the result in developer terms: passed/failed per scenario, and for
   each failure the classification the tool returns (problema no teste ×
   comportamento do produto × dado/ambiente) with the exact error line and a
   suggested next step.
3. Stop after presenting. One smoke run per user message: investigate, edit,
   or rerun only after the user asks (for example "corrige e roda de novo").
4. When a failure looks like real product behavior, say so explicitly — that
   is the developer's bug to decide on, not something to paper over in the
   test.

If `npm install` or another step fails with a network error, say the shell has
no network access (Copilot sandbox) and ask once to rerun with network. If the
tools report an unsupported Node version, ask the user to activate Node 22
(volta/nvm) and retry. Never change registry, cache, lockfile, or package
manager, and never read or print `.env` contents.

## 6. Ship: PR, publish, run on the platform

When all scenarios pass locally:

1. Offer to commit and push the new tests and open a PR — each with its own
   explicit authorization, never automatic.
2. After the user confirms the PR is merged, load `/voidr-deploy-run` and
   follow its gates to publish the merged commit as an immutable release and
   create the platform execution. Translate its questions into simple terms
   ("Publicar os testes na Voidr?", "Rodar os testes na plataforma?") but keep
   its confirmations and verifications exactly as specified.
3. Report the final platform result with the execution link when available.

Never auto-deploy, never auto-execute, and never expand beyond the approved
scenarios without a new user request.
