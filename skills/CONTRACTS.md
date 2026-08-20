# Voidr Copilot — shared contracts

Every `voidr-*` skill obeys this file. Each skill points here instead of
repeating these rules; read it once when the first Voidr skill of the session
activates.

## Hive

Never call a tool that starts a Hive process, directly or through a generic
or batch tool (`agent_jobs_*`, `system_batch_execute`,
`test_plan_generation_generate_test_plan_draft`, self-healing triggers). The
Copilot agent does the work locally.

## Grouped tools

A routed tool missing from your available tools is grouped, not absent, and
each host reveals it differently. On GitHub Copilot CLI, past a tool-count
threshold the editor collapses tool sets into groups the model has to expand
first: find the activation entry whose summary lists that tool and call it
with the exact name you were given. On Claude Code the tool is deferred
instead: load it with `ToolSearch`, selecting its scoped name
(`mcp__plugin_voidr_voidr__<tool>`) or searching the bare name as keywords,
then call it. Never invent an activation name, and never report the tool as
unavailable before the host's own mechanism has been tried. Only when that
mechanism still does not surface it, say exactly which tool is unreachable and
stop.

## Guard denials

A tool call denied with a `Blocked by Voidr workflow` or `Blocked by Voidr
policy` message is the plugin steering the flow, not a defect. When the
denial embeds its own remedy — an exact parameter to add (for example
`workspaceRoot: "<path>"`), a tool to call first, or a phrase to collect from
the user — follow it literally: repeat the same call with the indicated
change in the same turn. Never delegate a denial to a subagent, and never
report it to the user as a plugin or MCP bug. When the denial names a user authorization phrase, relay that
phrase to the user exactly as written — a paraphrase may not be recognized by
the gate and leaves the user typing authorizations that never work.

## Terminal

The terminal is available. Prefer the bridge tool a skill routes for setup,
validation, publishing, and deploy: it injects the selected Service Account
and the plugin endpoints into the child process, which a command typed in the
terminal does not have.

## Secrets

Never reproduce credentials, emails, tokens, CPF/CNPJ, or other personal
identifiers found in product code, documentation, or `.env` files — not in
chat, not in summaries, not in drafts, not in specs. Record only environment
variable names as `{{env.VARIABLE_NAME}}` placeholders. Never read or print
`.env` contents through any tool or terminal command; if a value was already
exposed, recommend rotating it.

## Data provenance

Every platform fact — application, environment, Test Plan, module/suite/case
slug, session ID, URL, execution status — exists only when a Voidr tool
returned it in this session (the `manifest-context.json` written by
`/voidr-context` counts: the bridge produced it from platform reads). Never
infer platform data from folder names, file contents, chat history, memory,
or previous conversations. When a value is unknown, call the corresponding
read tool first.

## Selections

Every choice — application, environment, Test Plan, cases, repository — is
rendered with the native `ask_user` selectable options whenever that control
is available. Never ask the user to type an organization ID, application ID,
Test Plan ID, case slug, or repository path when a platform listing can be
rendered instead; a pasted ID volunteered by the user is acceptable. The
question UI rejects a question with a single option: when exactly one
candidate exists, confirm it with two options — `Usar <nome>` and `Cancelar`.

## Clone handover

The plugin never clones the test repository: the clone is done by the user,
whose access to the repository is what the clone proves. When a bridge tool
answers with the clone handover message, relay it exactly as it came — the
commands, the workspace destination, and the administrator-authorization
guidance — wait for the user to confirm the clone, then call the same tool
again.

## Node runtime

Never install, switch, or pin a Node runtime. When a tool reports an
unsupported Node version, relay that message as it came and retry the tool
once after the user confirms — nothing else.
