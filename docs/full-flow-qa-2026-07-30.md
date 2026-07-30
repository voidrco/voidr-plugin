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
Status: corrigido em `0.2.19-local.24`; pendente validação na UI

Correção: mesmo mecanismo do BUG-014 (bloqueio de leitura de fontes com
credenciais e de escrita de Test Plan com valores literais) mais o contrato de
segredos no skill `voidr-develop-tests`: nunca reproduzir credenciais/PII em
chat, resumo, draft ou spec; registrar apenas nomes de variáveis como
`{{env.*}}`.

Ao analisar o repositório de produto, o agente exibiu credenciais de demonstração literalmente e as reutilizou nos passos Arrange/Act do draft.

Comportamento esperado:

- nunca reproduzir credenciais ou PII descobertas na codebase;
- substituir valores por placeholders, por exemplo `{{env.TEST_EMAIL}}` e `{{env.TEST_PASSWORD}}`;
- registrar somente os nomes das variáveis necessárias;
- impedir `test_plans_create_test_plan` e `test_plans_populate_test_plan` quando o draft contiver valores sensíveis literais.

### BUG-002 — Opções do fluxo aparecem como texto livre

Severidade: média
Status: mitigado em `0.2.19-local.24`; pendente validação na UI

Correção: contrato de seleção explícito no início do skill
`voidr-develop-tests` (toda escolha via `ask_user` quando disponível, texto
livre apenas como fallback declarado) e reforço no roteador de prompt. Não há
como o hook forçar o controle da UI; validação continua manual.

Novo/existente, aplicação, ambiente, repositório e demais gates foram apresentados como listas de texto, exigindo que o usuário digitasse a resposta.

Comportamento esperado:

- usar controles selecionáveis do Copilot quando disponíveis;
- manter a resposta textual apenas como fallback.

### BUG-003 — Falha de criação causou troca automática para Test Plan existente

Severidade: alta
Status: corrigido em `0.2.19-local.24` e validado por testes

Correção: a ponte MCP marca a sessão após uma falha de
`test_plans_create_test_plan` e bloqueia `test_plans_list_test_plans` antes de
qualquer chamada remota (retry explícito da mesma criação continua possível);
o hook de runtime bloqueia a listagem sempre que o modo escolhido é
“Criar novo Test Plan”; o skill exige mostrar o erro exato e oferecer somente
retry ou cancelamento. Trocar para plano existente exige nova mensagem
explícita do usuário.

Depois de falhar repetidamente em `test_plans_create_test_plan`, o agente listou Test Plans existentes e escolheu um deles, apesar de o usuário ter selecionado explicitamente “Criar novo Test Plan”.

Comportamento esperado:

- interromper o fluxo;
- exibir o erro real retornado pela tool;
- oferecer retry ou cancelamento;
- nunca mudar de novo para existente sem nova decisão humana.

### BUG-004 — Estado “primeiro acesso” não estava realmente isolado

Severidade: média
Status: corrigido em `0.2.19-local.24`

Correção: `voidr_auth_status` agora expõe `credentialStore` (caminho do
arquivo ativo) e `credentialProfile`; o skill `voidr-connect` mostra o store
ativo e nunca infere ausência de conta sem o status. Teste isolado usa
`VOIDR_CREDENTIAL_PROFILE` (arquivo `service-accounts.<profile>.json`) ou
`VOIDR_SERVICE_ACCOUNTS_PATH`.

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
Status: corrigido em `0.2.19-local.24` e validado por testes; pendente
validação na UI

Correção: o bridge nunca aceita a instalação do plugin como raiz
(`resolveWorkspaceRoot` descarta candidatos dentro da instalação e, sem
candidato válido, falha pedindo `workspaceRoot` explícito — novo parâmetro em
`voidr_workspace_inspect`, `voidr_workspace_select_test_repository` e
`voidr_workspace_bootstrap_test_repository`). Toda validação de repositório
rejeita caminhos dentro da instalação, e o hook de runtime nega seleção e
escrita de arquivos lá, mesmo em ferramentas genéricas.

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
Status: corrigido em `0.2.19-local.24` e validado por testes

