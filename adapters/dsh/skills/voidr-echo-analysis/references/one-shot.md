# One-shot validation — all conversational channels

One-shot means one intent, one runnable scenario, one persona and one repetition
using the existing execution/session/judge infrastructure. It is not a mocked
conversation written by the assistant and not the unevaluated persona playground.
It does not certify the entire product statistically.

## Resolve the intent

Example: "Seja um cliente putasso com a Vivo e pergunte as informações do plano."
The supplied emotional trait is irritado; do not replace it with a calm persona.
The goal is in the Journey, not persona.goalTemplate. Never infer age, gender,
accent, voice, customer identity, account data, endpoint, plan price or answer.
Read org-scoped product, environments, journeys, personas, voices and the current
judge configuration/knowledge binding. Resolve the agent's purpose and boundaries
from those sources or ask the user. Match an existing scenario by goal and expected
outcomes, not only its title. If no exact scenario fits, propose a new canonical
Journey with one READ_ONLY runnable scenario, persona actions, expected agent
responses and explicit acceptance criteria grounded in the source/user. Expected
responses are test expectations, not claims that the real agent said them.

Ask only unresolved choices, grouped concisely. Offer concrete catalog options.
An explicitly approved existing persona already supplies its profile/voice; do
not interview for those fields again. "Use your suggested profile" permits a
clearly labeled proposal, not invented customer metadata. Never create transport
credentials or alter the org's judge/knowledge configuration just to make a test
pass. The backend currently supports only READ_ONLY one-shot scenarios.

## Durable state machine

Teams requires an administrator-approved identity binding between the sender's
Entra object ID and a current Voidr organization member. Without that binding,
ask an organization administrator to link the account in the Teams integration;
never use the bot owner's privileges or infer identity from a display name.
The binding is resolved on each channel turn; current membership permissions
are checked on every tool call.

1. `echo_plan_validation` accepts a stable UUID idempotencyKey, original prompt,
   applicationId, environment, agentContext, echoChannel and either reuse or
   creation proposals for Journey and persona. If incomplete, NEEDS_INPUT returns
   questions and discovery context with no resources created. Fill missing inputs
   from reads/answers. A complete proposal returns a validationId. Retry the same
   proposal with the same UUID; revisions use a new UUID and require fresh approval.
2. Present the exact proposal: product/agent purpose, environment/channel, what
   will be reused/created, scenario/objective/expected outcomes, persona's actual
   profile/temperament/voice, data selection and the one-call limit. STOP and ask
   for setup approval. A saved proposal alone is not an execution or a resource.
3. Only in the approval turn call `echo_prepare_validation` with validationId and
   confirmed:true. It materializes canonical resources and runs normal preflight.
   Present its exact summary including target, selected persona and voice, data,
   number of calls, safety classification and expiry. On web render
   `echo_execution_confirmation` with validationId + returned summary + nonce and
   expiry. On Teams/external hosts use the same summary in text. STOP again.
4. Only after execution approval call `echo_execute_validation` with validationId,
   the returned nonce and confirmed:true. If realCall=true, obtain separate,
   explicit authorization for the real PSTN call and pass realCallApproved:true.
   Never treat setup approval as real-call approval. A widget action named
   `echo.confirm_validation` supplies these bound values. Never use the regular
   echo_create_execution tool for this flow.
5. Keep validationId and executionId in durable conversational state. A retry
   retrieves/reconciles the same operation. DISPATCH_UNCERTAIN is not permission
   to create a replacement: retrieve again or request operational reconciliation.
   SETUP_FAILED may be retried after the cause is addressed; existing resources
   are preserved. If a preflight nonce was lost, wait for its expiry before asking
   to prepare again. Never expose nonce values or secrets in user-facing prose.
6. Use `echo_get_validation` for evidence/status. When web's persistent execution
   panel owns progress, let it run and fetch the validation when the user requests
   the result. On Teams/external hosts, give the validation reference and truthful
   pending status and use `echo_get_validation` with waitSeconds:25 for bounded
   server-side waiting (at most four consecutive waits per turn). If still pending,
   preserve the reference and retrieve on follow-up; if the host supports a user-approved
   follow-up mechanism, use it. Do not claim a background notification was scheduled
   without that mechanism, and do not busy-poll in the assistant turn.

## Evidence delivery

COMPLETE means the execution is terminal and evaluation has settled; it can still
be FAIL, INCONCLUSIVE or UNAVAILABLE. Report outcome, score only if present,
judge/coverage, one or two literal transcript excerpts with session/turn references,
deviations and evidence limitations. Differentiate environment/IVR failures from
customer-agent behavior. Never fabricate a score, dialogue, audio or verdict.
Use the returned canonical JSON as the portable evidence and authenticated evidence
endpoint for API clients; do not turn its relative API path into an invented public
UI link. Session links must use a verified platform route. Redacted or truncated
transcripts must be described as such. A later rejudge may change the latest result;
include observation time and judge identity, never describe this as an immutable
signed certification. No audio/storage paths or signed URLs are exposed.
