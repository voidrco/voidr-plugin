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
4. Use only `voidr_auth_status`, `voidr_auth_select_organization`, and
   `voidr_auth_login` during this connection workflow.
5. Never use a shell, terminal, `node`, `npx`, `curl`, or a manually invoked
   `voidr-mcp-bridge.mjs` as an authentication fallback.
6. Do not ask whether the user prefers a status check or browser login. The
   status result determines the next action automatically.
7. If `voidr_auth_status` is not available as an MCP tool in the current
   session, stop and say that the Voidr MCP tools are unavailable and that the
   user must reload the plugin and start a new chat. Do not investigate through
   files or the terminal.

## Connect

1. Call `voidr_auth_status`.
   It validates the selected local account against Voidr, so
   `validationStatus: rejected` means the local credential was revoked or
   deleted on the platform.
   If this status call fails, never invent an organization ID and never call
   `voidr_auth_select_organization`; call `voidr_auth_login` directly.
2. Treat `serviceAccounts` as the complete list available on this machine,
   never as a platform listing.
3. If `serviceAccountSelectionRequired` is true, follow the selection section
   before deciding whether login is needed.
4. If `authenticated` is false, tell the user that the official Voidr login
   will open in the browser, then call `voidr_auth_login`. When
   `localCredentialPresent` is true, explain only that the selected local
   account was rejected or belongs to another organization; never expose it.
5. The browser flow handles user login and explicit organization selection.
   Wait for the tool to finish; do not ask the user for a credential or JSON.
6. On success, call `voidr_auth_status` again and confirm the organization,
   Service Account name, scopes, and write access.
7. If login fails, report only the returned safe error and offer to retry.

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
