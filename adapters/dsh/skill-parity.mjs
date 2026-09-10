import { DSH_VALIDATION_DELIVERY } from '../../core/workflow/validation-delivery.mjs'

const VOIDR_MCP_PREFIX = 'mcp__voidr__'
const VOIDR_MCP_FAMILIES = [
  'agent_jobs',
  'applications',
  'assistant_context',
  'assistant_workspace',
  'coverage',
  'defects',
  'echo',
  'executions',
  'failure_analysis',
  'failure_reports',
  'file_embeddings',
  'git_connector',
  'group_diagnosis',
  'issue_tracker',
  'playwright',
  'recording',
  'sessions',
  'system',
  'test_failures',
  'test_plan_generation',
  'test_plans'
]
const DSH_NATIVE_FAMILY_TOOLS = new Set()
const voidrMcpToolPattern = new RegExp(
  `(?<!${VOIDR_MCP_PREFIX})\\b(?:${VOIDR_MCP_FAMILIES.join('|')})_[a-z0-9_]*[a-z0-9]\\b`,
  'g'
)

export function qualifyDshVoidrTools(content) {
  return content.replace(voidrMcpToolPattern, tool =>
    DSH_NATIVE_FAMILY_TOOLS.has(tool) ? tool : `${VOIDR_MCP_PREFIX}${tool}`)
}

const replacements = {
  voidr_context_bootstrap: 'assistant_workspace_prepare',
  voidr_context_refresh: 'assistant_workspace_context_refresh',
  voidr_build: 'assistant_workspace_build',
  voidr_release_deploy_validation: 'assistant_workspace_deploy_validation',
  voidr_create_validation_execution: 'assistant_workspace_run_validation',
  voidr_release_deploy_live: 'assistant_workspace_deploy_latest'
}

function replaceSection(content, start, end, replacement) {
  const from = content.indexOf(start)
  const until = content.indexOf(end, from + start.length)
  if (from < 0 || until < 0) throw new Error(`Canonical skill section changed: ${start}`)
  return content.slice(0, from) + replacement + '\n\n' + content.slice(until)
}

function replaceTail(content, start, replacement) {
  const from = content.indexOf(start)
  if (from < 0) throw new Error(`Canonical skill section changed: ${start}`)
  return content.slice(0, from) + replacement + '\n'
}

