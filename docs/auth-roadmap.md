# Browser authentication

## What the MVP guarantees

Installation is immediately authenticated when the developer already has a
valid account in `~/.voidr/service-accounts.json`. This is the same credential
store used by the Playwright framework, so no repository-specific MCP file and
no second browser callback are needed.

For a new or read-only developer, `/voidr-connect` reuses the browser callback
already used by the Voidr CLI:

1. the plugin starts a one-shot callback on a random `127.0.0.1` port;
2. it opens the official Voidr login with a random nonce;
3. the user logs in and explicitly chooses an organization when necessary;
4. the platform sends a temporary user token directly to the loopback callback;
5. the plugin creates a dedicated Copilot Service Account with no requested
   scopes, so the backend derives them from the user's organization role;
6. the plugin validates the account and stores it in
   `~/.voidr/service-accounts.json`;
7. the temporary user token is discarded.

The model never receives the Service Account secret or temporary access token.
The callback accepts only the configured Voidr origins, validates the loopback
host and nonce, limits request size, and handles only one successful request.

Admins and editors receive `read` + `write`. Viewers receive `read` and cannot
escalate by changing a client request.

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

The flow does not ship a shared credential and does not persist the user's
Auth0 session token.
