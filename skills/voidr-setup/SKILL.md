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

Run `voidr_environment_doctor` and relay its findings as they came:

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

Answer with a short APT/NOT-APT verdict, the failed checks (if any) each with
its remediation and owner (user vs. plugin), and the authenticated
organization. Never print tokens, secrets, or credential file contents.

## Tool routing

- `voidr_environment_doctor` — machine dependency diagnosis.
- `voidr_auth_status` — authentication and organization check.
- `voidr_auth_select_organization` — switch between locally available accounts.
- `voidr_auth_login` — official browser login; imports the Service Account.
