# Nome principal duplicado na produção

## Causa verificada

Consulta READ ONLY ao orçamento 363 confirmou uma única tarefa, quantidade 1 UN, nome Eixo Universal H-2 — Eixo Universal H-2. O nó é raiz (parent_key nulo) e os snapshots name e root_name contêm o mesmo produto. Portanto o problema não é duplicação de tarefas: a origem comercial concatenava incondicionalmente nome da demanda e nome do produto principal, tanto na geração inicial quanto na revisão.

Os três controles possuem funções distintas e foram preservados: fabricação global habilita o planejamento do orçamento; incluir produto habilita aquele item; gerar demanda seleciona cada nó operacional. O gerador percorre as demandas selecionadas uma vez, com a unicidade existente por item/nó. Não foi adicionada uma segunda lógica de geração.

## Correção

Na raiz, task_name recebe apenas demand.name, seguindo o padrão da tarefa principal de uma ordem manual. Componentes e subcomponentes continuam identificados pelo nome próprio e pela referência ao produto principal. Geração e revisão usam a mesma função. Comparação de revisões reconhece o formato antigo como equivalente, sem forçar alterações em tarefas protegidas apenas por essa diferença textual.

A ação Corrigir nomes das demandas está no orçamento com ordem vinculada. Requer edição de orçamento e ordem, conferência e confirmação. Corrige somente raízes identificadas por nó e snapshot comercial, cujo texto ainda corresponde exatamente à concatenação antiga. Não utiliza substituição textual global nem modifica componentes, tarefas manuais ou nomes personalizados.

A correção usa os mesmos registros, alterando somente task_name e timestamps técnicos de atualização. IDs, snapshots do planejamento, execução, quantidades, unidades, setores, datas de entrega, seleção, dependências, volumes e valores comerciais são preservados. Auditoria e histórico recebem registros adicionais com os nomes anteriores. Uma nova execução não corrige novamente nem cria tarefas. Não há migration ou atualização automática em massa.

## Validação direcionada

scripts/verify-quote-task-names.mjs utiliza banco descartável com esquema e dados fictícios. Cobre raiz isolada, raiz com componentes e subcomponentes, raiz sem demanda, escopos dos controles, nomes distintos, tarefas únicas, dependências, repetição da conversão, correção pontual de tarefa pendente e concluída, nomes personalizados preservados, permissões e confirmação.

Validação pela interface confirma a ação e verifica as respostas das consultas existentes das TVs. Comparações antes/depois comprovam manutenção dos IDs, quantidades, setores, data, status, conclusão, snapshots, dependências e auditoria anterior. Cinco testes unitários de planejamento, build e git diff --check passaram.

Nenhuma alteração em SectorTvPage, dashboardController, taskController, manufacturingRouteService, orderService, InternalOrderForm ou internalOrderController. Layout, atualização, prazos, prioridades, ordenação e conclusão das TVs/Painel permanecem inalterados.

Após publicação, a aplicação pontual à ordem do orçamento 363 e a confirmação pública serão informadas no chat. Os testes não usaram registros reais como massa de escrita.
