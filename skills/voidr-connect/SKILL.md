---
name: voidr-connect
description: Checks or securely connects Voidr through the official browser login, then creates a dedicated role-scoped Copilot Service Account without exposing credentials. Use when Voidr authentication is missing, revoked, read-only, or needs another organization.
argument-hint: "[organization]"
---

# Connect a Voidr Service Account

Never call a tool that starts a Hive process.

## Connect

1. Call `voidr_auth_status`.
   It validates the selected local account against Voidr, so
   `validationStatus: rejected` means the local credential was revoked or
   deleted on the platform.
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