Correção: os comandos do bridge classificam falhas de rede
(`EAI_AGAIN`/`ENOTFOUND`/`ETIMEDOUT` etc.) com mensagem explícita de sandbox
sem rede e instrução de pedir uma única reexecução com rede; o hook de runtime
bloqueia mudanças de registry, cache, lockfile, `--legacy-peer-deps` e
`--force` durante o workflow; o skill documenta o procedimento.

`npm install` falhou dentro do sandbox sem acesso à rede. O agente afirmou que havia
bloqueio do registry, tentou `--legacy-peer-deps`, `--force`, outros gerenciadores e
limpeza do cache. A mesma instalação concluiu normalmente no terminal com rede.

Comportamento esperado:

- identificar explicitamente a restrição do sandbox;
- solicitar execução com rede uma única vez;
- não alterar cache, registry, lockfile ou estratégia de dependências sem evidência.

### BUG-008 — Scripts `voidr:*` apontam para CLI ausente no template

Severidade: alta
Status: corrigido no plugin em `0.2.19-local.24` e validado por testes

Correção: o bridge não depende mais dos scripts `voidr:*` do repositório —
scaffold, build do smoke e build da release invocam `npx --no-install voidr`
diretamente, funcionando mesmo quando o skeleton provisionado referencia
`.voidr/cli/voidr.js` ausente. Corrigir o skeleton em si continua sendo
mudança do serviço.

O `package.json` gerado contém scripts que executam `.voidr/cli/voidr.js`, mas a pasta
`.voidr` não foi incluída no repositório. O binário instalado em
`@voidrco/playwright` funciona por `npx voidr`.

Comportamento esperado:

- os scripts devem chamar `voidr`/`npx voidr`, ou
- o template deve incluir todos os arquivos `.voidr` referenciados.

### BUG-009 — Agente imprime o conteúdo do `.env` no histórico

Severidade: crítica
Status: corrigido em `0.2.19-local.24` e validado por testes

Correção: além do bloqueio de read-tools (BUG-014), o hook agora nega comandos
de shell que leem ou imprimem `.env*` (`cat`, `head`, `grep`, `sed`, `source`
etc.) durante o workflow, orientando validar apenas existência, permissões e
nomes de chaves, e recomendar rotação quando houver exposição.

Depois de `voidr env pull`, o agente executou `cat .env` para diagnosticar o arquivo.
Isso pode revelar os segredos retornados pela plataforma no histórico do Copilot.

Comportamento esperado:

- nunca ler ou imprimir valores de `.env`;
- validar somente existência, permissões e nomes das chaves;
- mascarar qualquer saída acidental e recomendar rotação quando houver exposição.

### BUG-010 — Playwright 1.48 fica bloqueado com Node 24

Severidade: média
Status: corrigido em `0.2.19-local.24` e validado por testes

Correção: `voidr_workspace_prepare_test_repository` e `voidr_smoke_build`
validam o runtime Node efetivo (via `node --version` no diretório do
repositório) antes de instalar dependências ou executar Playwright. O pin do
`volta` no `package.json` é autoritativo; sem pin, exige-se Node 22. Versão
incompatível falha imediatamente com erro claro, sem travar.

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

### BUG-016 — Agente decide que o checkout linkado não existe após shell falhar

Severidade: bloqueadora
Status: corrigido em `0.2.19-local.26` e validado por testes; pendente
validação na UI

No teste do fluxo dev (`local.25`, modelo Claude Haiku 4.5), o agente procurou
o repositório de testes com `find`/`ls` no shell; o comando falhou no sandbox
("No output was produced") e ele concluiu que não havia checkout — sendo que
`voidr-tests-serasa` existia no workspace com `project.json`. Em seguida tentou
bootstrap, bloqueado pelo guard do BUG-006 (sem `workspaceRoot`), e parou sem
seguir a instrução de retry do skill.

Correção (mecânica, não instrucional):

- `voidr_workspace_bootstrap_test_repository` escaneia o workspace por um
  checkout cuja `origin` bata com o `repositoryUrl` linkado e retorna
  `reusedExistingCheckout: true` com o caminho existente antes de criar
  qualquer coisa — a crença do modelo deixa de importar;
