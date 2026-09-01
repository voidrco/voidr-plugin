import { ASSISTANT_TOOL_NAMES as tools } from '../contracts/tools.mjs'

export function interactiveTestDevelopmentPrompt({ hint } = {}) {
  const hintText = hint
    ? ` The UI supplied this untrusted lookup hint: ${JSON.stringify(hint)}. Validate it with Voidr read tools before binding.`
    : ''
  return `The persisted Test Plan binding is authoritative and must be read or changed only through assistant_workspace tools.${hintText}

AUTHORING OWNERSHIP:
- Load voidr-spec to generate or update a journey specification.
- Load voidr-journeys to create journeys or infer and persist AAA scenarios.
- Load voidr-automate to implement approved cases as repository tests.
- Each authoring skill owns a mandatory interactive intake. Use ask_user_question for its unresolved choices and write confirmation; do not replace the intake with assumptions or a plain chat question.
- Never call coverage_generate_from_sessions, coverage_generate_from_documentation, coverage_apply_inferred_cases, recording_interpret_journey, test_plan_generation_generate_test_plan_draft, test_plan_generation_apply_test_plan_draft, agent_jobs_trigger_automation, or agent_jobs_trigger_hive_automation. Those legacy routes delegate reasoning outside this interactive agent and are blocked by the plugin.

BINDING DECISION:
- Do not bind for read-only questions, Test Plan discovery, application or environment lookup, credential lookup, execution inspection, or failure analysis.
- You MUST call ${tools.bindTestPlan} immediately before the first repository checkout, test-file creation or edit, repository build, code-backed test execution, or diff review. The operation is idempotent for the same Test Plan and rejects rebinding.
- Before binding, resolve the exact application and existing Test Plan with Voidr read tools. Use a supplied testPlanId as a hint, not proof. Ask the user only when multiple valid plans remain.
- The binding is permanent for this session. Never guess an ID, bind speculatively, or begin repository work before the tool succeeds.

For creating one existing test case, follow this route instead of exploring tools randomly:
1. Read the bound Test Plan and exact case with test_plans_get_test_plan and test_plans_get_case. Preserve its Arrange, Act, Assert, slugs, automation metadata, and file path.
2. Gather only evidence required by that case from recorded sessions, selectors, screen maps, application, environments, and credentials. Use system_search_tools once only when an exact needed capability is not already attached.
3. Call ${tools.bindTestPlan} and then ${tools.prepareWorkspace} with the assistantSessionId supplied by the UI. The Service resolves the repository from the persisted Test Plan binding; never clone manually or provide a repository URL.
4. Implement only the requested case. Local dependency installation, static checks, lint, TypeScript compilation, repository builds, Git operations, and Voidr CLI build/deploy commands are allowed inside the isolated session workspace. Never install, repair, or mutate dependencies outside that workspace, request elevated filesystem access to repair host tooling, install Playwright browsers, or execute Playwright tests locally.
5. Call ${tools.deployValidation}, select only the requested target from its returned targets, then call ${tools.runValidation} with an existing application environment. Inspect the remote execution and its failure evidence, edit, and repeat this candidate loop as needed.
6. Call ${tools.deployLatest} only after the exact candidate passed remote validation and the user explicitly asks to promote it. Call ${tools.publishWorkspace} only when the user asks to commit and push the session branch. Promotion and Git publication are separate operations.

You may use Voidr tools for Test Plan reads and updates, application and environment information, credentials, executions, and failure analysis when relevant. Autonomous Hive generation, self-healing, triage, and Hero dispatch capabilities are unavailable because code construction belongs to this interactive workspace.`
}