export function adaptDshSkill(skill) {
  let content = skill.content
    .replace(/> Host note:[\s\S]*?never a substitute\.\n/, '')
    .replace(/Obey the shared contracts in `\.\.\/CONTRACTS\.md`\./g, 'Obey the DSH host contract below, including evidence provenance and secret handling.')
  if (skill.name === 'voidr-context') {
    content = replaceSection(content, '## 2.', '## 3.', `## 2. One atomic bootstrap

Bind the resolved Test Plan using assistant_workspace_bind_test_plan, then call
assistant_workspace_prepare with sessionId and environmentSlug when selected.
The Service supplies scoped credentials; DSH clones into its session directory and
runs the canonical context bootstrap: platform reads, manifest-context.json,
npm install, link if project.json is absent, scaffold missing cases, and env pull.
Never ask the user to clone into a pod or use their machine's credentials.

- needsEnvironmentSelection: render the returned environments and URLs through
  ask_user_question, then prepare again with the chosen environmentSlug.
- No environments: ask the user to configure one; never invent an environment.
- Repository authorization failure: report the returned cause and ask for access
  to be corrected. Never switch to another organization's credentials.
- Preparation failure: report the named step. Preserve the checkout; do not
  improvise manual link/setup or reset existing edits. Retry after the cause changes.

On every later generation turn, call assistant_workspace_context_refresh before
case selection. It refreshes IDs and session references without reinstalling,
relinking, scaffolding or pulling secrets. A changed environment requires prepare.
`)
  }
  if (skill.name === 'voidr-failure-analysis') {
    content = content.replace(/A routed tool missing[\s\S]*?which tool is unreachable and\nstop\.\n/, '')
    content = replaceSection(content, '## Authentication', '## Resolve the execution', `## Authentication

The Service authenticates every Voidr tool with the organization Service Account assigned to this DSH.
Never run an interactive login, load local credentials, or ask the user for a token. If a remote read is
rejected, report an organization access problem and stop without trying another identity.

Read-only analysis does not require write access. Every defect mutation and tag change requires
canWrite: true and the confirmation required below.`)
    content = replaceSection(content, '## Resolve the execution', '## Resolve the execution URL', `## Resolve the execution

If the user supplied an execution ID, call executions_get_execution with that ID.
Keep its applicationId, planId and environment as authoritative.

If the user did not supply an execution ID:

1. Resolve the application with applications_list_applications.
2. Ask the user when no application is explicit or uniquely matched.
3. Call executions_list_executions with that applicationId, status FAILED and
   createdFrom/createdTo when the user supplied a time range.
4. Show the failed executions and ask the user to select one.
5. Call executions_get_execution for the selected execution.

Do not use tool discovery for this path. If a read fails, report that source as unavailable
and continue only when the remaining persisted evidence identifies the same execution.`)
    content = replaceSection(content, '## Select one failed test', '## Gather evidence', `## Select one failed test

Call every required page of test_failures_list_test_failures with executionId.

- If the user supplied testCaseSlug, select that exact row.
- If no row matches, report that the test is not a recorded failure in this execution and stop.
- If exactly one failure exists, select it automatically.
- If multiple failures exist, show slug, title, status, error summary and file/line; ask the user
  to select one.
- Keep every row visible. When multiple rows carry the same failure signature, say how many cases
  share it and diagnose one representative without opening repeated investigations.`)
    content = replaceSection(content, '## Gather evidence', '## Reach the diagnosis', `## Gather evidence

For the selected testCaseSlug:

1. Call group_diagnosis_get_trace_events once with executionId and testCaseSlugs containing the
   selected slug. It returns the failure, steps, trace, DOM, console, network and frames together.
2. Call failure_analysis_get_context once for persisted diagnostic context and correction hints.
3. Call failure_analysis_get_history once for cross-execution recurrence.
4. Read test_plans_get_test_plan to resolve the exact module, suite and case from the selected slug.
5. Call test_plans_get_case and test_plans_get_tag_history only after that mapping is authoritative.

Reuse those results for the rest of the turn. Never repeat an identical read because one section
was empty. If trace, DOM, console, network or Test Plan context is absent, continue with the
remaining evidence and state the missing source explicitly.

## Visual execution analysis

For one exact execution and test, emit render_widget once with preset execution_analysis_viewer,
a stable id of execution-analysis-{executionId}-{testCaseSlug}, and data containing executionId,
testCaseSlug and optional label/status/environment/applicationName. The widget loads its own frames.
Use the trace and frames returned by group_diagnosis_get_trace_events for the written diagnosis.
If frames are absent, continue without visual claims and name the missing source.

Frame timestamps are sample positions, not state durations. Do not infer duration by subtracting
frames or claim visual evidence that the tool did not return.

## Reach the diagnosis`)
    content = replaceTail(content, '## Tool routing', `## Tool routing

Use only these directly attached DSH tools for failure analysis:

| Need | Tool |
| --- | --- |
| Resolve an application | applications_list_applications |
| List or read executions | executions_list_executions / executions_get_execution |
| List failures in an execution | test_failures_list_test_failures |
| Read trace, steps, DOM, console, network and frames | group_diagnosis_get_trace_events |
| Read persisted diagnostic context | failure_analysis_get_context |
| Read recurrence | failure_analysis_get_history |
| Resolve expected behavior and governance | test_plans_get_test_plan / test_plans_get_case / test_plans_get_tag_history |
| Read or mutate defects after confirmation | defects_list_defects / defects_get_defect / defects_create_defect / defects_create_defect_with_issue / defects_update_defect / defects_update_defect_status / defects_assign_defect |
| Apply a confirmed governance change | test_plans_update_test_case_tag |

Do not search for a Playwright-prefixed substitute. The grouped diagnosis tool is the DSH evidence
contract and already returns the trace sections needed here. Never edit, deploy, run tests or start
a Hive process from this skill.`)
  }
  if (skill.name === 'voidr-generate') {
    content = replaceSection(content, '### Three validation runs, and then stop', '## 7.',
      `### Three validation runs, and then offer delivery\n\n${DSH_VALIDATION_DELIVERY}`)
    content = replaceSection(content, '## 0b.', '## 1.', `## 0b. Validation runs on the platform

The user selected platform execution for this DSH product. Do not offer execution on this machine.
Never install browsers or run Playwright inside the DSH pod. Shell is for Git, dependencies,
static inspection and builds only. Ask for approval before uploading a candidate or starting
an execution. Keep the exact selected environment and targets through the validation loop.`)
    content = replaceSection(content, '## 4.', '## 4d.', `## 4. Remote evidence and authentication

Read existing .selectors.json files before inspecting the product. Recorded actions,
effects and screen maps are evidence, not proof a control remains actionable today.
When authentication or another shared prerequisite is unproven, validate ONE approved
representative case on the platform before implementing the remaining cases. Inspect its
step timeline, DOM and trace to confirm locators are visible, enabled and actionable.
Do not invent cases for exploration or deploy temporary modules/_probe tests. If no approved
case can answer the question, ask the user for a recording or scope decision; do not run
Playwright in the pod. Never claim unexercised authentication was validated.
Preserve credential placeholders and all evidence/provenance requirements below.`)
    content = content.replace(/- `voidr_explore`[^\n]*(?:\n  [^\n]*)*/g,
      '- assistant_workspace_run_validation — approved remote cases only; inspect returned execution evidence, never execute a browser in the pod.')
  }
  if (skill.name === 'voidr-execute') {
    content = replaceSection(content, '4. **Branch on the pilot verdict**:', '6. **Local checkpoint**', `4. **Branch on the pilot verdict**:
   - PASSED: run remaining approved targets together within the agreed scope.
   - FAILED: diagnose; correct and retry only within the three-run budget and repeated-failure limit.
   - Canceled or zero-verdict: record NOT_VALIDATED, never PASSED.
   - Budget exhausted or user stops: follow the delivery contract below in this same turn;
     do not require another execution or wait for a manual deployment request.
5. Read the evidence before offering failed code. Keep execution results distinct from later edits.
`)
    content = replaceSection(content, '6. **Local checkpoint**', '## Writing the confirmation gates', `6. **Code publication**: after a completed test verdict, offer to publish the SAME candidate as the latest code release.
   PASSED is eligible. FAILED is eligible only after diagnosing it and explaining the failure
   to the user. Missing validation is NOT_VALIDATED and needs unvalidatedApproval as defined below.
   Call assistant_workspace_deploy_latest only after explicit user confirmation, carrying
   confirm: true, executionId and failureDiagnosis for a failed run, or the explicit unvalidated approval.
   Do not rebuild a frozen candidate or require a Git push. New edits need their own build, upload and consent.
   This publishes code only: status: promoted and alreadyPublished: true do not mean case tags are LIVE.
   caseTagsChanged: false is expected. An already published version needs no rebuild or repeated upload.
7. **Case promotion** is separate: follow "Promoting a case to LIVE" below. Read current_tag,
   obtain explicit consent for the selected cases, confirm canWrite: true, call
   test_plans_update_test_case_tag, then read back the persisted tags. Refusal leaves tags unchanged.
   If tags are already LIVE, report them without another write. If code publication failed, do not
   proceed to tags. If tag promotion fails, report the affected cases; do not repeat the code deploy.
8. Git publication is separate: ask before assistant_workspace_publish commits and pushes
   to the repository default branch as the final delivery step. Generation remains on the
   isolated local session branch. The tool resolves origin HEAD; never guess main or push
   voidr/assistant/... as the final destination. Report the returned branch and commitSha.
   If the default branch advanced, preserve changes and update and validate before retrying.
   Respect branch protections: never force push or silently fall back to a feature branch.
   Never use the local user's GitHub credentials or start Hive.
   A Git failure does not invalidate a successful code publication or confirmed case tags.
\n${DSH_VALIDATION_DELIVERY}
`)
    content = replaceSection(content, '`voidr_create_validation_execution` (validation) takes', 'Always end the report',
      '`assistant_workspace_run_validation` takes sessionId, environment, codebaseVersion and explicit targets. Use the version and targets returned by assistant_workspace_deploy_validation. The Service supplies applicationId/testPlanId and derives a stable idempotency key; do not fabricate those fields.\n\n')
    content = replaceSection(content, 'Track the execution until a terminal state', '### When to offer cancelling',
      'Track the execution with assistant_workspace_validation_status(sessionId, executionId), at least 30 seconds between polls. Continue until a terminal verdict and report the execution link.\n\n')
    content = replaceSection(content, '- `voidr_release_deploy_live`', '- `voidr_repository_sync_github`',
      '- assistant_workspace_deploy_latest — publishes the exact approved version with its real validation status: PASSED, diagnosed FAILED, or explicitly approved NOT_VALIDATED. No rebuild after consent and no Git side effect.')
    content = content.replace(/- `voidr_repository_sync_github`[\s\S]*?(?=- `executions_get_execution`)/,
      '- assistant_workspace_publish — final commit and push to the repository default branch after explicit user approval; Git delivery is independent of LIVE.\n')
    content = replaceSection(content, '### First group, then diagnose, then edit', '### Waiting longer is not a fix', `### First group, then diagnose, then edit

Call test_failures_list_test_failures once with the completed executionId. Group rows by their
persisted failure signature before reporting or proposing anything:

- cases sharing one signature are one problem. Diagnose one representative and report how many
  cases share it;
- a signature covering every case is a shared precondition;
- distinct signatures are independent problems.

For each representative, call group_diagnosis_get_trace_events once with the executionId and all
relevant testCaseSlugs in one batch. It returns the error, steps, trace, DOM, console, network and
frames. Call failure_analysis_get_context only when persisted correction hints add information.
Reuse these results for the turn; never repeat an identical read because one section was empty.

The error message is the symptom, never the cause. A timeout can mean a slow page, an absent target
or an unactionable target. Name a cause only when the trace or DOM distinguishes them. A green action
is not proof that the application applied its effect.`)
    content = content.replace(/On completion report pass\/fail\/flaky counts \(`playwright_get_execution_analytics`\s*when totals are needed\)/,
      'On completion report the pass/fail/flaky counts returned by assistant_workspace_validation_status')
    content = replaceTail(content, '## Tool routing', `## Tool routing

- assistant_workspace_validation_status — terminal verdict, counts and execution link.
- test_failures_list_test_failures — one paginated failure list for the execution.
- group_diagnosis_get_trace_events — batched trace, steps, DOM, console, network and frames for the
  representative failed slugs.
- failure_analysis_get_context — optional persisted correction hints when they add information.
- test_plans_get_test_plan / test_plans_get_test_counts — verification and governance reads.
- assistant_workspace_build / assistant_workspace_deploy_validation /
  assistant_workspace_run_validation — build, immutable candidate and approved SHADOW execution.
- assistant_workspace_deploy_latest — publish the exact approved candidate.
- assistant_workspace_publish — confirmed Git publication to the repository default branch.
- executions_cancel_execution — only after user confirmation when cancellation is available for the
  authoritative execution environment.
- test_plans_update_test_case_tag — confirmed LIVE promotion followed by read-back.

Do not search for Playwright-prefixed alternatives. An unknown tool is a runtime contract failure:
never retry the same name, never send an identical system_call_tool request, and never turn it into a
discovery loop. Use the direct route above once; if it is unavailable, report the missing evidence
source and continue only when the remaining evidence is sufficient.`)
  }
  for (const [from, to] of Object.entries(replacements)) content = content.replaceAll(from, to)
  content = content.replaceAll('`ask_user`', '`ask_user_question`')
  const authoringRules = `DSH HOST CONTRACT (replaces host-specific commands, never the original evidence or scope requirements):
- The Service-authorized session binding is immutable. Call assistant_workspace_bind_test_plan before checkout.
- Workspace tools take assistantSessionId as sessionId, not a filesystem path or repository URL. prepare/context_refresh take environmentSlug when selected; never fabricate IDs.
- prepare runs the original context bootstrap, link/project validation, scaffold and environment preparation in the DSH session directory. Handle needsEnvironmentSelection using ask_user_question.
- Call assistant_workspace_context_refresh at the beginning of every generation turn, including resumed conversations, then read manifest-context.json. Missing/incomplete setup routes to prepare, not manual CLI setup.
- assistant_workspace_build is build-only. deploy_validation also builds and uploads; it needs upload approval and returns codebaseVersion and exact targets.
- All execution stays on Voidr infrastructure, never Playwright in this pod. Use assistant_workspace_validation_status to read the correct execution environment; never treat the local Service DB as proof of a staging result.
- If any intake choice remains unresolved, the next action must be one ask_user_question call grouping every answerable question. Do not print or enumerate those questions in a normal assistant response. Use ask_user_question for each publication decision; render_widget owns session recording and uploads. Do not require Claude/Copilot hooks or authorization phrases.
- Proactively offer code publication at the validation budget or user stop. Failed but diagnosed tests use confirm: true, executionId and failureDiagnosis. Unvalidated code uses explicit unvalidatedApproval after disclosure, build and upload of that exact code; never borrow another version's execution or invent PASSED. Follow the validation budget and delivery contract in voidr-generate/voidr-execute.
- Publishing code does not promote case tags. After a successful publication, read current_tag for every implemented executable case. FAILED and NOT_VALIDATED cases remain eligible for LIVE; their verdict changes disclosure, not eligibility. If any implemented case is not LIVE, ask automate-promote-live before final delivery and offer all implemented, PASSED only, or no tag changes. Never silently leave failed cases in DEV or call them ineligible. Generic code publication consent does not cover LIVE. With explicit consent and canWrite: true, use test_plans_update_test_case_tag only for the selected cases and read back the persisted tags. alreadyPublished: true confirms code only; never repeat its upload to fix a tag failure.
- After latest publication contains at least one automated test, deploy_latest changes a DRAFT Test Plan to ACTIVE automatically, including alreadyPublished recovery. Report planStatus and planStatusChanged from the tool. Do not activate on build, validation upload or SHADOW. Preserve ARCHIVED plans; plan activation is not LIVE promotion or a passing verdict. If activation fails, report partial publication and retry the same approved version without another upload.
- Every platform fact must come from a read tool or a context refresh in this turn, never folder names, memory or a manifest left from an earlier conversation. Preserve approved AAA, scope and evidence provenance.
- An unknown tool is a runtime contract failure. Never retry the same name or repeat an identical tool call in the same turn. Use the documented direct fallback once; otherwise report the missing capability and stop that branch without a discovery loop.
- Explicit composer instructions and custom question answers define the user's intended contract. The question tool controls how DSH asks; it does not invalidate an answer already supplied in chat. The latest explicit correction wins for the facts it addresses. Runtime evidence defines what happened; when it conflicts with the intended contract, report the exact mismatch and inspect the candidate or environment instead of rewriting the directive or retrying blindly.
- Use only credentials passed by the Service to child processes, never local credential stores, and never print or read .env values.
- Do not call legacy Hive automation. DSH owns code and its session directory.
`
  const failureAnalysisRules = `DSH HOST CONTRACT (replaces host-specific commands, never the original evidence requirements):
- The Service supplies the organization Service Account. Never run interactive login or request credentials from the user.
- Treat Monitor and Home context as lookup hints. Validate execution, application, Test Plan and case with Voidr read tools in this turn.
- For one exact execution and test, show execution_analysis_viewer once while analyzing the grouped trace evidence; the widget loads its own frames.
- This skill diagnoses only. Do not bind a workspace, edit files, deploy, run tests, or trigger self-healing while it is active.
- If the user explicitly asks to correct the test, finish the diagnosis and load voidr-automate, voidr-generate and voidr-execute before binding or editing.
- Correction validation runs only on Voidr infrastructure through assistant_workspace tools, after the confirmations owned by the authoring skills. Never run Playwright in the DSH pod.
- Defect and tag mutations remain available only behind their own explicit confirmation and canWrite: true read-back rules below.
- Use ask_user_question for unresolved choices. Never rely on host-specific hooks, slash commands or authorization phrases.
- Every platform fact must come from a read tool in this turn. Never treat a UI hint, previous assistant message or local file as authoritative.
- An unknown tool is a runtime contract failure. Never retry the same name or repeat an identical tool call in the same turn. Use the documented direct fallback once; otherwise report the missing capability and stop that branch without a discovery loop.
- Explicit composer instructions and custom question answers define the user's intended contract. The question tool controls how DSH asks; it does not invalidate an answer already supplied in chat. Runtime evidence defines what happened; when it conflicts with the intended contract, report the exact mismatch instead of rewriting the directive. The latest explicit correction wins for the facts it addresses.
- Never call legacy Hive automation or start a Hive process.
`
  const rules = skill.name === 'voidr-failure-analysis' ? failureAnalysisRules : authoringRules
  return { ...skill, content: qualifyDshVoidrTools(`${rules}\n\n${content}`), provider: 'voidr-plugin' }
}
