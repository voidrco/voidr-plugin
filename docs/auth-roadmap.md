# Authentication roadmap

## What the MVP guarantees

Installation is immediately authenticated when the developer already has a
valid account in `~/.voidr/service-accounts.json`. This is the same credential
store used by the Playwright framework, so no repository-specific MCP file and
no second browser callback are needed.

For a new or read-only developer, `/voidr-connect` uses a protected local JSON:

1. the user creates or rotates a `read` + `write` Service Account in Voidr;
2. the plugin creates and opens `~/.voidr/copilot-service-account.json` with
   mode `0600`;
3. the user fills Client ID and Client Secret and saves the file;
4. a local MCP tool exchanges the credentials at the token endpoint;
5. it verifies organization and scope claims, persists only after validation,
   and removes the temporary JSON.

The model never receives the secret or access token.

## Why installation cannot be universally pre-authenticated

A distributable plugin is identical for every developer. Embedding one shared
Service Account would make every installation share the same revocation,
audit, and tenant boundary. Embedding a per-user secret is impossible before
the user has identified and authorized themselves.

Therefore “already logged in after install” can safely mean either:

- reuse a credential already provisioned on that machine; or
- an organization-managed installation process provisions one before the
  first Copilot session.

It cannot mean shipping a reusable secret in the plugin.

## Target device authorization flow

To remove secret copy/paste entirely, the platform should add a short-lived
device authorization flow:

1. `POST /v1/device/authorization`
   returns `device_code`, `user_code`, `verification_uri`, expiration, and
   poll interval.
2. The helper opens or prints the verification URI.
3. The authenticated platform user reviews organization, account name, and
   exact scopes.
4. Approval creates a dedicated Service Account.
5. `POST /v1/device/token` returns the credentials once to the polling helper.
6. The helper validates the resulting token claims and stores the credentials.

Required controls:

- single use and short expiry for device/user codes;
- PKCE or an equivalent binding between initiation and polling;
- explicit organization and `read`/`write` scope consent;
- rate limits and exponential polling backoff;
- audit event with user, organization, plugin version, and machine label;
- immediate revoke and rotate support;
- no secrets in URLs, logs, analytics, or chat;
- platform-side restriction preventing Hive dispatch scopes from being
  granted to this plugin account.

The plugin's local bridge and skills do not need to change when this flow is
added; only credential provisioning changes.
