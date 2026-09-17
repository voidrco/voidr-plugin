# Echo tool routing

Use the smallest set of reads that answers the request. Independent reads may
run in parallel. Never call broad lists after a specific id has already resolved
the subject. Read the discovered input schema before constructing arguments:
nested enums, bounds, defaults and required fields come from the Service validator.
Cross-field rules and authorization still run on the server. Do not reuse cached
legacy schemas, invent parameters, or assume a described capability is deployed.

<discovery>
Read `echo_get_ontology` once before interpreting Echo data only when the tool
is advertised; otherwise use the bundled ontology reference. External hosts that
only expose tools can use it without resource support. If unavailable during a
staged rollout, use `voidr-echo://ontology` when supported and retain explicit
uncertainty about newer capabilities; never bypass an access denial.
</discovery>

## Overview and inventory

- Calendar-day analysis: `echo_resolve_analysis_window` returns server-clock UTC
  boundaries and local labels. Copy them unchanged into all supporting occurrence
  reads. Last N days includes today; explicit hours remain rolling. Sessions
  `echoContext.window` must be preserved, including `all`; absence alone permits
  the declared seven-calendar-day default. Never call that default screen-selected.
- Organization/app inventory: `echo_list_applications`.
- Persisted KPI window and comparison: `echo_get_overview`. Use its
  explicit `window` from the resolved user period / latest `echoContext.window`;
  never omit a selected `14d` and accept the default `7d`. Check the returned
  `summary.window` and `summary.since` before interpreting the numbers. These
  legacy KPI windows are rolling, not calendar days; use occurrence-based tools
  for calendar-day reports instead of combining unequal periods. Use its
  `summary.judgeConfiguration` for current pass thresholds. The sibling
  `summary.score.passThreshold` is frozen historical evaluation data and must
  never be described as the current configuration.
- Criteria with no approvals: copy `summary.rubricSummary.zeroPass.count` and
  `zeroPass.ids` from `echo_get_overview`. Any positive approval count belongs to
  `withPass`, not zero; `noConclusiveEvaluation` is not failure. Missing/unavailable
  summaries do not authorize invented totals. Do not define an implicit low-pass
  threshold or reuse counts from another window.
- Projection freshness/coverage only when the user asks about data freshness or
  large-scale analytics availability: `echo_get_analytics_status`.
- Aggregate, trend, comparison, latency, silence, criterion or deviation-cohort
  questions: `echo_analyze_session_cohort` with the narrowest exact half-open
  occurrence interval and useful breakdown. Never download session pages to
  reconstruct a cohort in the model. Separate aggregate totals are marginal:
  they show how often each fact occurred, not whether the same sessions contain
  both facts. Do not claim causation or a reaction between them without explicit
  same-session evidence. One session can illustrate order only for that session.
  When offering multiple evidence drill-downs, use `ask_user_question` with
  concrete tool-supported options rather than a prose question.

## Official session references

Use the returned `sessionUrl` unchanged for session links. If absent, read
`echo_get_session` to obtain it. Never invent a domain or route. A missing code
does not prove why or when assignment did not occur.

Accept the user's full sessionCode or technical ObjectId with the current
organization context. Resolve it using the official session read tool and retain
its returned sessionId. Use the returned code as the display label; never build
codes from a case slug or append a guessed number. Never display or copy a
technical session ID in prose, tables or widgets; keep it only in URLs and
internal tool arguments. A missing code uses a neutral session label, occurrence
date and link. A failed lookup does not authorize
trying another tenant. Do not pass codes to judge-run, execution, manual-chat,
playground or Hive session parameters.

## Journeys and executions

- Ad-hoc one-shot validation from an intent/persona prompt: read `one-shot.md`;
  use `echo_plan_validation`, `echo_prepare_validation`,
  `echo_execute_validation`, `echo_get_validation`. These create canonical
  resources when approved; do not route to notebook import or playground.

- Journey inventory: `echo_list_journeys`; exact Journey: `echo_get_journey`.
  It includes at most the first 100 flow versions and `flowPagination`; use
  `echo_list_journey_flows` with the same plan/module and explicit pages for
  more versions. A first page is not an exhaustive version history.
