# QA do fluxo completo do plugin Copilot

Data: 2026-07-30
Ambiente: plugin `0.2.19-local.23`, plataforma de login em produção, API/MCP e auth locais, dados de staging.

## Escopo

Validar o fluxo iniciado por `/copilot voidr-develop-tests`:

1. conexão;
2. seleção de Test Plan novo ou existente;
3. seleção de aplicação e ambiente pela plataforma;
4. escolha da feature e do alvo do smoke local;
5. coleta de insumos;
6. análise da codebase;
7. draft e aprovação humana;
8. criação e população do Test Plan;
9. provisionamento e materialização do repositório;
10. implementação;
11. PR e merge;
12. deploy imutável e promoção para `latest`;
13. execução na plataforma.

## Resultado parcial confirmado

- `voidr-connect` validou uma Service Account existente com escopos `read` e `write`.
- O fluxo perguntou novo versus existente antes de consultar ou alterar Test Plans.
- A aplicação foi listada pela tool `applications_list_applications`.
- O ambiente foi carregado pela tool `applications_list_environments`.
- O tipo WEB veio da aplicação, sem pergunta redundante ao usuário.
- O fluxo perguntou a feature antes de gerar o planejamento.
- O ambiente da plataforma e a URL de smoke local foram tratados separadamente.
- O fluxo perguntou quais insumos deveriam fundamentar o Test Plan.
- A inspeção do workspace foi feita por `voidr_workspace_inspect`.
- O usuário precisou escolher explicitamente qual repositório de produto analisar.
- Um draft visível foi apresentado antes da escrita.
- O fluxo parou no gate que exige uma nova mensagem humana com a frase exata `Aprovo este Test Plan`.
- O Test Plan foi criado em `DRAFT` depois da aprovação explícita.
- A primeira população com dados literais foi bloqueada; a nova população, somente com
  placeholders `{{env.*}}`, concluiu com 5 módulos, 5 suites e 12 casos.
- O repositório privado foi provisionado automaticamente na branch `main` e retornado
  pelo fluxo.
- O repositório foi clonado dentro do workspace e as dependências foram instaladas.
- Um smoke único, sem PII ou credenciais literais, passou localmente contra o ambiente
  de produção usando Node 22.

## Bugs encontrados

### BUG-001 — Credenciais copiadas da codebase para o chat e para o draft

Severidade: crítica
Status: reproduzido

Ao analisar o repositório de produto, o agente exibiu credenciais de demonstração literalmente e as reutilizou nos passos Arrange/Act do draft.

Comportamento esperado:

- nunca reproduzir credenciais ou PII descobertas na codebase;
- substituir valores por placeholders, por exemplo `{{env.TEST_EMAIL}}` e `{{env.TEST_PASSWORD}}`;
- registrar somente os nomes das variáveis necessárias;
- impedir `test_plans_create_test_plan` e `test_plans_populate_test_plan` quando o draft contiver valores sensíveis literais.

### BUG-002 — Opções do fluxo aparecem como texto livre

Severidade: média
Status: reproduzido

Novo/existente, aplicação, ambiente, repositório e demais gates foram apresentados como listas de texto, exigindo que o usuário digitasse a resposta.

Comportamento esperado:

- usar controles selecionáveis do Copilot quando disponíveis;
- manter a resposta textual apenas como fallback.

### BUG-003 — Falha de criação causou troca automática para Test Plan existente

Severidade: alta
Status: reproduzido em execução anterior

Depois de falhar repetidamente em `test_plans_create_test_plan`, o agente listou Test Plans existentes e escolheu um deles, apesar de o usuário ter selecionado explicitamente “Criar novo Test Plan”.

Comportamento esperado:

- interromper o fluxo;
- exibir o erro real retornado pela tool;
- oferecer retry ou cancelamento;
- nunca mudar de novo para existente sem nova decisão humana.

### BUG-004 — Estado “primeiro acesso” não estava realmente isolado

Severidade: média
Status: reproduzido

O perfil local já continha uma Service Account válida, embora o ambiente tivesse sido tratado inicialmente como zerado.

Comportamento esperado:

- mostrar claramente o arquivo/perfil de credenciais ativo antes do teste;
- oferecer um modo de teste isolado com profile novo;
- nunca inferir ausência de conta sem executar `voidr_auth_status`.

