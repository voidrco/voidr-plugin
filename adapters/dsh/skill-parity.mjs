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
  if (skill.name === 'voidr-generate') {
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
    content = replaceSection(content, '6. **Local checkpoint**', '## Writing the confirmation gates', `6. **Delivery decisions**: after a completed test verdict, offer the SAME candidate for LIVE.
   PASSED is eligible. FAILED is eligible only after diagnosing it and explaining the failure
   to the user. Cancellation, timeout without test verdict, or no executed tests is not eligible.
   Call assistant_workspace_deploy_latest only after explicit user confirmation, carrying
   confirm: true, executionId and failureDiagnosis for a failed run. Do not rebuild or require a Git push.
7. Git publication is separate: ask before assistant_workspace_publish commits and pushes
   the session branch. Never use the local user's GitHub credentials or start Hive.
   A Git failure does not invalidate a successful LIVE deployment.
`)
    content = replaceSection(content, '`voidr_create_validation_execution` (validation) takes', 'Always end the report',
      '`assistant_workspace_run_validation` takes sessionId, environment, codebaseVersion and explicit targets. Use the version and targets returned by assistant_workspace_deploy_validation. The Service supplies applicationId/testPlanId and derives a stable idempotency key; do not fabricate those fields.\n\n')
    content = replaceSection(content, 'Track the execution until a terminal state', '### When to offer cancelling',
      'Track the execution with assistant_workspace_validation_status(sessionId, executionId), at least 30 seconds between polls. Continue until a terminal verdict and report the execution link.\n\n')
    content = content.replace(/- `voidr_repository_sync_github`[\s\S]*?(?=- `executions_get_execution`)/,
      '- assistant_workspace_publish — commits and pushes only the session branch after explicit user approval; Git delivery is independent of LIVE.\n')
  }
  for (const [from, to] of Object.entries(replacements)) content = content.replaceAll(from, to)
  content = content.replaceAll('`ask_user`', '`ask_user_question`')
  const rules = `DSH HOST CONTRACT (replaces host-specific commands, never the original evidence or scope requirements):
- The Service-authorized session binding is immutable. Call assistant_workspace_bind_test_plan before checkout.
- Workspace tools take assistantSessionId as sessionId, not a filesystem path or repository URL. prepare/context_refresh take environmentSlug when selected; never fabricate IDs.
- prepare runs the original context bootstrap, link/project validation, scaffold and environment preparation in the DSH session directory. Handle needsEnvironmentSelection using ask_user_question.
- Call assistant_workspace_context_refresh at the beginning of every generation turn, including resumed conversations, then read manifest-context.json. Missing/incomplete setup routes to prepare, not manual CLI setup.
- assistant_workspace_build is build-only. deploy_validation also builds and uploads; it needs upload approval and returns codebaseVersion and exact targets.
- All execution stays on Voidr infrastructure, never Playwright in this pod. Use assistant_workspace_validation_status to read the correct execution environment; never treat the local Service DB as proof of a staging result.
- Ask with ask_user_question for unresolved choices and each publication decision; render_widget owns session recording and uploads. Do not require Claude/Copilot hooks or authorization phrases.
- Failed but diagnosed test verdicts may be offered for LIVE after explicit approval. Pass confirm: true, executionId and failureDiagnosis when promoting. No test verdict means no promotion. Never publish a different rebuilt version.
- Every platform fact must come from a read tool or a context refresh in this turn, never folder names, memory or a manifest left from an earlier conversation. Preserve approved AAA, scope and evidence provenance.
- Use only credentials passed by the Service to child processes, never local credential stores, and never print or read .env values.
- Do not call legacy Hive automation. DSH owns code and its session directory.
`
  return { ...skill, content: `${rules}\n\n${content}`, provider: 'voidr-plugin' }
}
