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
| `applications_list_applications` | `voidr-develop-tests`, `voidr-test-plan`, `voidr-feature-test`, `voidr-failure-analysis` | Build application choices exclusively from the platform. |
| `applications_get_application` | `voidr-develop-tests`, `voidr-test-plan` | Fallback only when the list response omits `type` for the selected ID. |
| `applications_list_environments` | `voidr-develop-tests`, `voidr-test-plan`, `voidr-feature-test` | Environment choices for the selected application. |

## Test Plans

| Tool | Owner skills | Purpose |
| --- | --- | --- |
| `test_plans_list_test_plans` | `voidr-develop-tests`, `voidr-test-plan`, `voidr-feature-test` | User selection of an existing plan. Never an error fallback. |
| `test_plans_get_test_plan` | `voidr-test-plan`, `voidr-implement-tests`, `voidr-deploy-run`, `voidr-feature-test` | Read one explicitly selected plan; verify persisted content and real slugs. |
| `test_plans_get_test_counts` | `voidr-deploy-run` | Post-deploy synchronization verification only. |
| `test_plans_create_test_plan` | `voidr-test-plan`, `voidr-feature-test` | First mutation of an approved new plan; must return the linked `repository`. |
| `test_plans_populate_test_plan` | `voidr-test-plan`, `voidr-feature-test` | Bulk write immediately after a complete creation response, same approved flow. |
| `test_plans_create_module` / `test_plans_create_suite` / `test_plans_create_case` | `voidr-test-plan`, `voidr-feature-test` | Incremental additions to an already-persisted plan. |
| `test_plans_update_test_plan` / `test_plans_update_module` / `test_plans_update_suite` / `test_plans_update_case` | `voidr-test-plan` | Edits explicitly requested by the user on persisted entities. Never error repair. |
| `test_plans_get_case` | `voidr-failure-analysis` | Expected behavior of one case; read-back after a tag change. |
| `test_plans_get_tag_history` | `voidr-failure-analysis` | Governance tag history. |
| `test_plans_update_test_case_tag` | `voidr-failure-analysis` | Confirmed governance tag change only. |

## Workspace and repository

| Tool | Owner skills | Purpose |
| --- | --- | --- |
| `voidr_workspace_inspect` | `voidr-develop-tests`, `voidr-test-plan` | List workspace checkouts: origin matching and read-only context candidates. |
| `voidr_workspace_git_context` | `voidr-feature-test` | Branch/diff feature inference for the developer-first flow only. Returns the changed hunks so scenarios stay scoped to the change, and reports `repositoriesNotInspected` when the workspace holds more repositories than one call covers (re-call with `repositoryPath`). |
| `voidr_workspace_bootstrap_test_repository` | `voidr-develop-tests` | Initialize the test-project skeleton in a confirmed empty destination, or in an origin-matching checkout that lacks test-project files. Never clones — cloning belongs to `voidr_workspace_prepare_test_repository`. Detects an existing checkout by origin and returns `reusedExistingCheckout`. |
| `voidr_workspace_select_test_repository` | `voidr-develop-tests` | Register a user-selected existing repository when the plan has no linked repository. |
| `voidr_workspace_prepare_test_repository` | `voidr-develop-tests`, `voidr-implement-tests`, `voidr-feature-test` | The single mandatory setup gate: install, CLI auth, link, scaffold, env pull. |
| `voidr_workspace_scaffold_test_cases` | `voidr-implement-tests` | Scaffold a case added after the preparation gate completed. |
| `voidr_smoke_build` | `voidr-implement-tests`, `voidr-feature-test` | Local validation and authenticated build, outside the agent shell. |
| `voidr_workspace_publish_tests` | `voidr-feature-test` | Branch, commit, and pull request through user credentials. |

## Release and executions

| Tool | Owner skills | Purpose |
| --- | --- | --- |
| `voidr_release_inspect` | `voidr-deploy-run`, `voidr-feature-test` | Rediscover repository, plan, and merged PR from the checkout. Never ask the user for these IDs. |
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

## Support documentation

| Tool | Owner skills | Purpose |
| --- | --- | --- |
| `file_embeddings_search_documents` | `voidr-develop-tests`, `voidr-test-plan`, `voidr-feature-test`, `voidr-implement-tests` | Read-only, never-blocking assimilation of indexed application documents. Planning uses up to three feature-scoped perspectives: actors/preconditions/user flow; rules/states/outcomes; errors/alternatives/fallbacks. Implementation may also retrieve selectors and QA guidance, plus at most one refined follow-up query per selected case whose flows, rules, or automation guidance the shared baseline does not cover. Every call is scoped by `applicationId` with `limit: 5`, `minScore: 0.5`, and `includeContent: true`; consumers read `results[].chunks[].contentPreview`, deduplicate by `fileId` + `chunkIndex`, and preserve file/page provenance. User manuals, product/operations guides, business rules, walkthroughs, and QA docs are valid; marketing, contracts, meetings, and unrelated content are rejected. Product code and observed runtime behavior are authoritative; documentation is supporting evidence that may be stale. Conflicts follow code/runtime and are reported as documentation drift. Empty results and errors continue without blocking. |

The indexing and deletion counterparts of this family are deliberately not
exposed by the bridge, and the platform's knowledge tools for customer
conversations are a different base — application support documents come only
from this search tool. Never fall back to `knowledge_*` for missing application
documentation.

## Defects and issue trackers

Owned exclusively by `voidr-failure-analysis`. Every write happens behind its
own confirmation and is verified with a `defects_get_defect` read-back.

| Tool | Owner skills | Purpose |
| --- | --- | --- |
| `defects_list_defects` | `voidr-failure-analysis` | Check for an existing defect before drafting one (`testCaseId`, sorted by `updatedAt`). |
| `defects_get_defect` | `voidr-failure-analysis` | Load one defect in full before showing or mutating it; verify every persisted mutation. |
| `issue_tracker_list` | `voidr-failure-analysis` | List active issue trackers before a linked creation. |
| `issue_tracker_list_projects` | `voidr-failure-analysis` | List the selected tracker's projects by `connectorContextId`. |
| `defects_create_defect` | `voidr-failure-analysis` | Create the confirmed plain Voidr defect (no tracker selected) with the mandatory execution link. |
| `defects_create_defect_with_issue` | `voidr-failure-analysis` | Create the confirmed defect linked to the explicitly selected tracker project. |
| `defects_update_defect` | `voidr-failure-analysis` | Edit confirmed content only: title, severity, priority, description, fix version, target date. Never status or assignee. |
| `defects_update_defect_status` | `voidr-failure-analysis` | Apply the confirmed status transition (`assignee` for `in_progress`, `fixVersion` for `resolved`, `reopened` to reopen). |
| `defects_assign_defect` | `voidr-failure-analysis` | Apply the confirmed assignee change (`@me` only for the user themselves; never invent a user ID). |

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
| Change a defect's status or assignee | `defects_update_defect_status` / `defects_assign_defect` | `defects_update_defect` |
| Mutate a defect found in a listing | `defects_get_defect` first, then the write tool | mutating from the list summary |
| Create a defect linked to a tracker | `defects_create_defect_with_issue` after tracker/project selection | `defects_create_defect` with an invented link |
