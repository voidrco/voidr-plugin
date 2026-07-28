---
name: voidr-connect
description: Checks or securely connects a Voidr Service Account for the Copilot plugin without using npx voidr login or exposing a secret to the model. Use when Voidr authentication is missing or read-only.
argument-hint: "[organization]"
---

# Connect a Voidr Service Account

Never call a tool that starts a Hive process.

Call `voidr_auth_status` first.

- If the intended organization is already selected and `canWrite` is true,
  report that no login is required.
- If several organizations exist, ask which organization the user intends to
  use. Do not choose from an active `project.json`.
- If the account is read-only, explain that a new or rotated Service Account
  with `read` and `write` scopes is required.

Never ask for a client secret in chat and never pass it as a shell argument.

The user must create or select the scoped Service Account in the Voidr
platform, copy the one-time secret, and run the connector directly in a
regular terminal:

```sh
node "${COPILOT_HOME:-$HOME/.copilot}/installed-plugins/voidrco/copilot/scripts/connect-service-account.mjs" \
  --client-id <client-id> \
  --org-id <organization-id> \
  --org-name "<organization-name>"
```

The connector prompts for the secret without echo, validates it against the
Voidr token endpoint, verifies the organization and `write` scope, and only
then updates `~/.voidr/service-accounts.json` with mode `0600` where
supported.

After the user says the connector completed, call `voidr_auth_status` again.
Do not continue to a platform mutation unless `canWrite` is true.
