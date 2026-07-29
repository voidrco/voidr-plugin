---
name: voidr-develop-tests
description: Inicia e orquestra o desenvolvimento de testes na Voidr. Use SEMPRE quando o usuário disser "quero desenvolver testes na Voidr", "quero criar testes na Voidr", "automatizar testes na Voidr", "criar um Test Plan", "usar um Test Plan existente" ou pedir para implementar, publicar ou executar testes Playwright pela Voidr. O fluxo começa escolhendo Test Plan novo ou existente e carrega aplicações e planos exclusivamente pelo MCP da Voidr antes de inspecionar o workspace.
argument-hint: "[objetivo de teste]"
---

# Develop tests in Voidr

Treat this as a gated workflow. Never call a tool that starts a Hive process,
including indirectly through a generic or batch tool.

## 1. Establish intent before tools

For a new conversation, the first response must ask exactly one decision:

> Você quer criar um novo Test Plan ou trabalhar em um Test Plan existente?

Use the native `ask_user` question UI when available, with exactly these
selectable options:

1. `Criar novo Test Plan`
2. `Usar Test Plan existente`

End the response after this question. Do not answer it on the user's behalf.
Do not include application, flow, or repository questions in that first
question batch. Do not inspect `project.json`, scan repositories, or call a
platform tool before the user answers. A local file is not evidence of current
intent.

After the answer, keep these values explicit and separate:

- selected organization;
- selected application;
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

Call `voidr_auth_status`.

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
3. Always use `ask_user` when available to show the returned application names
   as selectable options and ask the user to choose one. Keep each returned ID
   internally, but do not require the user to copy or type an `applicationId`.
   Even when there is only one application, ask the user to confirm it.
4. If the user named an application, match it only against the MCP response.
   Ask on multiple matches and stop if no match exists.
5. Optionally call `applications_get_application` for the selected ID when
   details are needed.

Never use `voidr_workspace_inspect`, Explorer folders, Git remotes,
`package.json`, or `project.json` to populate the application question. Do not
offer a generic “application or flow” choice based on workspace directories.
Never ask the user to provide an `applicationId` manually.

Keep the selected `applicationId` authoritative for all Test Plan calls.

## 4. Route by Test Plan mode

For a new Test Plan, follow `/voidr-test-plan` in create mode. Do not ask for a
`testPlanId`; Voidr creates it only after the user approves the visible draft.

For an existing Test Plan, follow `/voidr-test-plan` in select mode. Call
`test_plans_list_test_plans` for the selected application, then use `ask_user`
when available to present the returned plan names as selectable options. Keep
the selected ID internally and never ask the user to type a `testPlanId`.

Do not proceed until the plan ID, application ID, organization ID, and exact
case scope are visible to the user.

## 5. Choose repositories only after the plan

Ask:

> Para implementar os testes, você quer usar um repositório de testes
> existente ou criar um novo?

For an existing repository:

1. Call `voidr_workspace_inspect` to list candidates.
2. Ask the user to select one candidate or provide an explicit path.
3. Call `voidr_workspace_select_test_repository` only after selection.

For a new repository:

1. Ask for the parent directory and repository name.
2. Show the exact destination and files to be created.
3. Obtain confirmation.
4. Call `voidr_workspace_bootstrap_test_repository` with the confirmed path,
   repository name, organization ID, application ID, and Test Plan ID.
   Then run `npm install` inside that new directory. If package registry
   authentication is unavailable, stop and report it without changing another
   repository.
5. Call `voidr_workspace_select_test_repository`.

Product repositories remain read-only. Never write to a repository merely
because it contains product code or a `project.json`.

After selecting the test repository, ask separately whether the user wants to
attach zero, one, or multiple product repositories as read-only context. Do not
change the selected application when product repositories are added.

## 6. Continue through the gates

Use `/voidr-implement-tests` for repository validation, scaffolding,
implementation, and local validation.

Use `/voidr-deploy-run` only after local validation passes.

At each handoff, summarize:

- current state;
- identifiers and selected cases;
- files changed;
- next mutation and the confirmation it requires.

Never auto-deploy and never auto-execute.
