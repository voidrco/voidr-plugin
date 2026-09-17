# DX: composição de relatórios técnicos

O leitor precisa localizar a falha e preparar uma reprodução. A AI escolhe a ordem,
a evidência principal e os componentes; o serviço gera o HTML responsivo e a versão
impressa, usando o mesmo documento estruturado. Leia o schema atual da ferramenta.

## Unidade de evidência

Uma execução contém casos, tentativas e etapas. Uma etapa pode repetir uma ação e
produzir várias requisições. Não conte essas unidades como equivalentes.
Use fontes distintas E1, E2… para observações distintas, mesmo na mesma execução,
e acrescente `locator` com `testCaseSlug`, `attempt`, `step`, `recordedAt` e `artifact`
quando disponíveis. Uma afirmação sobre a tentativa 2 deve apontar à evidência da
mesma tentativa. Referências da execução saudável não sustentam a execução com falha.

Uma mensagem do teste que cita 503 não equivale à captura de uma resposta HTTP desse
endpoint. Preserve a origem: resultado do teste, console, rede, DOM ou screenshot.
Os fatos continuam sujeitos à revisão: o renderer garante formato e referência,
não confirma causalidade nem a veracidade do que o modelo escreveu.

## Seleção e ritmo

- Abra com o comportamento afetado, ambiente e consequência observada em até 3 frases.
- Não crie outra seção de resumo/abertura que repita essa descrição.
- Prefira 3–5 seções: evidência principal, sequência, reprodução, impacto/limites.
  Se a investigação não requer todas, omita. Em geral 350–650 palavras de narrativa;
  preserve snippets e screenshots necessários mesmo que aumentem a extensão.
- Use `finding` para observação, hipótese ou limite. `hypothesis` exige
  `verificationGap`: qual evidência falta para confirmar.
- Use `timeline` para tentativas e etapas com desfechos, instantes e fontes próprios.
  Explicite UTC/offset e mantenha a ordem temporal. Não invente totais ou percentuais.
- Use tabela para comparações equivalentes; evite listas de IDs em tabelas largas.
- Fontes e navegação são automáticas: não as replique como parágrafos do relatório.

## Reprodução e cURL

Use `reproduction` com pré-condições, passos, esperado, observado e limitações.
`provenance` é `captured` (campos derivados da captura, sem reprodução nova),
`adapted` (exemplo técnico adaptado) ou `validated` (há execução registrada da
reprodução específica, citada nas fontes). Ter uma requisição capturada não prova
que um cURL isolado reproduz um fluxo de navegador.

O servidor constrói cURL a partir de `request`, evitando código shell arbitrário.
Informe apenas método, caminho sem domínio/query, headers Accept/Content-Type,
autenticação `none` ou `bearer-placeholder` e corpo sanitizado, quando conhecidos.
O exemplo usa BASE_URL e TOKEN como variáveis e nunca é executado ao copiar.
Para query strings ou autenticação de sessão complexa, descreva a preparação nos
passos e declare a limitação; não invente um cURL completo. Sem request suficiente,
omita `request` e documente a reprodução de UI. `response` só entra quando capturada.
O relatório não autoriza executar requisições, testes ou alterações em produção.

## Screenshots reais

Consulte `playwright_list_test_frames` para obter o `resourceName` exato de um frame
relacionado à falha; `playwright_analyze_frames_vision` ajuda a examinar o conteúdo.
Use `frame: {sourceId, testCaseSlug, resourceName}` no bloco `screenshot` para que o
servidor busque a imagem no armazenamento privado após validar tenant e aplicação.
Nunca transforme `frameUrl` em URL pública nem copie tokens. Se a evidência já tem
bytes PNG/JPEG revisados, `base64` continua disponível em lugar de `frame`.

Revise dados sensíveis antes de incluir a captura. `redactions` e `highlights` são
retângulos normalizados (x, y, width, height, entre 0 e 1). O serviço aplica máscaras
opacas permanentemente à cópia entregue. Destaques contornam o elemento relevante.
Legenda: estado visível + etapa + instante, quando conhecido. Não conclua um status
HTTP apenas pela tela. Até 4 capturas, preferindo a falha e um estado de comparação.
Se o material não tem capturas ou não permite revisar/mascarar com segurança, declare
essa ausência. Nunca gere uma imagem artificial para representar evidência original.

## Share

O link retornado abre o leitor autenticado, com navegação, zoom, cURL copiável,
downloads e modal Compartilhar. O usuário pode copiar um link para a seção/evidência
ou abrir o Teams. O destinatário continua precisando de acesso Serasa. Não envie
mensagens, crie grants públicos ou anuncie entrega no Teams por conta própria.

## Revisão antes da criação

Cruze afirmação, tentativa, fonte e horário. Remova duplicação entre resumo e corpo.
Diferencie hipótese de observação e reprodução adaptada de validada. Mascare dados,
credenciais e cabeçalhos de sessão. Preserve somente evidências necessárias. Quando
a ferramenta retornar `ready`, entregue o link; o usuário poderá compartilhar na UI.
