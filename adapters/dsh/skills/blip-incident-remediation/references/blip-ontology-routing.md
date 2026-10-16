# Consultar a ontologia Blip vigente

Esta referência é orientação de consulta, não uma cópia da ontologia. Os dados vigentes vêm das ferramentas abaixo. Uma leitura desta página não conta como consulta ao grafo.

1. `ontology_search_entities({query})`: a implementação atual faz correspondência **literal de substring**, sem distinguir maiúsculas, em id/label/tipo/tecnologia/nota; não é busca semântica nem busca AND de palavras. Use um nome de componente observado ou um termo curto por consulta. Uma frase concatenando conceitos pode retornar vazio mesmo com entidades pertinentes. Verifique os schemas e a semântica quando a ferramenta mudar.
2. `ontology_get_entity({entityId,graphDigest})`: leia a entidade relevante retornada e seus contratos, fontes, versões e limites. Preserve o digest retornado para as próximas leituras.
3. `ontology_get_dependencies({entityId,graphDigest,depth:1})`: só quando uma dependência ajuda a distinguir hipóteses. `ontology_get_product_context` e `ontology_list_products` ajudam a localizar o escopo quando necessário.
4. Registre os callIds reais no checkpoint. `matched` exige leitura da entidade; `no_match` exige consulta bem-sucedida sem correspondência pertinente; `unavailable` exige falha efetivamente observada. Não substitua ontologia de cliente pela ontologia de Data Management ou Echo.

Se a busca literal ficar vazia, tente o nome/termo específico e consulte o contexto compacto do produto descoberto por `ontology_list_products`; não percorra todas as páginas. Leia uma entidade pertinente e siga suas fontes quando houver correspondência. Só use `no_match` depois de distinguir uma limitação da consulta de ausência de entidade relevante no escopo consultado. Resultado vazio não é falta de permissão nem prova de ausência do componente na arquitetura.

Semântica conferida no serviço `OntologyQueryService`, operação `search_entities`, e por consultas reais ao mesmo snapshot em 2026-10-16. Essa regra descreve a interface de busca, não uma conclusão de incidente.

Conhecimento de código/versionamento não prova estado implantado nem causa histórica. Se a projeção omitir detalhes de um contrato, consulte a fonte imutável citada. Não transfira contratos de template para envio de documento, ou de um produto para outro.

## Grafo mínimo

Parta da entidade que o relato permite identificar e percorra apenas relações úteis:

| Entidade | Relações que orientam a investigação |
|---|---|
| Jornada | produto/capacidade; tenant/bot; etapas/serviços; critérios; testes; SLO/incidente |
| Serviço/API | jornadas consumidoras; repo/commit; time; deploy/ambiente; bancos/tópicos; sinais/incidentes |
| Deployment | imagem/digest; build/commit; Argo/configuração; workload/pod; ambiente/célula; PR/GMUD |
| Cluster K8s | cloud/conta; região/rede; Argo destination; namespace/pod; ambiente/célula; telemetria |
| Dataset | instância/banco; schema/contrato; serviços leitores/escritores; pipelines; políticas; testes |
| Afirmação | entidade/relação; fonte; tempo/escopo; ferramenta; acesso; afirmações conflitantes/substituídas |

Uma jornada pode usar vários serviços, e um serviço pode atender várias jornadas. Mantenha o grafo muitos-para-muitos até a evidência reduzir o escopo.

## Caminho de consulta para incidente

1. **Resolver escopo:** jornada + período + tenant/bot + ambiente/célula lógica.
2. **Resolver identidade física:** Argo destination + cloud/conta + cluster/namespace/workload.
3. **Percorrer dependências:** serviços → APIs/eventos/schemas → bancos/tópicos/filas → consumidores.
4. **Resolver mudança efetiva:** PR/GMUD → commit → build → digest → deployment → pod/configuração.
5. **Consultar sinais:** descubra nome/UID no conector atual; vincule a candidata ao componente/célula e confirme o workload antes dos eventos. Um UID de exemplo e um datasource funcional não resolvem o escopo. Rejeite candidatos de outro domínio. Use então Grafana na stack, datasource, tenant e janela correspondentes.
6. **Explicar o mecanismo:** código na revisão implantada, contratos e comportamento de erro/retry.
7. **Responder:** fatos, hipóteses, fonte, escopo, validade e lacunas.

A ordem se adapta à evidência: um detalhe de erro downstream justifica localizar primeiro o consumidor/produtor da resposta, sem atravessar todos os componentes da jornada. Use o menor caminho para a fronteira que pode distinguir as hipóteses.

## Invariantes de evidência

- `Take/prod` é escopo lógico; não substitui a identidade física do cluster.
- Argo/Git descrevem estado desejado; Kubernetes/workload e telemetria descrevem estado observado.
- Branch principal descreve código atual; a causa deve ser analisada na revisão implantada durante a janela.
- Engine, instância, banco e dataset são entidades diferentes.
- Declaração de linhagem/configuração não prova que um pipeline executou.
- Owner, operador, aprovador e validador podem ser pessoas ou times diferentes.
- Código da aplicação, testes e GitOps podem viver em repositórios diferentes.

## Seleção por tipo de sintoma

- **Mensagem não enviada, atrasada ou duplicada:** jornada → produtor → tópico/fila → consumidor → destino; verifique backlog, retries, deduplicação, contrato e deploy de ambos os lados.
- **Mensagem enviada ao contato errado:** jornada → resolução de destinatário → identificadores/mapeamentos → fonte de verdade → caches/projeções → serviço de envio.
- **Falha no Desk/Portal:** jornada/UI → API chamada → serviço → dependências → workload; se a UI e o histórico divergirem, separe persistência de atualização em tempo real.
- **Dado incorreto ou ausente:** dataset/contrato → escritores → leitores → pipeline/projeções → cache; confirme instância e ambiente antes de consultar.
- **Falha após mudança:** deployment → digest → commit/PR → consumidores do contrato → jornadas/tenants; confirme rollout parcial e configuração efetiva.
- **Degradação restrita a cluster/tenant:** escopo lógico → identidade física → workloads e dependências compartilhadas; compare com uma célula saudável equivalente.

## Registro de afirmações

Registre cada conclusão intermediária assim:

```text
Afirmação: <relação ou comportamento>
Fonte: <Slack, Grafana, Argo, K8s, Git, código>
Escopo: <tenant/bot, ambiente, célula, cluster, serviço>
Validade: <janela temporal e versão>
Coleta: <query, dashboard, comando ou link>
Estado: observado | declarado | inferido | desconhecido
```

Se duas afirmações divergirem, compare primeiro escopo e validade. Preserve ambas até confirmar que uma substitui a outra ou que tratam de recortes diferentes.
