# Roteamento pela ontologia Blip

Este mapa deriva de `blip-mapa-ontologia.html`, pesquisa de 05/10/2026. Use-o para formular consultas e atravessar dependências. Ele é um modelo proposto e não comprova topologia ou execução atual.

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
5. **Consultar sinais:** Grafana na stack, datasource, tenant e janela correspondentes.
6. **Explicar o mecanismo:** código na revisão implantada, contratos e comportamento de erro/retry.
7. **Responder:** fatos, hipóteses, fonte, escopo, validade e lacunas.

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
