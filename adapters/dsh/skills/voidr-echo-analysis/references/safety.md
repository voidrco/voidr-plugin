# Echo action and data safety

## Confirmation

- Initial imperative language is intent, not confirmation, except the narrowly
  scoped explicit persona-feedback capture described in SKILL.md.
- Confirmation must happen after the exact current effect is shown.
- Never call a write after rendering a confirmation in the same turn.
- Never reuse an expired/replayed nonce or rebuild one from earlier context.
- Viewer/read-only denial is final. Do not search for a generic write bypass.

## Execution

- `echo_prepare_execution` is mandatory. Its server-resolved summary is the
  confirmation artifact; never calculate call count in the model.
- Mock/local transport and PSTN share the same session/evidence contract.
- For `realCall=true`, the confirmation must explicitly say it will place real
  calls, display call count and target/ANIs, and submit
  `realCallApproved=true` only from that explicit approval.
- Never suggest changing `READ_ONLY`, persona approval, environment target or
  contract window to bypass a refusal.
- Never expose DTMF/access-code content, encrypted envelopes or credentials.

## Other writes

- Generate monitoring report: resolve the exact application and complete civil
  date range, show the inclusive dates, timezone, artifacts and signed-in-member
  delivery, then wait for a separate explicit confirmation. Pass no recipient;
  the server resolves it from the authenticated actor. A successful queued or
  running job is not delivery; only a completed job confirms it. The platform
  tracks progress. A timeout is not proof of delivery and must not trigger a
  blind retry.
- Cancel execution: confirm id/current status and that active shards stop;
  persisted sessions remain.
- Rejudge session: confirm method CURRENT or ORIGINAL; previous judge attempts
  remain and the session lifecycle does not change merely because judging ran.
- Create defect: confirmation must show exact title and description; never
  auto-create a defect from feedback-loop output.
- Schedule triggering/enabling, participant-order creation, knowledge PR
  materialization and regulatory publication are intentionally not exposed by
  this assistant until their dedicated confirmation/safety contracts exist.

## Sensitive values

Allowed when relevant: phone number, ANI, provider voice id, execution/session
ids and other operational identifiers.

Forbidden in every channel: password, secret, API key, bearer value, token,
session/access code, DTMF credential, signed URL query and encrypted runtime
material. If a result appears to contain one, omit it and describe only the
non-secret configuration state.