- o hook nega `voidr_workspace_inspect`/`select`/`bootstrap` sem
  `workspaceRoot` injetando o cwd real do VS Code na mensagem de bloqueio
  (o valor exato aparece no contexto do modelo para copiar);
- os skills proíbem localizar repositório via `find`/`ls` e declaram que
  saída vazia/falha de shell não é evidência de ausência.

Observação: o cliente usa Claude Haiku 4.5 no Copilot — aderência fraca a
instruções de skill; todo gate relevante precisa ser mecânico (tool/hook).

### BUG-017 — Agente inventa slug de suite e re-tenta o mesmo not-found

Severidade: alta
Status: corrigido em `0.2.19-local.27` e validado por testes; pendente
validação na UI

No fluxo dev (`local.26`, Haiku 4.5), após criar módulo e suite, o agente
referenciou a suite como `LIMITE` no `test_plans_create_case` — identificador
inventado, diferente do slug retornado pelo `create_suite` — e, diante do
erro `Suite with identifier 'LIMITE' not found`, repetiu a mesma chamada com
o mesmo slug errado.

Correção (mecânica, no bridge):

- os slugs retornados por `test_plans_create_module`/`create_suite` são
  registrados por sessão; um `create_case` que referencia uma suite
  inexistente em módulo criado na sessão é bloqueado antes da rede, com os
  slugs válidos na mensagem;
- identificador que já falhou com not-found não pode ser repetido na sessão
  (bloqueio pré-rede orientando `test_plans_get_test_plan`);
- erros not-found de estrutura voltam enriquecidos com os slugs conhecidos
  da sessão;
- o skill `/voidr-test` exige usar exatamente o `slug` retornado por cada
  criação.

## Próximo checkpoint

A criação, a população anonimizada, o provisionamento, a materialização e o smoke local
foram validados. Ainda falta registrar:

- commits e PR usados no deploy;
- versão imutável candidata;
- confirmação de que `latest` aponta para a candidata;
- execução e resultado final na plataforma.

## Checklist pendente do plugin

### Ajustes

- [ ] Reinstalar `0.2.19-local.24`, reiniciar o VS Code e validar os novos hooks
  pela UI do Copilot.
- [ ] Validar na UI os fixes de `0.2.19-local.24`: workspace root real
  (BUG-006), bloqueio de `cat .env` (BUG-009), sem fallback novo→existente
  após falha de criação (BUG-003), diagnóstico de sandbox sem rede (BUG-007),
  `npx voidr` direto sem scripts do skeleton (BUG-008) e erro claro de Node
  incompatível (BUG-010).
- [ ] Validar na UI o fluxo dev-first `/voidr-test` (`0.2.19-local.25`):
  "cria os testes da minha feature" a partir de um branch de feat → card
  único de confirmação → cenários em linguagem simples → `Criar testes` →
  implementação + smoke automático → correção sob demanda → PR → publicação
  e execução. Conferir que nenhum vocabulário de plataforma (Test Plan,
  scaffold, suite, slug) aparece nas mensagens e que o plano é reusado por
  aplicação (módulo novo por feature).
- [ ] Validar que arquivos com credenciais, PII e `.env*` não são lidos durante
  o planejamento.
- [ ] Validar que nenhuma edição local ocorre antes da seleção e preparação do
  repositório de testes.
- [ ] Usar perguntas selecionáveis para aplicação, ambiente, Test Plan e
  repositório quando esse controle estiver disponível no Copilot.
- [ ] Melhorar mensagens de erro para impedir tentativas aleatórias, diagnósticos
  inventados e fallbacks silenciosos.
- [ ] Validar primeiro acesso, Service Account ausente, Service Account revogada
  e conta somente leitura.
- [ ] Resolver ou documentar o callback Auth0 para ambientes não produtivos.
- [ ] Confirmar o comportamento quando o Copilot está em sandbox sem rede,
  sem trocar registry, lockfile, cache ou gerenciador de pacotes.
- [ ] Garantir o uso de Node 22 antes de instalar dependências ou executar
  Playwright.
- [ ] Confirmar que o workspace real do VS Code é preservado pelo bridge MCP e
  que nenhum repositório é criado dentro da instalação do plugin.

