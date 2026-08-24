# E2E validation strategy

## Layers

1. **Static contract**
   Validates the plugin manifest, MCP allowlist, skill frontmatter, required
   questions, and the absence of forbidden tools from skill instructions.

2. **Policy hook**
   Replays real `preToolUse` payload shapes. It must deny direct, qualified,
   nested, and shell-based Hive dispatch attempts while falling through for
   safe calls.

3. **MCP bridge**
   Runs the stdio server against mock token and MCP endpoints. It proves that
   credentials remain local, tool discovery is filtered, write scopes are
   enforced, and forbidden calls never reach the server.

4. **Conversation workflow**
   Replays deterministic user/agent events for:

   - natural-language entry from a workspace with many repositories;
   - new Test Plan;
   - existing Test Plan;
   - `project.json` mismatch;
   - best-effort Git delivery, independent of LIVE promotion;
   - immutable candidate promotion plus exact `latest` read-back;
   - deploy plus independent sync verification;
   - adversarial request to use Hive.

5. **Copilot CLI smoke test**
   Installs the plugin into an isolated `COPILOT_HOME`, lists it, and inspects
   its skills and MCP server. A live model turn is optional because it requires
   a GitHub Copilot entitlement and credentials. The deterministic layers
   remain mandatory in CI.

## Acceptance criteria

- “Quero desenvolver testes na Voidr” causes the new/existing question before
  any tool call.
- A `project.json` found anywhere cannot select a plan or repository.
- No write occurs outside the explicitly selected test repository.
- A new plan is persisted only after the user approves the visible draft.
- An existing plan is resolved from platform data, not from local inference.
- Deployment and execution each require a separate confirmation.
- Deploy is blocked unless the exact immutable candidate produced a PASSED or
  diagnosed FAILED platform-validation verdict. Git delivery is attempted but
  its failure does not block LIVE.
- Legacy mutable `deploy-latest` shell paths are denied.
- Deployment cannot complete unless `latest.codebaseVersion` equals the
  promoted immutable candidate.
- Execution is not created when automation sync cannot be verified.
- Every Hive-starting tool is absent from MCP discovery and denied by the
  hook if invoked by another route.
- Secrets are absent from tool results, stdout, fixtures, and repository
  files.
