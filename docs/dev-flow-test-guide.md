# Roteiro de teste — fluxo dev-first `/voidr-test` (0.2.19-local.25)

Objetivo: validar na UI do Copilot a experiência "desenvolvi a feat → criar
teste → rodar → analisar → corrigir" sem vocabulário de plataforma.

## 0. Pré-requisitos

- Node 22 ativo no shell (`node --version` → v22.x). Com Node 24 o preflight
  deve falhar com erro claro — isso é um dos testes, não um bloqueio.
- Service Account com escopo `write` em `~/.voidr/service-accounts.json`
  (ou conectar via `/copilot voidr-connect` durante o teste).
- Um repositório de produto com uma feature em branch, com diff real contra a
  default branch (ex.: `feat/login-mfa`). Sem diff, o fluxo cai no fallback de
  perguntar a feature — também vale testar, mas o caminho feliz precisa do
  branch.
- VS Code aberto no workspace do produto (nunca no repositório do plugin).
- Para simular primeiro acesso sem tocar na credencial real:
  `VOIDR_CREDENTIAL_PROFILE=qa-teste` no ambiente do Copilot.

## 1. Instalar a build local

```sh
cd <worktree voidr-copilot-local>
npm run check
copilot plugin marketplace add .
copilot plugin install copilot@voidrco
copilot plugin list        # deve mostrar copilot@voidrco 0.2.19-local.25
copilot mcp get voidr --json
```

Reinicie o VS Code depois de instalar (os hooks só carregam em sessão nova) e
abra um chat novo. Se as tools `voidr_*` não aparecerem, recarregue o plugin e
abra outro chat antes de investigar qualquer outra coisa.

## 2. Caminho feliz

1. No chat novo, digite exatamente: `cria os testes da minha feature`.
   - ✅ Deve carregar `/voidr-test` direto — **sem** perguntar "Test Plan novo
     ou existente".
   - ✅ Auth validada em silêncio (nenhuma pergunta se a credencial está ok).
2. Card único de confirmação.
   - ✅ Feature inferida do branch/diff, em linguagem humana.
   - ✅ App e ambiente auto-selecionados quando só existe um; caso contrário,
     opções selecionáveis (`ask_user`), não lista de texto.
   - ✅ Nenhuma menção a Test Plan, scaffold, suite, slug.
   - Teste o `Ajustar algo`: deve perguntar só o que mudar, sem repetir tudo.
3. Continuar → lista de cenários.
   - ✅ Linguagem simples ("login com MFA válido redireciona…").
   - ✅ Dados de teste apenas como `{{env.VARIAVEL}}` — nenhum valor literal
     do código no chat.
4. Digite exatamente `Criar testes`.
   - ✅ Encanamento silencioso: plano criado/reusado sem aparecer, clone do
     repositório (pergunta o destino só na primeira vez), preparação,
     implementação das specs.
   - ✅ Progresso em linhas curtas, não narração tool a tool.
5. Smoke roda automaticamente ao fim da implementação.
   - ✅ Resultado por cenário, falhas classificadas (teste × produto ×
     dado/ambiente) com a linha de erro.
   - ✅ O agente **para** depois do resultado — não edita nem re-roda sozinho.
6. Se algo falhou: `corrige e roda de novo`.
   - ✅ Uma investigação + uma nova execução por mensagem sua.
7. Tudo verde: aceite as ofertas de commit → push → PR (cada uma com
   autorização própria). Após mergear o PR, avise no chat.
   - ✅ Publicação imutável + execução na plataforma com as confirmações do
     `/voidr-deploy-run`, traduzidas ("Publicar os testes na Voidr?").

## 3. Guardas (testes negativos rápidos)

| Ação | Esperado |
| --- | --- |
| Antes de aprovar, pedir "já cria o plano aí" | Bloqueado pedindo a mensagem `Criar testes` |
| Responder `sim` ou `pode criar` no gate | Não destrava; só `Criar testes` exato |
| Dizer "vou criar testes amanhã" em outra conversa | Não conta como aprovação nem inicia fluxo |
| Pedir `cat .env` durante o fluxo | Negado pelo hook (nunca ler/imprimir .env) |
| Pedir pra trocar registry/apagar lockfile após falha de install | Negado; agente deve pedir rede uma única vez |
| Rodar com Node 24 ativo | Preparação/smoke falham com erro claro, sem travar |
| Segunda feature na mesma app (chat novo) | Reusa o plano da aplicação (módulo novo); não cria plano duplicado |
| `Quero desenvolver testes na Voidr` | Fluxo clássico intacto: pergunta novo × existente |

## 4. BUG-006 (workspace root) — atenção especial

Durante o clone/seleção do repositório de testes, confira que nada é criado em
`~/.copilot/installed-plugins/`. Se o bridge reportar que não consegue
resolver a raiz do workspace, o agente deve repetir a chamada passando
`workspaceRoot` com o caminho do workspace aberto — se ele não fizer isso
sozinho, cole o caminho no chat e registre como achado.

## 5. Registro

Anote resultados e desvios no checklist de
[full-flow-qa-2026-07-30.md](full-flow-qa-2026-07-30.md) (seção "Checklist
pendente do plugin"). Qualquer texto com vocabulário de plataforma ou pergunta
redundante no fluxo dev é bug de UX — registrar com o print da mensagem.
