# MCP tool routing

This is the canonical owner map for every tool the plugin bridge exposes in
`.mcp.json`. Each skill also carries its own `## Tool routing` section with the
same contract, because only the invoked skill is loaded at runtime; this file
is the maintenance view. `npm run validate` fails when a skill references a
tool outside the allowlist or when a configured tool is missing from this
document.

Routing invariants:

1. Every scenario a skill supports maps to exactly one tool (or one explicit
   tool sequence). The agent never chooses between similar tools.
2. A tool absent from the invoked skill's routing table is out of scope for
   that skill, even though the bridge exposes it.
3. Listing tools are for user selection only, never fallbacks after an error.

## Authentication

| Tool | Owner skills | Purpose |
| --- | --- | --- |
| `voidr_auth_status` | all flows (first call); `voidr-connect` | Validate the selected local Service Account and list local accounts. Always the first platform call of any flow. |
| `voidr_auth_select_organization` | `voidr-connect`, `voidr-develop-tests` | Apply the user's choice among accounts/organizations returned by `voidr_auth_status`. |
| `voidr_auth_login` | `voidr-connect` only | Official browser login. No other skill may call it; they redirect to `/copilot voidr-connect`. |

## Applications

| Tool | Owner skills | Purpose |
| --- | --- | --- |
| `applications_list_applications` | `voidr-develop-tests`, `voidr-test-plan`, `voidr-test`, `voidr-failure-analysis` | Build application choices exclusively from the platform. |
| `applications_get_application` | `voidr-develop-tests`, `voidr-test-plan` | Fallback only when the list response omits `type` for the selected ID. |
| `applications_list_environments` | `voidr-develop-tests`, `voidr-test-plan`, `voidr-test` | Environment choices for the selected application. |

## Test Plans

| Tool | Owner skills | Purpose |
| --- | --- | --- |
| `test_plans_list_test_plans` | `voidr-develop-tests`, `voidr-test-plan`, `voidr-test` | User selection of an existing plan. Never an error fallback. |
| `test_plans_get_test_plan` | `voidr-test-plan`, `voidr-implement-tests`, `voidr-deploy-run`, `voidr-test` | Read one explicitly selected plan; verify persisted content and real slugs. |
| `test_plans_get_test_counts` | `voidr-deploy-run` | Post-deploy synchronization verification only. |
| `test_plans_create_test_plan` | `voidr-test-plan`, `voidr-test` | First mutation of an approved new plan; must return the linked `repository`. |
| `test_plans_populate_test_plan` | `voidr-test-plan`, `voidr-test` | Bulk write immediately after a complete creation response, same approved flow. |
| `test_plans_create_module` / `test_plans_create_suite` / `test_plans_create_case` | `voidr-test-plan`, `voidr-test` | Incremental additions to an already-persisted plan. |
| `test_plans_update_test_plan` / `test_plans_update_module` / `test_plans_update_suite` / `test_plans_update_case` | `voidr-test-plan` | Edits explicitly requested by the user on persisted entities. Never error repair. |
| `test_plans_get_case` | `voidr-failure-analysis` | Expected behavior of one case; read-back after a tag change. |
| `test_plans_get_tag_history` | `voidr-failure-analysis` | Governance tag history. |
| `test_plans_update_test_case_tag` | `voidr-failure-analysis` | Confirmed governance tag change only. |

## Workspace and repository

