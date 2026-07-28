---
name: voidr-develop-tests
description: Orchestrates Voidr test development from a natural-language request such as "quero desenvolver testes na Voidr". Use when the user wants to create or continue a Test Plan, implement Playwright tests, deploy them, or execute them on the Voidr platform.
argument-hint: "[objetivo de teste]"
---

# Develop tests in Voidr

Treat this as a gated workflow. Never call a tool that starts a Hive process,
including indirectly through a generic or batch tool.

## 1. Establish intent before tools

For a new conversation, the first response must ask:

> Você quer criar um novo Test Plan ou trabalhar em um Test Plan existente?

Do not inspect `project.json`, scan repositories, or call a platform tool
before the user answers. A local file is not evidence of current intent.

After the answer, keep these values explicit and separate:

- selected organization;
- selected application;
- selected Test Plan;
- selected writable test repository;
- optional product repositories used as read-only context;
- selected test-case slugs.

Never call a tool that starts a Hive process. Plan drafting and Playwright
implementation are performed by the Copilot agent itself.

## 2. Check authentication

Call `voidr_auth_status`.

- If multiple organizations exist and none was explicitly chosen, show their
  names and ask which one to use.
- Call `voidr_auth_select_organization` only after the user chooses.
- If the account is missing, stop and explain that a Voidr Service Account
  must be provisioned. Do not call `npx voidr login`.
- If `write` is absent, allow read-only discovery but stop before plan,
  deploy, or execution mutations.
- Never ask the user to paste a client secret into chat.

## 3. Route by Test Plan mode

For a new Test Plan, follow `/voidr-test-plan` in create mode.

For an existing Test Plan, follow `/voidr-test-plan` in select mode.

Do not proceed until the plan ID, application ID, organization ID, and exact
case scope are visible to the user.

## 4. Choose the repository only after the plan

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

## 5. Continue through the gates

Use `/voidr-implement-tests` for repository validation, scaffolding,
implementation, and local validation.

Use `/voidr-deploy-run` only after local validation passes.

At each handoff, summarize:

- current state;
- identifiers and selected cases;
- files changed;
- next mutation and the confirmation it requires.

Never auto-deploy and never auto-execute.