- Exact flow version: `echo_get_journey_flow`. Check publicationStatus:
  PUBLISHED versions are immutable; legacy flows do not imply a Studio publication. Use
  `echo_preview_journey_flow_data` only when the user asks what generated/fixed
  data would be resolved now; label it as a fresh preview, not execution evidence.
- Journey Studio lifecycle: `echo_list_journey_drafts` / `echo_get_journey_draft`.
- Execution inventory/detail: `echo_list_executions` / `echo_get_execution`.
- Cross-execution result comparison: `echo_get_execution_evaluations` with at
  most 25 exact execution ids.
- New execution: follow the prepare/confirm/create state machine in SKILL.md.
- Cancel: fetch exact execution, summarize its current status/effect, obtain a
  separate confirmation turn, then `echo_cancel_execution`.

## Sessions, evaluations and deviations

- Find a session by an exact id first when supplied. Otherwise use
  `echo_list_sessions` with application/environment/date filters and `search`
  for persona names or session metadata; `transcriptQuery` searches only
  evaluated-assistant (`agent`) turns. For tester/IVR evidence, resolve the
  session and use the paginated transcript tool with the appropriate role.
  Preserve the actual returned `sessionId` in the answer. Resolve `personaId`
  with `echo_get_persona` when a name is needed; do not infer labels from ids.
  Respect `page`, `pages` and `total`; an empty filtered page is not evidence
  that the organization has no sessions.
- Short evaluation explanations: use `judgeSummary`, `judgeSummarySource` and
  `judgeCompletedAt` from the session list or `sessionSummary` in
  `echo_get_session_evaluation`. For legacy servers without those fields, read
  the exact session's persisted aggregate/behavioral summary. Never regenerate
  a summary from an assumed score.
- Session inventory/detail: `echo_list_sessions` / `echo_get_session`. For a
  long conversation, use `echo_get_session_transcript` with the smallest role,
  text and page filters that answer the question instead of loading the full
  session repeatedly.
- Use `echo_analyze_session_cohort` for any multi-session calculation. Its
  criterion rows include only each session's current official judge run; its
  latency values summarize persisted per-session measurements. Its `top` argument
  limits returned ranking rows, including `officialCriteria`; it does not limit the
  sessions included in the aggregate and cannot prove absence of an omitted control.
- Use `echo_get_session_evaluation` for one session's score, verdict, judge
  status or re-evaluation history. Fetch `echo_get_judge_run` only when the user
  needs the evidence/details of one exact attempt.
- Regulatory or hallucination cohort questions: `echo_analyze_session_cohort`
  supports `regulatoryOverall` and `hallucinationStatus` as filters/breakdowns.
  These do not replace the official `judgeOverall` or session lifecycle.
- Complete lists of violated regulatory controls: call native
  `echo_render_regulatory_controls` with the selected application and frozen
  interval. It calls `echo_summarize_regulatory_controls`, reads all returned
  pages and publishes a Table widget from the Service rows. Do not copy or
  renumber the rows in assistant prose. For counts alone or exact linked samples,
  use `echo_summarize_regulatory_controls` directly with selected application,
  required `scope: {type: "journey", moduleSlug}` for a
  selected Journey, or `scope: {type: "application"}` when none is selected.
  Preserve environment and exact half-open occurrence boundaries. The Service
  rejects a wider/different scope than the signed screen context, even through
  helper tools. To widen, ask the user to remove the Journey filter and send a
  new message; do not retry through another tool. Follow its pagination and explicit
  coverage. This is the source for per-control outcomes and critical counts;
  neither `regulatoryOverall` nor parsing `judgeSummary` can replace it. No
  subagent delegation, session-by-session scan or custom aggregation script.
  Any definitive claim of zero, some or a specific number of regulatory
  transgressions requires this read, even inside a general cohort answer. For a
  general non-regulatory request, answer first and optionally use
  `ask_user_question` to offer this deeper analysis. If accepted, preserve the
  frozen interval and scope and continue immediately; if declined, stop.
  Use each returned control's `evidenceSamples` for exact non-compliant examples
  and `criticalEvidenceSamples` for exact critical examples. Those samples bind
  the session, control outcome, rationale and transcript citations. General
  deviation/session lists and taxonomy rows cannot establish this binding. For
  deeper evidence, follow the sample's exact judge run through
  `echo_get_judge_run` and `echo_read_evidence`; do not choose a substitute
  session by recency, severity or lifecycle status.
  Regulatory output must carry the returned `asOf` and consistency. Only call
  the observed control list complete after the native renderer confirms every
  page. Distinguish complete control-row pagination from incomplete evaluation
  coverage. Zero-valued counts must not be described as unavailable. Derive superlatives only from the matching
  numeric column across all rows and preserve ties. Samples support examples,
  not a population-level cause; a disclaimer cannot cancel an earlier causal
  assertion. Copy regulatory rows atomically: `stableId`, title,
  `nonCompliantSessions` and `criticalNonCompliantSessions` must remain attached
  to the same row. When the runtime returns a `criticalControls` contract, list
  every row in it before characterizing the critical set and reconcile its sum
  with `returnedCriticalOccurrences`. Never substitute a nearby control's count.
