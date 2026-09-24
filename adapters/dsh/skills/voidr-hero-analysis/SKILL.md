---
name: voidr-hero-analysis
description: Inspect Voidr Hero triage and, on explicit request, dispatch or re-run an existing platform defect or issue-tracker ticket through the governed Hero pipeline.
---

# Voidr Hero analysis

Use this skill when the user explicitly asks about Voidr Hero, its triaged tickets,
an issue-tracker ticket's Hero status, why Hero stopped or skipped a ticket, or
which repository likely owns it. This skill is available from any DSH surface;
the current page alone does not make an unrelated request a Hero request.

Work only inside the authenticated organization. Resolve the issue-tracker
connection from the user's wording or from the tool response. If multiple
connections are active and the choice is unclear, ask the user to select one;
never silently take the first. Never ask for or display connector credentials.

## Read-only tool routing

Discover the exact tool name and schema before calling it. A name in this skill
does not prove the tool is available to this organization.

- Triage history or a time window: `mcp__voidr__hero_list_triaged`.
  Filter the returned timestamps to the requested period and say which timestamp
  was used. Its total count is the returned backlog, not automatically the
  count for the requested period.
- One ticket's state, cause of a stop, execution history or pending human action:
  `mcp__voidr__hero_explain_ticket`. Keep the persisted state distinct from the
  live provider check. If the live check failed, label it unavailable instead
  of describing the provider state as current.
- What needs action now: `mcp__voidr__hero_list_actionable`. Its state comes
  from stored snapshots; use `hero_explain_ticket` for a live check of one item.
- Which repository likely owns a ticket: `mcp__voidr__hero_identify_repo`.
  The ranked hits are candidates, not a code-grounded root-cause verdict.

Use only returned ticket identifiers, links, titles, verdicts and evidence.
Never infer that a ticket was analyzed merely because it appears in the issue
tracker. When a read is empty, denied or unavailable, state that limit and stop;
do not reconstruct customer data from a prior turn or another organization.

## Controlled Hero actions

Only dispatch when the current user message explicitly asks to analyze, fix,
re-run or reprocess an existing defect or ticket. An ambiguous request such as
"what about DEF-10?" is read-only: inspect it and answer without dispatching.

- Existing Voidr platform defect: read it first with
  `mcp__voidr__defects_get_defect`, then call
  `mcp__voidr__defects_triage_defect` with the exact id or slug. The same tool
  handles a later re-triage and the runner creates a new branch for that run.
  The pipeline opens a new draft PR only when the code-grounded verdict is safe.
- Existing issue-tracker ticket: call `mcp__voidr__hero_explain_ticket` first.
  For a full reanalysis that may produce a new PR, call
  `mcp__voidr__hero_reprocess_ticket` with `mode: "restart"`, a truthful reason
  from the user's request, and `decidedBy` when the actor is known.
- Retry only the publication phase with `mode: "resume"` and `phase: "open-pr"`
  when the explanation proves that phase was already reached. This is not a
  reanalysis and must not be presented as one.
- Never set `supersedeActive: true` unless the user explicitly asks to replace
  the active run after being told one is already running.

A successful dispatch means the workflow started, not that a PR was created.
After `hero_reprocess_ticket` succeeds and returns a `runId`, discover
`render_widget` and render `HeroRunProgress` with that exact `runId` and the
ticket id. The widget follows the execution and any chained phases; do not
manually poll merely to narrate progress. Never render it if dispatch failed or
no run id was returned. For platform defects, report the returned session id;
this Hero ticket widget does not track defect triage.

Report the returned identifiers and inspect the defect or ticket again before
claiming a verdict or PR. If a run becomes `superseded`, do not repeat the same
dispatch automatically: explain the changed snapshot and investigate it first.
`superseded` does not mean the run never executed; check its phase events and
callbacks before describing what work did or did not happen. A provider revision
change alone does not prove a material edit or identify its cause.

## Remaining execution boundary

Do not call `hero_get_ticket` (it refreshes and writes a snapshot),
`hero_reconcile_tickets`, `hero_dispatch_analyze`, `hero_analyze_tickets` or
`hero_nsflow_resume`. Do not use another tool, shell command, Hive agent or API
endpoint to bypass the exposed tools and their server-side feature flags.
