# Adequação do orçamento à produção existente

## Estrutura verificada e reutilizada

A ordem manual grava a entrega em internal_orders.promised_date. As consultas existentes do Painel e das TVs leem essa coluna pelo vínculo internal_tasks → sold_items → internal_orders. Não foi criada data nas tarefas nem alterado o consumidor operacional.

A origem comercial continua usando internal_orders, sale_number, customer_id/name/phone, delivery_type, destino, created_by, commercial_quote_id e commercial_sale_id; sold_items com produto, quantidade e item da venda; internal_tasks com quantidade, unidade, setor, observações, snapshot e dependências em internal_task_dependencies. Volumes configurados continuam em shipment_volumes, com os estados e atualizações existentes. Não há estrutura paralela.

## Data interna

Migration 20261127_quote_promised_date.sql adiciona somente commercial_quotes.promised_date, opcional durante a elaboração. Criação, edição e planejamento compartilham o mesmo estado no frontend. A confirmação carrega a data persistida e permite corrigi-la. Geração com produção exige data válida e grava internal_orders.promised_date na mesma transação. Conversão sem fabricação e elaboração permitem ausência de data.

Após existir ordem, sua data é a referência canônica em Orçamentos, Vendas e conferência de fabricação, inclusive quando corrigida pelo formulário de ordem já existente. Revisão comercial interna atualiza a ordem existente; nenhuma data fictícia ou preenchimento retroativo foi aplicado. O DTO do PDF permanece explícito e não inclui promised_date.

## Revisões seguras

Orçamentos abertos conservam edição comercial, árvore, escolhas manuais, setores e observações; necessidades sem quantidade manual acompanham a quantidade comercial. Não são criadas tarefas durante a elaboração.

Venda confirmada sem ordem permite revisar o planejamento e a data, salvá-los e gerar produção posteriormente reutilizando a venda.

Com ordem vinculada, revisão exige commercial.quotes.edit e orders.edit, confere versões de orçamento e ordem e bloqueia os registros em transação. Alterações de composição exigem confirmação explícita. Tarefas existentes compatíveis mantêm seus IDs. Conclusão, quantidades concluídas, fixação e histórico de execução impedem alteração ou remoção das respectivas tarefas e dependências. O sistema atual não tem estado separado de início: a proteção usa os indicadores operacionais que já existem, sem acrescentar fluxo às TVs.

Somente demandas sem andamento podem ser acrescentadas, alteradas ou removidas. Remoções registram antes o snapshot completo e as dependências na auditoria; históricos não são apagados. As dependências pendentes são recalculadas mantendo a liberação de baixo para cima. Alteração incompatível recusa a revisão inteira, preservando planejamento e ordem anteriores. Composição após expedição ou exclusão é recusada; ajuste somente de data não reinicia tarefas. Os valores e itens comerciais da venda não são alterados por essa revisão.

## Validação direcionada

scripts/verify-quote-delivery.mjs usa banco descartável, somente o esquema e dados fictícios. Valida data opcional, rollback de conversão sem data, persistência, recálculo de quantidades e escolhas manuais, ausência da data no snapshot do PDF, compatibilidade de campos e volumes com ordem manual, revisão confirmada, IDs preservados, demanda nova e removida com auditoria, preservação de tarefa concluída e tarefa fixada, permissão, data inválida, correção de ordem antiga sem data pelo endpoint existente, consulta coerente em Orçamentos/Vendas e geração repetida sem duplicação.

A interface foi validada no mesmo banco isolado: formulário → planejamento → salvar/reabrir → confirmação → ordem → revisão de data e de tarefa pendente. As consultas existentes das TVs retornaram a nova data naturalmente. Cinco testes unitários de planejamento passaram. Build Vite e git diff --check passaram; o build mantém o aviso já existente de tamanho do bundle.

Confirmado por comparação com e6403ea: sem alteração em SectorTvPage, dashboardController, taskController, manufacturingRouteService, orderService, InternalOrderForm ou internalOrderController. Painel, TVs, atualização, cores/prazos, prioridades, ordenação, conclusão e expedição permaneceram inalterados. Nenhum registro real foi usado como massa de teste ou alterado durante a validação.

Publicação segue o procedimento existente: develop, migration pelo runner, assets antes do index e reinício somente dos dois processos Controle-OS no PM2. A confirmação pública final é informada no chat.
