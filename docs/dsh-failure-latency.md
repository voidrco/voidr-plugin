# Monitor failure evidence and latency

Monitor starts with the failure-analysis tool profile and the complete failure-analysis skill. Other capabilities remain available through the existing per-turn scope expansion. Service authorization, runtime guards and confirmation rules remain authoritative. Authoring, execution and deployment instructions load through their original skills when the user changes tasks.

For an exact execution and case, `failure_analysis_read_bundle` validates execution identity, reads complete failure pagination and gathers eleven source types through `ctx.tools.execute`. It preserves the agent, parent call, root call and cancellation signal. Application and history scope are checked. At most three reads run concurrently, with a 60-second overall deadline. Offloaded sources use bounded hydration through the same authorized artifact tool. No source mutation, model request, job, test run or alternative credential is involved.

The compact view preserves every selected failure record, separate message and stack fields, exact sample counts, source hashes, all failed/timed-out trace steps, bounded context, history aggregates and explicit omissions. ANSI formatting is removed only for classifying error fields. Raw field prefixes remain separate. Unavailable sources are gaps, not empty results; sampled or omitted data cannot establish absence.

Selected Monitor sessions expose the initial collector first, then bounded detail reads and the report tool. Presentation filtering does not remove the composite's authorized child tools. Model-direct full dumps and generic dispatchers require explicit scope expansion; parent dispatch still traverses the original authorization and approval checks. A maximum of three attempted detail reads follows the initial pass. Excerpts support exact field paths, literal filters, source row positions, pagination, size bounds and detection of changes since collection. New turns, user steering and context changes invalidate the read window.

`failure_analysis_render_report` publishes an initial source-bound report using the existing Platform Markdown widget and concludes that read-only turn. The model selects only unconfirmed hypothesis kinds and proposed checks. Counts, every selected row, UTC times, durations, independent error classes, references and uncertainty come from the collected source data. Model-authored prose, classifications, rows and evidence references are rejected. A snapshot, console error, HTTP status or later pass cannot establish or exclude a cause through this tool. Proposed checks are not executed. Deeper causal investigation remains available through the original skills and exact scope expansion.

## Qualification and limits

This is a draft candidate, not a production latency or connection fix qualification. It deliberately distinguishes an initial evidence report from a completed causal investigation. A short initial report cannot substitute for the latter or pass a production p95 gate by changing the task's depth.

The isolated replay used Milson's exact question, “Por que essa jornada está falhando?”, execution `b458f9029710c213dcc08273` and case `SAUDE-10`. It used the investigator's own authorized organization account for live read-only Service calls and an organization-scoped inference key. It did not reproduce Milson's authenticated browser/session path. Native sessions used the actual production DSH image `sha256:daf1798838ffafdb547d9639935f680bdf72df2d46aa2af8acd12046707b3b55`, fresh workspaces, the same DeepSeek model and high reasoning unless an explicitly named exploratory effort trial says otherwise. Provider metadata independently confirmed all 13 generations across the three initially pinned Relace trials. The subsequent actual-wrapper trial separately verified primary versus auxiliary routing.

| Trial | Native elapsed | Decision |
| --- | ---: | --- |
| Original production investigation | 2,074.859 s | Historical observation: 25 rounds; different depth and live conditions, not a matched baseline. |
| Free-form candidate, Relace | 75.187 s | Numeric facts passed; semantic review rejected unsupported exclusions and environment classification. |
| First source-bound report, Relace | 60.182 s | Initial report only; a later regression correction was required for ANSI-colored stack classification. Not final-head qualification. |
| Corrected source-bound report, Relace | 65.173 s | Source associations and semantic uncertainty passed; one native report widget, four model requests including title generation, no transport failure. Runtime source `12ac4fa`. |
| Corrected source-bound report, OpenInference | >360 s | Same source version and high reasoning; safety deadline without a final report. |
| Actual opt-in wrapper and source-bound report | 20.093 s | Real context command, async session context and compiled Hive wrapper supplied the provider pin; the harness did not add it. Three main requests used Relace; title generation kept its default route. Facts and semantic uncertainty passed, with no transport failure. |

The corrected report preserves all four selected records and the 120,000 ms message versus 10,000 ms stack discrepancy. It distinguishes nine failure records from four distinct cases, and 114 occurrences of one console message from the other twelve messages in the sample. The actual Platform `WidgetRenderer` rendered these facts correctly in a local browser fixture through Playwright MCP, with no rendering alert. This was not an authenticated product/browser latency measurement.

The corrected Relace replay observed 7.399 seconds of native-process CPU, 293.705 ms of GC and a maximum individual GC of 12.523 ms; the p95 of one-second maximum event-loop delays was 42.107 ms. Startup produced a 1.325-second maximum stall. These component measurements do not establish whole-node CPU reserve, an AMD full-Hive result or a production p95.

Earlier OpenInference trials exceeded the six-minute safety deadline and included interrupted streams and further model planning. A non-streaming replay of an identical post-collection request took 114.20 seconds and still requested more reads. An exact-body transport probe reset on the public route after 22.10 seconds while receiving data, whereas the direct serving revision completed its separate generation in 142.33 seconds. Those observations do not isolate the cause to Cloudflare, the gateway or the provider. Connection remediation remains unqualified; routing and reasoning changes were confined to the fixture. An independent Hive change adds a disabled-by-default `DSH_MONITOR_LLM_PROVIDER=relace` opt-in for the measured route, preserving the model, high reasoning and existing caller restrictions. It does not enable a deployment or update the plugin pin.

Unsuccessful trials remain in the private evidence, including rejected semantic answers, unsupported `medium` effort, an invalid fixture tool scope, excerpt-path handling and an early report-reference API that caused a bounded retry loop. They are not excluded to claim success. The final report API derives rows and references itself rather than asking the model to copy them.

The production runtime inspected pins plugin `db789f703ac457670d52579d05fdcca64856a25c`, which has no surface tool profiles. Merging plugin code alone does not activate these changes: a separately reviewed Hive plugin pin/release and authenticated product validation are still required. Private requests, model reasoning, raw organization evidence and credentials are not committed to this repository.

No production routing, capacity, budget, IAM or canary is changed. The DSH component fixture used an existing provisioned node, not an added node or node pool. Hive #630 remains draft; its separate gate requires real-traffic p95 no more than 20% above baseline and at least 15% whole-node CPU headroom.

## Automated checks

The focused runtime, scope, skill, authoring and report suite passes 77 tests with one existing skip; all 14 E2E contract tests pass. Plugin validation and diff whitespace checks pass. The full suite has 496 tests: 472 pass, four skip, and the same 20 failures reproduced on unchanged base `511c26d` in the same environment. No check is removed or bypassed. These existing full-suite failures and outstanding end-to-end production qualification prevent treating the draft as release-ready.

All 220 top-level evidence files were exported in a hash-verified private archive (SHA256 `3fff8be09fbfd1f719371daf17efd94e5783738a6bfc60b57c963a5184b8ce62`). The owned namespace was removed after export and process inspection; the existing node was retained. No temporary cloud workload remains from this component experiment.
