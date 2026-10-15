# Orientar a resolução técnica

Leia depois de delimitar a fronteira operacional e antes de compor o relatório. O diagnóstico deve levar a uma decisão de engenharia utilizável; causa raiz aberta limita a certeza da correção, mas não impede propor uma mitigação ou um teste discriminatório sustentado.

Para cada ação recomendada, informe:

- **Onde agir:** entidade e relação do [mapa ontológico](blip-ontology-routing.md), com serviço, contrato, tópico, consumidor, estado, deployment ou configuração identificados no escopo histórico. Se a identidade não estiver confirmada, marque a associação como hipótese.
- **O que mudar e por quê:** alteração técnica concreta e mecanismo observado ou inferido que ela pretende interromper. Separe contenção imediata, correção permanente e prevenção somente quando houver proposta material para cada uma.
- **Base e limite:** evidências, confiança, contraprovas e condição ainda não verificada. Não transforme padrão arquitetural em diagnóstico causal nem apresente aumento de capacidade, ajuste de flag ou retry como cura comprovada.
- **Como decidir se funcionou:** sinal de aceitação no mesmo fluxo, como idade da fila, tempo até o estado final, taxa de duplicação, erro por dependência ou integridade da persistência; inclua teste em ambiente controlado e observação após aplicação quando pertinente.

Se ações candidatas atacarem mecanismos diferentes, indique a ordem ou o experimento mínimo que distingue seus efeitos. Quando só houver impacto declarado e nenhuma fronteira técnica sustentada, entregue o próximo passo diagnóstico específico que permitiria escolher uma correção; não invente uma mudança de produção.

## Quando o gap é de arquitetura

Use a ontologia para percorrer o caminho completo da jornada: produtor → contrato/evento → transporte → consumidor → estado persistido/projeção → leitura pelo produto. Compare a propriedade que faltou (por exemplo, controle de carga, idempotência, ordenação, isolamento, recuperação ou observabilidade) com código, contrato e comportamento do runtime na revisão pertinente. Uma falha localizada em configuração ou capacidade não vira automaticamente defeito de arquitetura.

Quando a evidência mostrar que a propriedade depende de vários componentes ou inexiste no contrato entre eles, proponha uma solução de engenharia na fronteira correta: responsabilidade de cada produtor/consumidor, mudança de contrato ou estado, compatibilidade e migração, comportamento em falha e sinais para validar. Exemplo para notificações duplicadas: deduplicação por chave de negócio pode exigir proteção na publicação **e** consumo idempotente; o local exato e a necessidade de ambos dependem do caminho observado. Para represamento, escala por idade/backlog, particionamento ou controle de entrada são candidatos distintos; valide qual recurso limita o consumo antes de escolher.

Classifique a proposta como **recomendação arquitetural**, vinculada à evidência disponível e a um teste de aceitação. Não a descreva como causa raiz ou correção já executada. Consulte a ontologia para localizar relações e responsáveis técnicos, mas nunca use seu grafo proposto como prova de que aquela topologia ou implementação estava ativa no incidente.
