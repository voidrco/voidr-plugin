# Echo ontology

## Canonical hierarchy

`Organization → Application → Environment | Journey | Persona | Voice | Schedule`

`Journey (TestPlan module) → JourneyFlowVersion | Scenario | ExecutionProfile | DataProfile | JudgePolicy`

`Execution → Shard → Session → Turn | Evidence | Deviation | JudgeRun`

`JudgeRun → BehavioralEvaluation | KnowledgeEvaluation | RegulatoryEvaluation | OfficialResult`

`KnowledgeBinding → Source → Snapshot → RetrievalManifest → Proposal`

`RegulatoryPack → SourceVersion → Norm → Control → ReadinessAssessment`

## Stable identities

- Journey: `testPlanId + moduleSlug`.
- Published voice flow: `testPlanId + moduleSlug + version + checksum`.
- Legacy flow records are not proof of immutable Studio publication.
- Execution: `executionId`; each voice shard is an independent interaction.
- Official session: technical `sessionId` plus optional permanent `sessionCode`.
  Display only the code in user-facing references. Never display or copy a
  technical session ID; preserve ObjectIds only in URLs and internal actions.
  Missing codes use a neutral session label with occurrence date and link. Codes are unique only within the active organization.
  The prefix identifies a stable case series, not a mutable case name. Copies
  receive a new series; rejudging and case renames retain the assigned code.
  `IMPORT` and `LEGACY` series do not prove a Journey association. Sequence gaps
  are valid, and a suffix is never a session count or judgment.
  Imported/manual/synthetic/human provenance stays explicit.
- Judge attempt: `sessionId + attempt`; never overwrite conceptual history.

## Semantic boundaries

- `channel`: voice or chat.
- `interactionMode`: synthetic, manual or imported.
- `speaker`: synthetic persona, human participant or unknown source.
- `ingestion`: platform, imported or collected.
- Legacy combined values are compatibility projections, not new ontology axes.
- `occurredAt` is when the interaction happened; `recordedAt` is when the
  canonical session was persisted.
- `sessionDeviationCount` counts trajectory deviations embedded on a session;
  `deviationRecordCount` counts classified first-class deviation records.
- The execution matrix is scenario × persona × repetition. ANI and data profile
  are assigned across the matrix unless FULL_MATRIX is explicit.
- Customer IVR/preflight is evidence about access/navigation before the tested
  assistant. It cannot contaminate assistant evaluation.
- Session status describes interaction completion. Judge status describes an
  evaluation attempt. Never collapse them into one status.
- `judgeReasonCategory`/`judgeReasonCode` are the causal explanation for a
  skipped or failed judge. `hasReliableTranscript` is only evidence coverage;
  correlation between the two never proves causation.
- Behavioral knowledge-dependent criteria may use knowledge evidence, but do
  not invent a duplicate knowledge score. Regulation remains separately shown.
- An unavailable source or operational failure is not non-compliance.

## Persistence and freshness

- MongoDB is the canonical transactional source for every Echo lifecycle and
  write. ClickHouse is a rebuildable analytical projection, never an alternate
  owner.
- Customer-data envelopes carry an evidence cutoff and completeness state.
  Session/deviation lists and transcripts use a canonical fallback when needed.
  Cohort analytics instead report unavailable when coverage is incomplete;
  never reconstruct a total from one page or combine a partial projection with
  canonical totals as though they were one complete cohort.
- Analytical session children are valid only when their `projectionVersion`
  equals the latest parent-session `projectionVersion`. This prevents turns,
  deviations or criteria deleted by a later canonical version from reappearing.
- Cohort intervals are half-open: `occurredFrom` is inclusive and
  `occurredToExclusive` is exclusive. Timezone controls bucket boundaries only;
  persisted occurrence instants remain UTC.
- Cohort criterion aggregates join only the `judgeRunId` pinned by the current
  session projection. Historical attempts remain independently retrievable.
- Cohort latency percentiles summarize the persisted per-session percentiles;
  they are never presented as reconstructed global turn-level percentiles.
- Playground sessions are persona experimentation and do not enter evaluated
  session rollups. A completed manual chat does enter the normal session and
  judge lifecycles with explicit manual provenance.
- Long transcripts are evidence pages. Read only the needed role/text page
  rather than repeatedly loading the complete session document.

## Capability boundaries

- Customer-facing persisted entities and safe derived views are readable.
- Transient SSE progress remains with the platform live panels.
- Raw audio/signed media, live provider-account inventory, staff Regulatory
  Studio authoring and participant-worker private state remain separate.
- A write exists only when it has an explicit role check, current-state
  resolution and confirmation contract.

<current-semantics>
- `echo_get_ontology` and `voidr-echo://ontology` expose the same versioned
  semantic contract. Prefer its current policy to an older local reference.
- `judgeSummary` is persisted text, with `judgeSummarySource` and
  `judgeCompletedAt`; it is not a new evaluation. Pending, failed or skipped
  evaluations can omit an older summary from the current compact view.
- Session knowledge evaluation is currently paused:
  `KNOWLEDGE_EVALUATION_PAUSED` / `SKIPPED` does not mean infrastructure failure.
  Historical attempts retain their frozen configuration and evidence.
- An Echo deviation record is a classified observation. A platform Defect is a
  separate remediation entity, created only through its confirmed diagnosis
  flow. A knowledge finding with kind `DEFECT` is not a platform Defect id.
- `regulatoryOverall` and `hallucinationStatus` are independent of attendance.
  A `potential` hallucination is a screening signal, not confirmed misconduct
  or a platform Defect. Missing/inconclusive evidence is never approval.
- Static snapshot quality, regulatory readiness and session compliance have
  different subjects and denominators. Unmeasured quality metrics are explicitly
  unavailable; never interpret them as zero defects or full coverage.
- A current persona catalog name is display metadata, not a frozen shard input.
  Never infer a persona name, score, id or human evaluation from missing fields.
- The UI can show service success with regulatory qualifications when the
  canonical conditions permit it. Keep the official aggregate and regulatory
  uncertainty/non-compliance explicit; this is not an unconditional PASS.
- Human judge feedback is an observation attached to an exact evaluation. It
  does not alter the verdict, run a rejudge or automatically promote persona
  learning. Preserve the separate actor/ownership gates for its history and edits.
</current-semantics>