### BUG-005 — Provisionamento do skeleton falha em repositório GitHub vazio

Severidade: bloqueadora
Status: reproduzido; correção local em validação

`test_plans_create_test_plan` criou o documento e o repositório privado, mas a cópia do
skeleton falhou com HTTP `409` na primeira escrita em `/git/blobs`. O serviço criava o
repositório com `auto_init: false` e tentava usar a Git Database API enquanto ele ainda
estava vazio.

O rollback atômico funcionou:

- o repositório GitHub recém-criado foi removido;
- o Test Plan incompleto foi removido;
- nenhuma criação parcial ficou disponível na plataforma.

Comportamento esperado:

- inicializar o repositório vazio pela Contents API antes de usar a Git Database API;
- substituir a árvore temporária pela árvore completa do skeleton;
- manter o rollback de Test Plan e repositório em qualquer falha posterior;
- retornar ao Copilot a causa específica, sem retry com outro nome e sem fallback para
  um Test Plan existente.

### BUG-006 — MCP resolve o workspace como a pasta instalada do plugin

Severidade: bloqueadora
Status: reproduzido

Mesmo com o VS Code aberto em `/Users/erikcordeiro/Teste - Plugin Copilot`, a tool de
seleção de repositório resolveu o workspace como a pasta interna
`~/.copilot/installed-plugins/voidrco/copilot`. O repositório clonado corretamente no
workspace foi rejeitado e o agente tentou cloná-lo novamente dentro da instalação do
plugin.

Comportamento esperado:

- o bridge deve receber e preservar a raiz real do workspace do VS Code;
- a seleção deve aceitar apenas caminhos contidos nessa raiz;
- nunca sugerir nem gravar repositórios de teste dentro da instalação do plugin.

### BUG-007 — Falha de rede do sandbox gera diagnóstico e fallbacks incorretos

Severidade: alta
Status: reproduzido

`npm install` falhou dentro do sandbox sem acesso à rede. O agente afirmou que havia
bloqueio do registry, tentou `--legacy-peer-deps`, `--force`, outros gerenciadores e
limpeza do cache. A mesma instalação concluiu normalmente no terminal com rede.

Comportamento esperado:

- identificar explicitamente a restrição do sandbox;
- solicitar execução com rede uma única vez;
- não alterar cache, registry, lockfile ou estratégia de dependências sem evidência.

### BUG-008 — Scripts `voidr:*` apontam para CLI ausente no template

Severidade: alta
Status: reproduzido

O `package.json` gerado contém scripts que executam `.voidr/cli/voidr.js`, mas a pasta
`.voidr` não foi incluída no repositório. O binário instalado em
`@voidrco/playwright` funciona por `npx voidr`.

Comportamento esperado:

- os scripts devem chamar `voidr`/`npx voidr`, ou
- o template deve incluir todos os arquivos `.voidr` referenciados.

### BUG-009 — Agente imprime o conteúdo do `.env` no histórico

Severidade: crítica
Status: reproduzido

Depois de `voidr env pull`, o agente executou `cat .env` para diagnosticar o arquivo.
Isso pode revelar os segredos retornados pela plataforma no histórico do Copilot.

Comportamento esperado:

- nunca ler ou imprimir valores de `.env`;
- validar somente existência, permissões e nomes das chaves;
- mascarar qualquer saída acidental e recomendar rotação quando houver exposição.

### BUG-010 — Playwright 1.48 fica bloqueado com Node 24

Severidade: média
Status: reproduzido

O processo ficou indefinidamente parado antes de listar ou iniciar workers usando Node
24.13.1. Com a versão declarada no `volta` (`22.22.0`), a listagem foi imediata e o
smoke passou em 12,5 segundos.

Comportamento esperado:

- aplicar automaticamente a versão de Node declarada pelo projeto;
- validar a versão antes de instalar ou executar;
- encerrar com erro claro em versões incompatíveis, sem ficar bloqueado.

### BUG-011 — Agente tenta corrigir e repetir o smoke no mesmo turno

Severidade: alta
Status: reproduzido; correção local validada por testes

