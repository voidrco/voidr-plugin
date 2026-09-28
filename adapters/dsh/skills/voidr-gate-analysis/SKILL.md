---
name: voidr-gate-analysis
description: Analyze Voidr Gate PR verdicts, business rules, journeys, evidence and governance through authenticated Gate tools; use on the Gate surface or for explicit Gate questions elsewhere.
---

# Voidr Gate analysis

Gate evaluates how a proposed code change affects declared business behavior. The Gate screen identifies a likely application, journey or PR analysis; its labels and summaries are navigation hints, not proof. The authenticated `mcp__voidr__voidr_gate_*` tools are the evidence source. Never query Mongo directly to answer the user or borrow another organization's data.

## Resolve the request

- Read `gateContext` from the current runtime hint when available. `analysisId` identifies one stored PR evaluation; `prNumber` alone may be ambiguous across repositories. `journeyId` needs its `applicationId`.
- Outside an embedded Gate screen, or when identities are ambiguous, call `mcp__voidr__voidr_gate_get_ontology` and resolve the scope with the relevant list tool. Ask a concise question only when the tools cannot distinguish the user's target.
- A request for a current PR state is different from its stored Gate verdict. The Gate result proves what Voidr evaluated at that time, not whether the provider currently blocks merging or whether a PR remains open.

## Tool strategy

| User asks | Read first | Go deeper when needed |
| --- | --- | --- |
| Which PRs are blocked or threaten a rule? | `mcp__voidr__voidr_gate_list_pr_analyses` | Paginate; use each returned verdict's **action**, not bucket alone, for a blocked count. Say whether this is a Gate verdict or verified live provider state. |
| What happened in PR N? What exactly changes? | `mcp__voidr__voidr_gate_get_pr_analysis` | Use `narratedOutcomes` and `contractBreaks` for before/after; `mcp__voidr__voidr_gate_trace_impact` for dependent rules and journeys. |
| Why did this decision block? Who approved or overrode it? | `mcp__voidr__voidr_gate_get_governance` with the analysis ID | Use `mcp__voidr__voidr_gate_get_evidence` for a cited rule and `mcp__voidr__voidr_gate_get_pipeline_status` when the result may be stale. |
| Which business rule or journey is affected? | `mcp__voidr__voidr_gate_explain_rule` or `mcp__voidr__voidr_gate_explain_journey` | `mcp__voidr__voidr_gate_trace_impact` for transitive impact; `mcp__voidr__voidr_gate_find_rules_for_file` or `mcp__voidr__voidr_gate_semantic_search_rules` to find a rule. |
| What is the PR link? | `mcp__voidr__voidr_gate_get_pr_analysis` | Return only a provider URL explicitly present in tool evidence. If absent, say the stored evaluation does not provide a verified link. |

Pagination and freshness matter. Never say "all" after only the first page, treat a failed read as an empty result, or combine repeated analyses of the same PR as distinct PRs without explaining the unit counted. If the pipeline is still processing, state that the verdict may change.

## Creation and decisions

A user asking to create a journey is requesting a different workflow, not proof that a Gate analysis exists. Resolve the application and organization-wide repositories with `mcp__voidr__voidr_gate_list_repositories` and, when scope may cross repositories, `mcp__voidr__voidr_gate_list_connected_repositories`. Ask for the business-flow name and description and let the user choose the repository when ambiguous. Do not infer it from the current PR, invent rules or repository IDs, or present unverified code claims as investigated facts.

For a manually described journey with a real application ID, title and repository IDs, call the native `render_widget` tool directly with one interactive `JourneyProposalConfirm` component:

```json
{"id":"gate-journey-proposal","interactive":true,"spec":{"root":"proposal","elements":{"proposal":{"type":"JourneyProposalConfirm","props":{"applicationId":"<verified app id>","title":"<user-provided name>","descriptionPt":"<user-provided description>","scopeRepoIds":["<verified repository id>"]}}}}}
```

Use the actual values, never the placeholders. Stop and wait for the card's `declare_journey` submission. Only then call `mcp__voidr__voidr_gate_create_journey` with exactly the submitted `applicationId`, `name`, `descriptionPt`, `priority` and `scopeRepos`, plus `confirmed: true`. Do not reconstruct the selection from memory. If creation succeeds and returns a journey ID, render `MatchJobProgress` with that journey ID and application ID; the matcher is asynchronous, so creation does not prove rules have matched. Native `render_widget` is not an MCP tool: never pass it through `system_run_script` or `system_call_tool`. If the native widget is unavailable, do not bypass the confirmation card by calling `create_journey`.

Code- or session-grounded drafting is a separate investigation workflow. Do not pretend the manual proposal performed it; offer to gather evidence only through tools actually available in this session and distinguish a partial/unverified draft from a verified one. Approval or rejection of a PR analysis likewise requires an explicit instruction tied to the exact analysis ID; read governance first and use only the authorized Gate decision tool. Never infer consent from opening a screen or asking "why?".

For every answer, separate observed rule evidence, Gate's interpretation, and any recommendation. Link the source PR or Gate screen only when a tool supplies a verified URL or a known current application/analysis ID permits a valid Platform route. If the tool is unavailable or access-denied, stop that path and report the limitation; do not substitute remembered customer facts.
