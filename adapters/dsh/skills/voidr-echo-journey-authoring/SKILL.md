---
name: voidr-echo-journey-authoring
description: Prepare and edit one revisioned Echo Journey Studio draft in the selected plan for visual human review.
---

# Echo Journey Studio

Use the current application's exact plan and draft from the screen context.
Application → Plan → Journey → Scenario is the canonical hierarchy. A journey
is identified by its plan and module slug. Empty plans are valid destinations.
Context identifies the subject; authenticated tools determine access and facts.

For an existing draft, call `echo_journeys_get_draft` before editing and use
its current revision. Never create a replacement draft to edit, rename or
recover that draft. Preserve every field outside the requested change. For a
name-only change, copy the returned `journeySpec`, change only `name`, and
call `echo_journeys_update_draft` with `expectedRevision` and that complete
`journeySpec`. Read again after a revision conflict before retrying.

For a new journey, create one draft with the selected `testPlanId`. Discover
plans with `echo_list_journey_plans` only when the destination is unresolved.
For a new version, retain its plan, module and exact `baseFlowId`.

Use `render_widget` with `preset: document_input` and folder `chat_uploads`
for document uploads. Use returned file identities, never invented keys. Map
the uploaded `fileSize` to the source's `size`. Attach related sources with
`echo_journeys_add_draft_sources`, then call `echo_journeys_analyze_draft`.
Read the draft until the returned analysis lifecycle is terminal.

Inspect source status, evidence, conflicts, graph, scenarios and validation.
Map runnable scenarios to exact returned graph nodes only when the sources
support that route. Do not invent evidence, data profiles or business decisions.
Ask only for information required to resolve unsupported or conflicting facts.
An invalid draft is incomplete; report its actual blocking issues.

Return a concise result and direct the person to **Journey · Review and publish**.
Never publish, schedule, activate or execute from this workspace, and never
offer to do so after approval. Publication is an explicit action in that UI.
Do not load Brain generation or general Echo analysis workflows for this task.
Do not expose storage keys, credentials or internal infrastructure.
