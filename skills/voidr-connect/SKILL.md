---
name: voidr-connect
description: Checks or securely connects a Voidr Service Account through a protected local JSON without using npx voidr login or exposing a secret to the model. Use when Voidr authentication is missing, read-only, or needs another local account.
argument-hint: "[organization]"
---

# Connect a Voidr Service Account

Never call a tool that starts a Hive process.

## Connect

1. Call `voidr_auth_status`.
2. Treat `serviceAccounts` as the complete list available on this machine,
   never as a platform listing.
3. If no local Service Account exists, call
   `voidr_auth_prepare_service_account` immediately.
4. Tell the user to fill `clientId` and `clientSecret` in the JSON that opened,
   save it, and reply `pronto`. If `opened` is false, give only the returned
   file path so the user can open it manually.
5. End the response. Do not ask for either credential in chat.
6. When the user replies that the file is ready, call
   `voidr_auth_import_service_account`. Never inspect the JSON with file,
   shell, editor, or workspace tools.
7. On successful import, call `voidr_auth_status` again and confirm the
   organization, Service Account name, and write access. The import tool
   removes the temporary JSON after validation.
8. On import failure, report only the returned safe error. Do not read or
   reproduce the file contents.

## Select an existing local account

- If `serviceAccountSelectionRequired` is true, ask which local Service Account
  to use before judging the active one. Show account name when present,
  organization name/ID, masked Client ID, and scopes. End the response.
- After the user chooses, call `voidr_auth_select_organization` with that
  entry's organization ID, then call `voidr_auth_status` again.
- If exactly one local Service Account exists, use it without asking.
- If the selected account has `canWrite: true`, report that no connection is
  required.
- If it is read-only, first offer another local account with write access. If
  none exists, call `voidr_auth_prepare_service_account` to connect a new or
  rotated credential through the protected JSON.

## Safety

- Never ask for or accept a Client Secret in chat.
- Never place credentials in a command, tool argument, or response.
- Never read the protected JSON through model-visible tools.
- Never choose an account from `project.json`, repository names, or workspace
  folders.
- Do not continue to a platform mutation unless `canWrite` is true.