| Tool | Owner skills | Purpose |
| --- | --- | --- |
| `voidr_workspace_inspect` | `voidr-develop-tests`, `voidr-test-plan` | List workspace checkouts: origin matching and read-only context candidates. |
| `voidr_workspace_git_context` | `voidr-test` | Branch/diff feature inference for the developer-first flow only. |
| `voidr_workspace_bootstrap_test_repository` | `voidr-develop-tests` | Initialize the test-project skeleton in a confirmed empty destination, or in an origin-matching checkout that lacks test-project files. Never clones — cloning belongs to `voidr_workspace_prepare_test_repository`. Detects an existing checkout by origin and returns `reusedExistingCheckout`. |
| `voidr_workspace_select_test_repository` | `voidr-develop-tests` | Register a user-selected existing repository when the plan has no linked repository. |
| `voidr_workspace_prepare_test_repository` | `voidr-develop-tests`, `voidr-implement-tests`, `voidr-test` | The single mandatory setup gate: install, CLI auth, link, scaffold, env pull. |
| `voidr_workspace_scaffold_test_cases` | `voidr-implement-tests` | Scaffold a case added after the preparation gate completed. |
| `voidr_smoke_build` | `voidr-implement-tests`, `voidr-test` | Local validation and authenticated build, outside the agent shell. |
| `voidr_workspace_publish_tests` | `voidr-test` | Branch, commit, and pull request through user credentials. |

## Release and executions

| Tool | Owner skills | Purpose |
| --- | --- | --- |
| `voidr_release_inspect` | `voidr-deploy-run`, `voidr-test` | Rediscover repository, plan, and merged PR from the checkout. Never ask the user for these IDs. |
| `voidr_release_deploy_merged_pr` | `voidr-deploy-run` | Fast-forward the clean checkout and publish the immutable release. |
| `executions_create_execution` | `voidr-create-execution`, `voidr-deploy-run` | The only tool that starts a platform execution, always behind a typed confirmation. |
| `executions_get_execution` | `voidr-deploy-run` | Lifecycle status of the execution just created. |
| `executions_list_executions` | none | Reserved. No current skill routes to it; listing failed executions for analysis uses `playwright_list_executions`. |

## Playwright analytics (ClickHouse evidence)

Owned exclusively by `voidr-failure-analysis`. These tools read the analytical
store; they never report or change platform lifecycle state.

| Tool | Purpose |
| --- | --- |
| `playwright_list_executions` | Failed executions for user selection. |
| `playwright_get_execution_analytics` | Canonical execution ID, authoritative `applicationId`/`planId`, metrics. |
| `playwright_list_execution_failures` | Recorded failures of the selected execution. |
| `playwright_list_test_results` | Resolve the selected row's module and suite. |
| `playwright_get_test_timeline` | Steps, console, network, stdout, stderr. |
| `playwright_get_trace_events` | Trace-backed step and DOM timeline. |
| `playwright_get_test_history` | Cross-execution recurrence. |
| `playwright_get_test_dom` | DOM snapshot when the failure row reports one. |

## Defects

| Tool | Owner skills | Purpose |
| --- | --- | --- |
| `defects_list_defects` | `voidr-failure-analysis` | Check for an existing non-closed defect before drafting one. |
| `defects_create_defect` | `voidr-failure-analysis` | Create the confirmed defect with the mandatory execution link. |

## Lookalike pairs

| If the need is… | Use | Never |
| --- | --- | --- |
| Why an execution failed, with evidence | `playwright_get_execution_analytics` | `executions_get_execution` |
| Status of an execution just created | `executions_get_execution` | `playwright_get_execution_analytics` |
| Pick a failed execution to analyze | `playwright_list_executions` | `executions_list_executions` |
| Infer the developer's feature | `voidr_workspace_git_context` | `voidr_workspace_inspect`, terminal Git |
| Find checkouts or context repositories | `voidr_workspace_inspect` | terminal `find`/`ls`, `voidr_workspace_git_context` |
| First write of a new plan's structure | `test_plans_populate_test_plan` | `test_plans_create_module`/`suite`/`case` |
| Add to an existing plan | `test_plans_create_module`/`suite`/`case` | `test_plans_populate_test_plan` |
| Change persisted plan content on user request | `test_plans_update_*` | re-creating modules/suites/cases |
| Set up a selected repository | `voidr_workspace_prepare_test_repository` | manual `npm install`/`npx voidr *` |
