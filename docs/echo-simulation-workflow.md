# Echo simulations through an external harness

Connect the host's stdio MCP client to `node /absolute/path/to/scripts/voidr-mcp-bridge.mjs`.
Use the existing Voidr authentication flow and select the intended organization. Do not
paste credentials into prompts. Reload the MCP connection after updating the plugin.
For local development, `VOIDR_MCP_URL` selects the local MCP endpoint and
`VOIDR_SERVICE_ACCOUNTS_PATH` selects a separate credential store.

1. Discover the application, environments, plans, personas and judge profiles with
   `echo_list_applications`, `echo_list_environments`, `echo_list_journey_plans`,
   `echo_list_personas` and `echo_list_judge_profiles`.
2. Reuse a plan or call `echo_journeys_create_plan` with one stable UUID
   `idempotencyKey`. Echo simulation plans do not need a code repository.
3. Call `echo_journeys_create_draft`, then `echo_journeys_update_draft` using its
   current revision. Describe a small journey graph and independent scenarios.
   Keep the customer objective separate from the opening utterance and the judge's
   expected outcomes. Include prohibitions, an explicit success cutoff and an
   explicit failure cutoff in the objective. For example: ask for the listed
   benefit conditions; end once all listed details are delivered; after two
   consecutive technical failures, end without claiming success. The cutoff is
   scenario-specific, not a universal retry policy. Put technical-error stop rules
   in `callerObjective` and the prohibited behavior (for example, do not claim
   success after unresolved errors). Keep `expectedOutcomes`, including terminal
   node outcomes, exclusively for successful business results. Reaching a terminal
   node alone does not mean the goal succeeded. Original scenarios may use `provenance: "ORIGINAL"` without
   invented document references. Document-derived scenarios retain real source codes.
4. Return a review link using the selected platform origin and the actual IDs:
   `/echo/journeys?app=<applicationId>&plan=<testPlanId>&draft=<draftId>`.
   Review validation issues and the scenario matrix. Publish the exact reviewed
   revision with `echo_journeys_publish_draft`. Text-only chat scenarios default to
   `buttonPolicy: "ignore"`; scenarios requiring UI interaction must use `"follow"`
   and an appropriate device transport. Read-only intent alone does not prove
   a UI-dependent scenario can run through an API.
5. For a library-backed journey, call `echo_journeys_get_data`, review its expected
   templates and available field keys, then `echo_journeys_set_data` with the returned
   data IDs, revisions and scenario IDs. Library-backed drafts derive default
   expectation templates from runnable scenarios; account-specific expectations
   remain explicit overrides. Other journeys remain unchanged. These
   operations retain the data library's existing internal-access restrictions.
6. Call `echo_prepare_execution` with the plan, environment, module or exact targets,
   personas and explicit `judgeProfileSelections`. The first profile is official;
   additional profiles compare the same conversations. For the currently supported
   direct chat adapter, set `echoChannel: "chat"`, `chatTransport: "autopilot_api"`
   and select its `production` environment. A connected account must already exist;
   the adapter retains its existing access restrictions. Set `chatApiMaxParallel`
   when a smaller bound is needed. Preparation does not start conversations.
7. Present the returned transport, scenario/persona count, data allocation and judge
   profiles. Execute the approved plan with `echo_create_execution`, its fresh
   `confirmationNonce` and `confirmed: true`. PSTN requires separate explicit
   real-call approval. Do not create a second batch after an uncertain response.
8. Follow `echo_get_execution`, then `echo_list_sessions` with the returned parent
   `executionId`. Read a full transcript using pagination, inspect
   `echo_get_session_evaluation` and compare `echo_list_session_judge_evaluations`.
   Use returned session URLs unchanged. A completed job is not a passing verdict;
   inconclusive indicators require inspection of their evidence and processing state.

If evaluation processing fails, inspect the failure before using
`echo_rejudge_session` with explicit confirmation. `ORIGINAL` retains the frozen
methodology; `CURRENT` uses current configuration. Rejudging preserves prior
attempts and does not rerun the conversation. Follow the new attempt to completion.

The execution service runs simulations; the harness authors and controls them.
Evidence can support accuracy, customer experience and product-quality analysis.
Neither an evaluation score nor a completed batch guarantees absence of hallucinations.
