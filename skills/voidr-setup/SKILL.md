---
name: voidr-setup
description: Valida e prepara com segurança o ambiente local exigido pelo plugin Voidr Copilot — dependências da máquina (Node/npm/npx, PATH no Windows, Playwright, proxy corporativo) E a autenticação Voidr (Service Account via login browser oficial). Use quando o setup ou a instalação de dependências falhar, quando Node/npm/npx estiver ausente ou incompatível, quando o Playwright não iniciar, quando um proxy corporativo ou endpoint-security bloquear uma operação, quando a autenticação Voidr estiver ausente, revogada ou precisar trocar de organização, ou quando o usuário pedir para checar, configurar, corrigir, preparar ou diagnosticar o ambiente de desenvolvimento Voidr.
---

# Prepare the Voidr environment

> Host note: `ask_user` names the host's native question tool — `ask_user` on
> GitHub Copilot CLI, `AskUserQuestion` on Claude Code. Wherever this skill
> says `ask_user`, use that tool with selectable options; plain chat text is
> never a substitute.

Never call a tool that starts a Hive process. Obey the shared contracts in `../CONTRACTS.md` (read that file once when the
first Voidr skill of the session activates). Diagnose first; keep every
automatic adjustment confined to Voidr child processes and leave machine
configuration under the user's or administrator's control.

The environment is APT when both parts hold: the machine dependencies pass
the doctor, and a Voidr Service Account for the intended organization is
selected and valid.

## 1. Machine dependencies

Run `voidr_environment_doctor`, passing `workspaceRoot` with the open
workspace folder (and `repositoryPath` when a test repository is already
selected). Without either, the report covers only the machine-level checks:
the bridge runs from the plugin installation, so an unscoped call can never
verify a test repository. Relay its findings as they came:

- it names each dependency check (Node runtime and compatible major, npm/npx
  resolution, Playwright launchability, proxy/TLS trust) with a pass/fail and
  the exact remediation;
- remediations that need administrator rights or change machine state are for
  the USER to run — show the command, never execute it;
- Voidr-scoped adjustments (toolchain PATH for child processes, system CA
  trust for the bridge) are applied automatically by the tooling and only
  reported.

When a corporate proxy or endpoint-security product blocks an operation, the
doctor's report names the blocked endpoint: hand the user that exact host
list for the allowlist request. Never suggest disabling the security product.

## 2. Voidr authentication

Check with `voidr_auth_status`:

- **Valid and same organization** → report connected; done.
- **Valid but wrong organization** → list the locally available accounts from
  the status result and switch with `voidr_auth_select_organization`
  (selection rendered with `ask_user`). Only when no local account matches
  the intended organization, connect a new one.
- **Missing, revoked, or read-only** → connect with `voidr_auth_login`: it
  opens the official platform browser login and imports a role-scoped
  Service Account without exposing credentials. Never ask for a Client ID or
  Client Secret, never place one in a command, never read credential files.

After connecting or switching, call `voidr_auth_status` again and report the
organization name and scopes that the platform returned.

## Reporting

The reader wants to know whether they can proceed, not how the machine was
inspected. Report the checks that FAILED, never the ones that passed.

**Everything passed** — one line naming the organization, and go straight on to
what they asked for. Do not print the check table: a five-row report of things
that are fine is noise in front of the actual task.

**Something failed** — name what is broken in one sentence, then the single
next action, in the imperative, addressed to the reader. Nothing else. If more
than one check failed, lead with the one that blocks everything else.

Write for the person, not for yourself: no tool names, no "call this again", no
describing the user in the third person. Compare

> ❌ NOT APT — node-runtime (owner: user): This shell resolves Node v25.9.0 but
> the framework requires Node 22. Ask the user to run `fnm use 22`…

with

> Ative o Node 22 antes de seguir: `fnm use 22`, e reabra o editor por esse
> terminal. O resto do ambiente está pronto.

Never print tokens, secrets, or credential file contents.

## Tool routing

- `voidr_environment_doctor` — machine dependency diagnosis.
- `voidr_auth_status` — authentication and organization check.
- `voidr_auth_select_organization` — switch between locally available accounts.
- `voidr_auth_login` — official browser login; imports the Service Account.
