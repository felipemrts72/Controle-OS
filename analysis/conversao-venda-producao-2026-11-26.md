# Conversão em venda e produção — validação direcionada

## Diagnóstico do orçamento 359 / ORC-2026-000082

Consulta em transação READ ONLY: orçamento aprovado, Venda 1 vinculada, fabricação global desabilitada (manufacturing_enabled=false), escolha de fabricação e data de geração nulas. O único item contém planejamento habilitado com 11 nós, referências de setores ativos e componentes selecionados. Dois nós são de revenda e ficam fora da fabricação nesta correção. Não há ordem vinculada nem tarefas operacionais para esse lançamento; o indicador 0/1 corresponde aos registros efetivos. O histórico registra criação, edição, PDF e aprovação, sem confirmação de fabricação. Não há evidência nesse histórico de tentativa de geração ou de registros parciais.

No commit 8dd0f81, a aprovação chama createSaleForApprovedQuote e grava os itens como not_requested. A geração exige uma segunda ação, denominada Emitir orçamento aprovado. Portanto a aprovação sozinha não chamava o gerador; adicionalmente a chave global desabilitada impede considerar as demandas salvas. Nenhuma ordem real foi criada na investigação ou nos testes.

## Comportamento corrigido

- Converter em venda usa o endpoint e o serviço de aprovação existentes; rascunhos e enviados são elegíveis. Anteriormente a ação aparecia somente para enviados. Permissões, pagamentos, auditoria e transições terminais continuam validados.
- Confirmação explicita a aprovação comercial e permite gerar produção ou converter sem fabricação. A escolha inicial acompanha a configuração salva. Revisão por setor e erros de planejamento precedem a confirmação.
- Aprovação, venda, ordem existente, itens, tarefas, dependências e volumes configurados são gravados na mesma transação. Falhas fazem rollback; unicidade e bloqueio de orçamento impedem duplicação.
- PDF continua no fluxo documental. Não gera venda, tarefas, estoque ou fabricação.
- Árvore e seus snapshots continuam no orçamento. A opção de salvar no cadastro permanece desmarcada; abrir o primeiro planejamento habilita a opção global, que continua editável.
- Dependências reutilizam internal_task_dependencies. Cada componente produtivo depende de seus descendentes selecionados mais próximos, atravessando níveis excluídos quando necessário. Irmãos independentes são liberados juntos.
- Conclusão registra a quantidade integral da tarefa; liberação exige status concluído e quantidade suficiente. Quantidades planejadas inferiores às necessárias ao pai produzem erro específico antes da conversão com fabricação. Comprados e matérias-primas desmarcados não geram dependências produtivas. A correção de 27/11/2026 permite selecioná-los manualmente: a escolha explícita tem prioridade sobre o padrão do tipo e gera demanda e dependência no setor informado.
- Tarefas bloqueadas existem na ordem e ficam fora das TVs existentes. Conclusão reavalia pais automaticamente. Bloqueio por item serializa conclusões concorrentes. Reabrir uma tarefa exige reabrir primeiro seus pais concluídos.
- Dependências de roteiros antigos, sem quantidade exigida, mantêm sua regra anterior.
- Indicadores comerciais contam os registros operacionais efetivos. Venda exibe demandas, quantidades concluídas, planejamento e link da ordem; ordem permite acessar sua origem comercial.

## Recuperação da Venda 1 e de outras vendas sem ordem

Abrir a venda ou o orçamento aprovado, revisar o planejamento, habilitar Este orçamento deverá gerar fabricação e selecionar os componentes e setores. Salvar e usar Gerar ordem de produção. A confirmação reutiliza a venda existente; requisições repetidas retornam a ordem vinculada. Funciona também após uma conversão explicitamente sem fabricação. O orçamento 359 foi deixado inalterado para decisão do usuário.

## Validação

Banco PostgreSQL descartável com somente o esquema local e dados fictícios; nenhuma massa operacional copiada. scripts/verify-quote-manufacturing.mjs cobre persistência, reabertura, PDF independente, conversão com e sem produção, recuperação, ausência de permissões, plano inválido, falha após inserção de tarefas, rollback de venda e ordem, requisições simultâneas, quantidades insuficientes, conclusão repetida, árvore com três níveis, irmãos independentes, comprados, níveis excluídos e roteiro legado.

Interface real em Chromium/Edge headless a 390, 768 e 1365 px: criação de orçamento, planejamento e edição da árvore existente, salvamento, reabertura, PDF, ação da listagem, confirmação, abertura da venda e ordem, conclusão de todas as tarefas e liberação automática. As TVs foram consultadas em cada etapa para conferir inclusão e exclusão de tarefas. Verificadas ausência de erro JavaScript e de overflow horizontal. Capturas em tmp/quote-manufacturing/ dentro do checkout isolado.

16 testes direcionados adicionais passaram: quoteManufacturing, productTree, productionCustomerRegression e commercialQuoteUx. Build Vite passou com aviso de tamanho de bundle já existente; git diff --check passou. Não executada auditoria geral ou suíte sobre registros reais.

Migration: 20261126_quote_production_dependencies.sql adiciona completed_quantity e required_quantity, preservando dependências legadas. Publicação utiliza PM2 existente, frontend 4173, API 3333 e hostname os.torneadorauniversal.com.br. Resultado final da publicação será informado no chat após confirmação pública.
