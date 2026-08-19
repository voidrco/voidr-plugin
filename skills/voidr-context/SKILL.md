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

- If the user already named a plan or pasted its 24-hex ID, use it.
- Otherwise list with `test_plans_list_test_plans` and render the choice with
  `ask_user` (name + status + case count). Never ask the user to type an ID.

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
   environments. Render the returned listing with `ask_user` and call the
   tool again with the chosen `environmentSlug`.
2. **Clone handover message** — the checkout does not exist and the plugin
   never clones on the user's behalf. Relay the message exactly as it came
   (commands, destination, authorization guidance), wait for the user to
   confirm the clone, then call the tool again.
3. **Preparation failure** — report the failing step as the tool named it.
   Do not run Git or setup commands manually. A Node-runtime message follows
   the shared Node contract.

The call is idempotent: repeating it continues from the current state and
updates the manifest in place.

## 3. Report the context

Read `manifest-context.json` from the repository root and summarize: plan
name/ID, environment, repository path, module → suite → case counts, and how
many recorded sessions are referenced. Never print `.env` values; never paste
the whole manifest into chat when a summary answers.

From here the user typically continues with `/voidr-generate` (implement
cases from this manifest) or `/voidr-execute` (run what is already
automated).

## Tool routing

- `test_plans_list_test_plans` — plan selection listing (read-only).
- `voidr_context_bootstrap` — the atomic context + preparation gate. It is
  the ONLY setup path: never call prepare/scaffold tools separately from this
  skill, and never run npm, git, or the Voidr CLI in the terminal.
