---
name: voidr-connect
description: Checks or securely connects Voidr through the official browser login, then creates a dedicated role-scoped Copilot Service Account without exposing credentials. Use when Voidr authentication is missing, revoked, read-only, or needs another organization.
---

# Connect a Voidr Service Account

Never call a tool that starts a Hive process.

## Mandatory execution contract

When this skill is invoked explicitly, follow this contract literally:

1. Do not create a plan or todo list. Do not ask a setup question.
2. Do not search, read, or inspect workspace files, installed-plugin files,
   scripts, manifests, tool definitions, or the MCP bridge implementation.
3. The first operational action must be a direct MCP call to
   `voidr_auth_status` with `{}`.
4. Use only `voidr_auth_status`, `voidr_auth_select_organization`,
   `voidr_auth_login`, and `voidr_auth_login_complete` during this connection
   workflow.
5. Never use a shell, terminal, `node`, `npx`, `curl`, or a manually invoked
   `voidr-mcp-bridge.mjs` as an authentication fallback.
6. Do not ask whether the user prefers a status check or browser login. The
   status result determines the next action automatically.
7. If calling `voidr_auth_status` produces a permission warning or the call
   is blocked, the tool exists but Copilot has not been allowed to run it:
   tell the user to approve the Voidr MCP tools when Copilot asks (or enable
   them in the Copilot tool permissions) and retry in the same chat. Only if
   the tool is truly absent from the session's MCP tool list, stop and say
   that the Voidr MCP tools are unavailable and that the user must reload the
   plugin and start a new chat. In both cases, do not investigate through
   files or the terminal.

## Connect

1. Call `voidr_auth_status`.
   It validates the selected local account against Voidr, so
   `validationStatus: rejected` means the local credential was revoked or
   deleted on the platform.
   If this status call fails, never invent an organization ID and never call
   `voidr_auth_select_organization`; call `voidr_auth_login` directly.
2. Treat `serviceAccounts` as the complete list available on this machine,
   never as a platform listing. Always tell the user which credential store is
   active by showing the returned `credentialStore` path and
   `credentialProfile`. For an isolated first-access test, the plugin supports
   a separate profile through `VOIDR_CREDENTIAL_PROFILE` (or an explicit
   `VOIDR_SERVICE_ACCOUNTS_PATH`); never assume the machine has no account
   without this status call.
3. If `serviceAccountSelectionRequired` is true, follow the selection section
   before deciding whether login is needed.
4. If `authenticated` is false, call `voidr_auth_login`. When
   `localCredentialPresent` is true, explain only that the selected local
   account was rejected or belongs to another organization; never expose it.
5. `voidr_auth_login` returns immediately with `authorizationUrl`. In the
   same response, ALWAYS show that URL to the user as a clickable link and
   say that the login page should have opened in the browser — and that if
   no window appeared (the operating system can block the automatic launch,
   e.g. a Chrome permission on macOS), they must open the link manually.
   Then call `voidr_auth_login_complete` to wait for the login to finish.
6. The browser flow handles user login and explicit organization selection.
   Wait for `voidr_auth_login_complete`; do not ask the user for a credential
   or JSON.
7. On success, call `voidr_auth_status` again and confirm the organization,
   Service Account name, scopes, and write access.
8. If login fails or times out, report only the returned safe error, show the
   returned `authorizationUrl` again as a clickable link, and offer to retry
   with `voidr_auth_login` + `voidr_auth_login_complete`.

The successful connection also supplies downstream Voidr Playwright framework
commands. Repository setup tools inject this selected Service Account into
their CLI child processes, so downstream skills must never run
`npx voidr login` or ask the user to authenticate a second time.

## Select an existing local account

- If `serviceAccountSelectionRequired` is true, ask which local Service Account
  to use before judging the active one. Show account name when present,
  organization name/ID, masked Client ID, and scopes. End the response.
- After the user chooses, call `voidr_auth_select_organization` with that
  entry's organization ID, then call `voidr_auth_status` again.
- Never pass `default`, a workspace name, or any value that was not returned
  in `serviceAccounts` as `organizationId`.
- If exactly one local Service Account exists, use it without asking.
- If the selected account has `canWrite: true`, report that no connection is
  required.
- If it is read-only, first offer another local account with write access.
- A fresh account in the same organization will keep the user's role-derived
  scopes. For mutations in that organization, explain that a viewer must be
  promoted to editor or admin in Voidr. Run `voidr_auth_login` again only when
  the user wants to connect a different organization or replace a rejected
  credential.

## Safety

- Never ask for or accept a Client Secret in chat.
- Never place credentials in a command, tool argument, or response.
- Never ask the user to create or edit a credential JSON.
- Never expose the temporary browser token to the model or persist it.
- Never choose an account from `project.json`, repository names, or workspace
  folders.
- Do not continue to a platform mutation unless `canWrite` is true.