- Deviation inventory/detail: `echo_list_deviations` / `echo_get_deviation`.
- Deviation search supports `environment`, `transcriptQuery` and `sort`.
  CSV/XLSX export exists in the Echo deviations ledger, through its export
  control and filters. Direct the user there when they request a file; do not
  claim export is absent because general assistant tools do not return files.
- Heatmap/period comparison: `echo_get_deviation_summary`; filter counts:
  `echo_get_deviation_facets`; definitions: `echo_get_deviation_taxonomy`.
  Pass the same resolved `window` to window-based reads and equivalent occurrence
  boundaries to supporting lists that accept date filters. Taxonomy definitions
  and unfiltered inventory are not evidence of counts inside the selected period.
- `echo_get_regulatory_status` is static knowledge readiness. For compliance
  in a specific conversation, read the session evaluation and regulatory subrun.
  A paused knowledge subrun is distinct from regulatory inconclusiveness.
- Rejudge: fetch evaluation, explain CURRENT versus ORIGINAL, confirm, then
  `echo_rejudge_session`.
- Defect: fetch session diagnosis, show exact title/description, confirm, then
  `echo_create_defect_from_session`.

## Personas and voices

- User-authored persona feedback: read the exact session/deviation and use
  `echo_submit_persona_feedback` only on an explicit request to record it.
  Follow `echo_list_persona_learning` for queued/under-evaluation/active/retired
  status. `echo_update_persona_learning` supports confirmed retirement or retry
  with the returned current revision. Never promise automatic voice/STT fixes.

- Personas: `echo_list_personas` / `echo_get_persona`.
- Auditable server-side groups: `echo_list_persona_groups`; current server-side
  selection preview: `echo_preview_persona_selection`.
- Coverage/deviation matrix: `echo_get_persona_matrix`.
- Voice catalog/detail and accent zones: `echo_list_voices`, `echo_get_voice`,
  `echo_list_accents`.
- Compatibility ranking: `echo_match_voices`; cached assessment:
  `echo_get_voice_report`. Forward `includeUnknownGender` explicitly when the
  user wants unknown-gender candidates. Catalog approval and compatibility do
  not prove live provider availability. A random selection preview may differ
  on the next call; the execution preflight freezes the actual cast.
- Corpus script/coverage/specific contribution:
  `echo_get_voice_corpus_script`, `echo_get_voice_corpus_progress`,
  `echo_get_voice_contribution`. Never request raw audio or a signed URL.
- Runtime overrides never mutate the persisted persona.

## Environments, knowledge, judge and regulation

- Environment inventory/detail: `echo_list_environments` / `echo_get_environment`.
- Static knowledge health: `echo_get_knowledge_health`.
- Binding/source priorities: `echo_get_knowledge_binding`. Resolve returned
  sourceId values with `echo_get_knowledge_source` for current repository,
  branch, synchronization state and activeSnapshotId. This returns safe metadata.
