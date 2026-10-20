# Defect creation from deviations

Read the selected application's current deviations and relevant conversations.
One observable behavior needs an exact source turn and its expected behavior;
do not merge unrelated silences, loops and integration failures into one defect.
Follow the existing confirmation contract before a write. An initial request to
create does not replace the required review of its exact effect.

Discover native echo_begin_defect_investigation, echo_search_defect_candidates,
echo_search_defect_evidence, echo_inspect_defect_candidate and
echo_commit_defect_investigation. Use their exact schemas. Do not route them
through system_call_tool or invent parameters from search summaries.

Generate one requestId for the proposed behavior. Keep that requestId and payload
unchanged after a timeout, lost response or not-found response immediately after
preparation. Changing the requestId creates another proposal. Never report a
defect as created without a successful committed result and its saved identity.

Begin returns review.id and snapshotId. Copy both exactly for search, inspect and
commit; never generate a snapshotId. prepare_defect_review creates only a human
review proposal and does not issue an investigation snapshot. To resume such a
proposal, get its saved input and pass that unchanged to begin. A snapshot
conflict requires begin again with the same requestId and input, followed by
fresh evidence and comparisons; do not reuse an old assessment with a new ID.

Paginate historical candidates completely before claiming a new problem. Inspect
plausible matches and compare trigger, expected, observed and acceptance criterion.
Use exact returned turnIndex and literal quotes for evidence. Internal creation
and eligibility for external Vivo delivery are separate decisions: preserve the
server's evidence, mass-profile, time-window, priority and delivery requirements.
If qualification is incomplete, report the saved proposal and missing evidence;
do not fabricate a complete investigation or silently create a duplicate.
