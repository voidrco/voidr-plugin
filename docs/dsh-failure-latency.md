# Monitor failure evidence and latency

Monitor starts with the failure-analysis tool profile and the complete failure-analysis skill. Other capabilities remain available through the existing per-turn scope expansion; authorization and confirmation still belong to the original runtime and Service policies. Authoring, execution and deployment instructions load through their skills when the user changes tasks.

For an exact execution and case, `failure_analysis_read_bundle` validates execution identity, reads complete failure pagination and gathers ten source types through `ctx.tools.execute`. It preserves the agent, parent call, root call and cancellation signal. History retains application and Test Plan scope. A maximum of three reads run concurrently, with a 60-second overall deadline. No source mutation, job, test run or alternative credential is involved.

The returned view contains all selected failure records, independent error-message and stack fields, source counts and hashes, every failed/timed-out trace step, bounded context, history aggregates and explicit omissions. Successful reads and unavailable sources are distinguishable. A compact example is never the complete population. Source references permit a specific deeper read without treating missing detail as absence. Oversized or incomplete core evidence fails closed instead of publishing a misleading summary.

The initial pass explains the observed failure mechanism and separates it from an unconfirmed underlying cause. It does not establish a product defect, perform a controlled reproduction or authorize remediation. An unresolved cause must remain unresolved.

## Qualification

This change is a candidate, not a demonstrated production latency fix. The isolated study uses an organization-scoped inference key, the same pinned backend on both arms, read-only Service calls under the investigator's own organization account, immutable runtime images and fresh native sessions. It records model requests, retries, connection failures, source reads, CPU, GC and event-loop delay. Unsuccessful trials remain in the evidence. Transport, native startup, source collection and final answer time are separate measurements.

Source retrieval alone is not acceptance. Acceptance requires a completed native answer with correct record associations, counts, times and supported conclusions, followed by repeated matched measurements. A missing final answer or a transport retry counts against latency. A short synthetic model call, a cache hit, or a separately measured finalizer cannot substitute for end-to-end measurement.

The preliminary nine-source live collector took 6.47 seconds. Later exploratory native trials still exceeded six minutes, including interrupted model streams and additional model planning. A replay of one identical post-collection request without streaming took 114.20 seconds and asked for more reads; 3,834 of its 4,049 output tokens were reasoning. Removing streaming alone therefore did not resolve that trial. These observations are diagnostic evidence, not a production p95 claim.

The production runtime inspected during this study pins plugin `db789f703ac457670d52579d05fdcca64856a25c`, whose adapter has no surface tool profiles. The newer profiles in plugin `main` are not activated by merging plugin code alone: Hive's pinned plugin source also requires a separately reviewed release.

No production routing or capacity is changed by this PR. Hive #630 remains draft; its separate release gate still requires real-traffic p95 no more than 20% above baseline and at least 15% node CPU headroom.

## Automated checks

The focused runtime, scope, skill and authoring suite passes 61 tests with one existing skip; the 14 E2E contract tests pass. The complete suite has 484 tests: 460 pass, four skip, and the same 20 failures reproduced on the unchanged base in the same checkout environment. No check is removed or bypassed. These pre-existing failures and the unresolved native latency qualification prevent treating the candidate as release-ready.