Depois da primeira falha de `voidr_smoke_build`, o agente inferiu causas,
alterou specs e solicitou um novo smoke sem apresentar primeiro o resultado
exato ao usuário.

Comportamento esperado:

- uma única tentativa de smoke por mensagem do usuário;
- apresentar o resultado exato e parar;
- investigar, editar ou repetir somente após uma nova solicitação explícita.

### BUG-012 — Specs recebem fallbacks literais e confundem frontend com API

Severidade: crítica
Status: reproduzido; correção local validada por testes

O agente tentou persistir dados de autenticação como fallback de variáveis de
ambiente e montou rotas de API usando a origem do frontend.

Comportamento esperado:

- nenhuma credencial, e-mail ou PII literal em specs;
- variáveis obrigatórias sem fallback literal;
- endpoint de API obtido da configuração real do produto;
- nunca derivar a API de `window.location.origin` ou da `baseURL` do frontend.

### BUG-013 — Test Plan ausente é substituído silenciosamente

Severidade: crítica
Status: corrigido e validado na UI com `0.2.19-local.22`

O ID de Test Plan informado pelo usuário não existia no ambiente de produção.
Após a leitura retornar not-found, o agente listou outros planos e adotou outro
ID sem uma nova escolha humana.

Comportamento esperado:

- manter o ID explicitamente selecionado durante todo o fluxo;
- parar e reportar quando ele não existir no ambiente atual;
- nunca listar, procurar por nome semelhante ou substituir o plano no mesmo
  turno;
- aceitar outro ID somente em uma nova mensagem explícita do usuário.

Validação:

- o Test Plan inexistente foi consultado exatamente pelo ID informado;
- a tentativa posterior de `test_plans_list_test_plans` foi bloqueada pela
  ponte MCP antes da chamada remota;
- o agente parou e solicitou um novo ID explícito;
- nenhuma seleção de repositório, preparação, escrita de arquivo ou mutação na
  plataforma ocorreu.

### BUG-014 — Pesquisa da codebase expõe valores sensíveis no planejamento

Severidade: crítica
Status: corrigido e validado por testes em `0.2.19-local.23`

Durante a análise do repositório de produto, o agente leu um arquivo que continha
identificadores pessoais e credenciais literais. Os valores foram reproduzidos no
resumo dos insumos e reapareceram como exemplos no draft.

Comportamento esperado:

- bloquear a leitura de `.env*` e de arquivos com credenciais ou identificadores
  pessoais literais durante a pesquisa;
- continuar a análise por rotas, schemas e interfaces públicas;
- permitir somente placeholders `{{env.*}}` no resumo, draft e escrita na
  plataforma;
- bloquear Test Plan com e-mail, CPF, CNPJ ou credencial literal.

Validação:

- leitura de arquivo público sem dados sensíveis permanece permitida;
- leitura de `.env*` e de fonte com credenciais literais é bloqueada no hook;
- escrita de Test Plan com valor sensível literal é bloqueada;
- escrita contendo somente placeholders permanece permitida após os gates humanos.

### BUG-015 — Agente altera arquivos antes da seleção do repositório de testes

Severidade: alta
Status: corrigido e validado por testes em `0.2.19-local.23`

Ao receber a correção do draft, o agente deixou o fluxo de planejamento, tentou criar
memória/política própria e editou `.env.example` antes de existir um repositório de
testes selecionado.

Comportamento esperado:

- codebase de produto sempre somente leitura;
- nenhuma criação, edição ou remoção local antes de selecionar e preparar o
  repositório vinculado ao Test Plan;
- nenhuma escrita em memória, README, fixtures ou templates para contornar o gate;
- tools oficiais da plataforma continuam autorizadas para criar e popular o plano
  antes da materialização local.

Validação:

- edições locais antes da seleção são bloqueadas;
- as tools oficiais de Test Plan não são confundidas com editores locais;
- depois da seleção, o limite de escrita permanece restrito ao repositório de testes.

## Próximo checkpoint

A criação, a população anonimizada, o provisionamento, a materialização e o smoke local
foram validados. Ainda falta registrar:

- commits e PR usados no deploy;
- versão imutável candidata;
- confirmação de que `latest` aponta para a candidata;
- execução e resultado final na plataforma.