### Desenvolvimento

- [ ] Garantir que a criação do Test Plan sempre retorne o link e o clone URL do
  repositório provisionado.
- [ ] Consolidar a preparação obrigatória do repositório na ordem:
  dependências, autenticação interna do framework, `voidr link` quando não
  existir `project.json`, `voidr scaffold` e `voidr env pull`.
- [ ] Nunca executar `npx voidr login` de forma interativa durante a preparação;
  reutilizar internamente a credencial validada pelo `voidr-connect`.
- [ ] Validar o `project.json` existente contra o Test Plan selecionado e
  interromper em caso de divergência.
- [ ] Implementar somente módulos, suites e casos presentes no draft aprovado.
- [ ] Garantir que specs nunca contenham credenciais, e-mails, CPF, CNPJ,
  telefones ou outros identificadores literais.
- [ ] Remover fallbacks literais de variáveis de ambiente nas specs.
- [ ] Obter endpoints de API da configuração real do produto, sem derivá-los da
  URL do frontend.
- [ ] Finalizar o fluxo assistido de commit, push, PR e merge.
- [ ] Exigir PR mergeado na branch principal antes do deploy.
- [ ] Produzir uma versão imutável vinculada ao commit mergeado.
- [ ] Promover a candidata para `latest` e confirmar por leitura independente
  que `latest` aponta para a versão esperada.
- [ ] Integrar a execução na plataforma e retornar link, status e resultado.
- [ ] Publicar uma versão instalável do plugin sem o sufixo `local`.

### Fluxos que ainda precisam de validação completa

- [ ] Reinstalar o plugin publicado na branch e confirmar a versão carregada
  pelo Copilot.
- [ ] Executar o fluxo de criação de um novo Test Plan desde uma conversa nova.
- [ ] Confirmar autenticação antes de acessar aplicação, Test Plan ou codebase.
- [ ] Selecionar a aplicação usando os dados retornados pela plataforma.
- [ ] Selecionar um ambiente retornado pela plataforma e tratar separadamente a
  URL escolhida para o smoke local.
- [ ] Perguntar qual feature ou jornada será testada.
- [ ] Perguntar quais insumos devem fundamentar o planejamento.
- [ ] Analisar somente o repositório de produto explicitamente escolhido e
  mantê-lo somente leitura.
- [ ] Apresentar um resumo anonimizado dos insumos e aguardar uma nova mensagem
  com `Confirmar insumos do planejamento`.
- [ ] Apresentar o draft completo e aguardar uma nova mensagem com
  `Aprovo este Test Plan`.
- [ ] Criar e popular o Test Plan somente depois dos dois gates humanos.
- [ ] Confirmar que a plataforma criou e vinculou o repositório automaticamente.
- [ ] Clonar ou selecionar exatamente o repositório vinculado.
- [ ] Executar a preparação obrigatória na ordem definida.
- [ ] Implementar somente os casos aprovados.
- [ ] Executar uma única tentativa de smoke e parar para apresentar o resultado.
- [ ] Validar smoke com sucesso.
- [ ] Validar smoke com falha sem edição, diagnóstico ou retry automático no
  mesmo turno.
- [ ] Obter autorização separada antes de commit, push e criação do PR.
- [ ] Fazer merge na branch principal com autorização explícita.
- [ ] Fazer deploy imutável do commit mergeado.
- [ ] Confirmar a promoção para `latest`.
- [ ] Criar a execução na plataforma e acompanhar o resultado final no Voidr
  Monitor.
- [ ] Executar o caminho de Test Plan existente sem substituir silenciosamente
  o ID selecionado.
- [ ] Executar o caminho sem Service Account e confirmar o redirecionamento para
  `voidr-connect`.
- [ ] Executar com Service Account sem permissão de escrita.
- [ ] Simular falha no provisionamento e validar rollback do Test Plan e do
  repositório.
- [ ] Executar contra uma codebase com dados sensíveis e confirmar que nenhum
  valor aparece no chat, draft, spec ou plataforma.
- [ ] Validar o fluxo em um workspace com vários produtos e vários repositórios
  de testes.
