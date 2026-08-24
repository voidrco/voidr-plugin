---
name: voidr-context
description: Monta o contexto completo de trabalho de um Test Plan da Voidr e o materializa no repositório de teste — manifest-context.json na raiz (IDs de módulos/suítes/casos, sessões gravadas, repositório linkado, ambiente) + preparo do framework (install, link, scaffold, env pull) em uma chamada atômica. Use quando o usuário pedir para "buscar/montar/carregar o contexto de um test plan", "preparar o repositório do TP", "clonar o repo do test plan", ou como primeiro passo antes de desenvolver testes de um plano existente. Não cria nem altera conteúdo de Test Plan.
---

# Build the Test Plan working context

> Host note: `ask_user` names the host's native question tool — `ask_user` on
> GitHub Copilot CLI, `AskUserQuestion` on Claude Code. Wherever this skill
> says `ask_user`, use that tool with selectable options; plain chat text is
> never a substitute.

Never call a tool that starts a Hive process. Obey the shared contracts in `../CONTRACTS.md`. This skill only READS the
platform and prepares the local checkout; it never creates or changes Test
Plan content.

## 1. Resolve the Test Plan

- If the user pasted a 24-hex ID, use it VERBATIM: copy it character by
  character from their message. Never retype it from memory — dropping one
  character produces an id that is rejected, and the mistake looks like theirs.
- Otherwise, resolve it in two steps, because listing plans requires an
  application: call `applications_list_applications`, render the choice with
  `ask_user`, then call `test_plans_list_test_plans` with the selected
  `applicationId` and render the plan choice with `ask_user` (name + status +
  case count). Listing plans without an `applicationId` is refused.
- Never ask the user to type an ID.

### When the bootstrap rejects the id

Re-read the user's original message and resend the value verbatim — the error
reports what it received, so compare it against what they wrote before
concluding anything. A rejected id is a copy error until proven otherwise.

Only when the plan is genuinely unknown, fall back to the two-step listing
above and present the result as `ask_user` OPTIONS. Never resolve a tool
failure by asking the user to retype an id, and never ask it as free text.

## 2. One atomic bootstrap

Call `voidr_context_bootstrap` with the selected `planId` (and
`environmentSlug` when already chosen). The bridge then, in order: reads the
plan from the platform, resolves the environment, lists the recorded session
IDs, locates the checkout by Git origin, writes `manifest-context.json` at
the repository root (and guarantees its `.gitignore` entry), and runs the
framework preparation — `npm install`, Service Account auth in child
processes, `link` only when `project.json` is absent, `scaffold`, `env pull`
with values kept opaque.

Handle its three non-success answers:

1. **`needsEnvironmentSelection`** — the application has multiple
   environments. Render the returned listing with `ask_user`, carrying each
   environment's URL in the option description: the person deciding may have
   never heard of this application, and the domain is what makes the choice
   obvious. Put the likeliest first — the one the plan already used, otherwise
   the one named `principal`/`production` — and mark it as the suggestion, so
   the answer is one keystroke instead of research. Then call the tool again
   with the chosen `environmentSlug`.
2. **Clone handover message** — the tool clones the checkout itself; this
   answer means git could not. Lead with the reason git gave. When the same
   clone works in the user's own terminal the repository is authorized and this
   process simply could not reach the credential helper — say that, and ask
   them to clone it, rather than sending them to request access they already
   have. Relay the commands and destination as they came, then call the tool
   again.
3. **Preparation failure** — report the failing step as the tool named it.
   Do not run Git or setup commands manually. A Node-runtime message follows
   the shared Node contract.

The call is idempotent: repeating it continues from the current state and
updates the manifest in place.

This is the heavy, initial preparation path. On later implementation sessions,
`/voidr-generate` calls `voidr_context_refresh` before case selection so the
manifest receives new modules, suites, cases, and session IDs without repeating
install, link, scaffold, or environment pull.

## 3. Report the context

Read `manifest-context.json` from the repository root and summarize: plan
name/ID, environment, repository path, module → suite → case counts, and how
many recorded sessions are referenced. Never print `.env` values; never paste
the whole manifest into chat when a summary answers.

From here the user typically continues with `/voidr-generate` (implement
cases from this manifest) or `/voidr-execute` (run what is already
automated).

## Tool routing

- `applications_list_applications` — application selection; required before
  listing plans, since the bridge refuses a listing without an `applicationId`.
- `test_plans_list_test_plans` — plan selection listing for the selected
  application (read-only).
- `voidr_context_bootstrap` — the atomic context + preparation gate. It is
  the ONLY setup path: never call prepare/scaffold tools separately from this
  skill.
- `voidr_context_refresh` — the lightweight freshness gate used by
  `/voidr-generate` after setup; it rewrites the manifest but performs no
  framework preparation.