- Snapshot history: `echo_list_knowledge_snapshots` returns at most the latest
  100 snapshots and warns at the cap. An active snapshot is current source
  state, not necessarily the frozen snapshot used by a historical session.
- Persisted static assessment: `echo_get_knowledge_snapshot_quality` for the
  exact snapshotId. State its completion time, coverage/readiness and engine
  version. `unavailableMetrics` is not zero findings; missing assessment is not
  healthy. This read never runs the session Knowledge Judge or starts analysis.
- Evidence-grounded change proposals: `echo_list_knowledge_proposals` /
  `echo_get_knowledge_proposal`.
- Judge profile/version: `echo_get_judge_configuration`. A published version is
  active for new evaluations; a draft is only a pending change. Always state
  both when their pass thresholds differ.
- Judge semantics and exact attempts: `echo_get_judge_methodology_templates`,
  `echo_get_judge_preview`, `echo_get_judge_run`.
- Environment readiness: `echo_get_regulatory_status`; global published catalog:
  `echo_list_regulatory_catalog`.

## Operations and auxiliary flows

- On-demand daily, weekly or custom-period monitoring report:
  `echo_generate_monitoring_report`. Follow the dedicated report confirmation
  state machine in SKILL.md. Use only complete civil days and send only to the
  server-resolved signed-in member; the tool intentionally has no recipient
  argument. Its durable jobId/state tracks the request; queued/running is not
  delivery. The platform report panel owns progress.
- Schedules are currently read-only through `echo_list_schedules`; do not route
  to generic schedule writes because they can trigger unreviewed real calls.
- Real-participant orders: `echo_list_human_tests` / `echo_get_human_test`.
  Describe persisted lifecycle only; do not claim an operational marketplace
  from schema/data existence.
- Imported-call batches: `echo_list_imports` / `echo_get_import`.
- Persona playground history is explicitly non-evaluated:
  `echo_list_playground_sessions` / `echo_get_playground_session`.
- In-progress manual chat: `echo_get_manual_chat_session`; its completed
  evaluated artifact is read through the normal session tools.
- Knowledge PR/repository reconciliation: `echo_get_knowledge_change_run`.
- Organization glossary: `echo_list_glossary`, `echo_get_glossary_term`,
  `echo_get_glossary_facets`.
- Document authoring belongs to Journey Studio. The general support host uses
  the existing `echo-journey-import` workflow for uploads and the trusted
  authoring step for `echo_journeys_*` review/publication tools. The dedicated
  Echo scope exposes draft reads only; use the Studio UI for authoring.
  The legacy parse/apply notebook MCP pair is retired, not a fallback.

## Screen defaults

- `overview`: overview for current application/window; apply the selected-period
  directive in SKILL.md to both the summary and its supporting evidence.
- `journeys`: list or exact Journey from `planId + moduleSlug`.
- `sessions` / session detail: list or exact session; add evaluation for any
  interpretation.
- `deviations` / deviation detail: list or exact record, then related session
  only if needed.
- `personas`: persona/group/matrix reads according to the visible subsection.
- `environments`: current environment detail; add requested binding/health.
- `judge`: judge configuration, not session results unless a session is named.
- `human-sandbox`: real-participant order lifecycle only.

## Deliberate boundaries

- Live streams are owned by the persistent platform panels. Never emulate them
  with repeated tool calls.
- Raw audio, signed media URLs, provider-account inventory, Regulatory Studio
  authoring and participant-worker identity/queue data are not general
  customer-assistant reads.
- A missing tool for a write is an authorization boundary, not permission to
  call a generic API or improvise an action.
- Never repeat the same read with unchanged arguments in one turn. If the
  bounded result is insufficient, narrow the next query or state the remaining
  uncertainty.

Large frozen evidence: use `echo_read_evidence` with an exact official session, judge run, execution or deviation ID. Follow returned JSON pointers and offsets. Its completeness flag describes the selected page; nested values can still require reading. Session resources accept sessionCode; other resources keep their own technical IDs. Never open an SDK artifact through a denied shell/file tool.
