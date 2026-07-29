---
name: voidr-implement-tests
description: Implements an explicitly selected set of Voidr Test Plan cases in one explicitly selected Playwright test repository. Use after a Test Plan and writable repository have been confirmed.
---

# Implement Voidr Playwright tests

Never call a tool that starts a Hive process. The Copilot agent writes and
validates the Playwright code locally.

## Preconditions

Require all of:

- organization ID;
- application ID;
- application `type` (`WEB` or `API`) returned by Voidr;
- selected Voidr environment name, slug, and `applicationUrl`;
- Test Plan ID;
- exact user-selected feature or journey;
- local smoke mode and `localSmokeBaseUrl`;
- exact selected case slugs;
- test repository selected through
  `voidr_workspace_select_test_repository`.

If any value is missing, return to the relevant selection step.

Read the persisted plan with `test_plans_get_test_plan` before scaffolding.
Every selected case must already exist in that approved plan. If the plan is
empty or a case is missing, stop and return to `/voidr-test-plan`.

Never call `test_plans_create_test_plan`, `test_plans_create_module`,
`test_plans_create_suite`, `test_plans_create_case`, or
`test_plans_populate_test_plan` from this skill. Never invent a case because a
scaffold command reports that the plan is empty.

Use `localSmokeBaseUrl` only for local Playwright validation. Preserve the
selected Voidr environment and `applicationUrl` for platform execution. Never
replace platform configuration with localhost.

## Validate the repository link

Only now read `<test-repository>/project.json`.

- If absent, show the proposed `orgId`, `appId`, and `testPlanId`, then ask
  before creating it.
- If all values match, continue.
- If any value differs, show a field-by-field comparison and ask whether to
  relink.
- Never overwrite a mismatch without an explicit answer.

Do not use `project.json` to change the selected plan.

## Scaffold

Read the selected cases with `test_plans_get_test_plan`. Preserve their
module, suite, slug, and Arrange/Act/Assert content literally.

If a selected spec does not exist, call
`voidr_workspace_scaffold_test_cases` with the selected repository path, Test
Plan ID, and exact case slugs. This local bridge tool injects the selected
Service Account and the plugin's production endpoints into the Voidr CLI process
without exposing credentials to the model or writing them into the repository.
Never run `npm run voidr:scaffold` directly from the agent shell.

Do not use `--force` unless the user explicitly asks to replace an existing
spec after seeing the affected paths.

## Implement

For each selected case:

1. Inspect the product code and existing test patterns read-only.
2. Implement the smallest independent Playwright test matching the approved
   Arrange/Act/Assert steps.
3. Use environment placeholders for credentials and sensitive test data.
4. Prefer stable semantic locators and deterministic waits.
5. Do not expand into unselected cases.
6. Remove `test.skip` only when the case has a real assertion and can run.

Write only inside the selected test repository.

## Validate

Run targeted checks first:

```sh
npx playwright test <selected-specs> --list
npx playwright test <selected-specs>
```

After the Playwright checks, call
`voidr_workspace_build_test_repository` with the selected repository path and
Test Plan ID. Never run `npm run voidr:build` directly from the agent shell;
the bridge tool keeps the Service Account secret model-invisible and binds the
build to the plugin's configured Voidr environment.

Classify failures as test logic, product behavior, test data, authentication,
or infrastructure. Fix only failures in the selected scope. Do not dispatch
remote repair or self-healing.

Finish with:

- selected cases implemented;
- passing, failing, and skipped counts;
- files changed;
- unresolved blockers;
- whether the build artifact is ready for deployment.
