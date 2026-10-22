# Validação consolidada — 22/10/2026

## Escopo e estado

As branches `feature/funcionarios-filtros-relatorios` e `feature/ferias-alertas-filtros` permanecem em worktrees separados, com alterações locais preservadas. Ambas partem de `2d0387e`. Não houve commit, merge, push, deploy, reinício de PM2 ou acesso ao banco operacional.

## Férias

O histórico de cada funcionário apresenta períodos aquisitivos mais recentes primeiro, com os lançamentos e respectivos documentos aninhados. Lançamentos anteriores, futuros, editados, cancelados e confirmados mantêm o período de origem. Saldos distinguem direito adquirido, gozo confirmado, dias programados, saldo ainda não gozado e saldo livre. O cálculo continua baseado nos lançamentos, sem influência dos anexos. Os cartões de períodos adquiridos, próximos do prazo concessivo e vencidos, além da agenda e dos filtros, foram preservados.

Cada lançamento aceita até 20 documentos PDF, PNG ou JPEG, de até 10 MB por arquivo. Metadados, vínculo ao funcionário/período/lançamento, autor, horário e SHA-256 ficam no PostgreSQL; os bytes ficam em diretório privado persistente configurado por `VACATION_DOCUMENT_DIR` em produção. Upload valida extensão, MIME e assinatura, grava com nome interno aleatório e limpa arquivo órfão em falha tratada. Visualização, download, exportação ZIP do período e arquivamento lógico exigem permissões específicas. O ZIP limita 100 documentos e 100 MB e usa nomes únicos. Gozo confirmado sem recibo gera aviso, sem bloquear registro histórico. Auditoria cobre upload, leitura/download, ZIP e arquivamento. Não há operação de substituição; novo upload preserva os anteriores e o documento antigo pode ser arquivado.

Em celular, a classe `vacations__compact-fields` padroniza todos os campos editáveis de Férias (texto, datas, números, seletores, arquivo e área de texto): campos com altura de 38 px e fonte de 16 px; área de texto com 64 px. Inspeção visual em 320, 375, 390, 430, 768 e 1366 px não encontrou rolagem horizontal.

Backup e restauração estão descritos em `analysis/ferias-documentos-operacao.md`: copiar banco e diretório privado em conjunto, restaurar e conferir SHA-256. É necessário configurar volume persistente e rotina de backup antes de implantar. Não há serviço antivírus integrado; os arquivos não são executados.

## Diagnóstico dos 18 testes legados

| Testes originalmente falhos | Causa confirmada | Correção |
| --- | --- | --- |
| `commercialCatalog.test.js` (1) | Papel de estoque e permissões de custo dependiam de configuração histórica | Fixture sintética de papéis e permissões |
| `commercialQuotes.test.js` (1) | Número comercial fixo 250 colidia em banco limpo/sequência | Colisão construída a partir da cotação criada |
| `commercialQuotesHttp.test.js` (1) | PDF dependia de cotação histórica | Lote comercial sintético |
| `databaseRbac.test.js` (3) | UUIDs, nomes, papéis e hash de catálogo fixados ao banco antigo | Verificações de catálogo atual e usuários sintéticos |
| `labelWorkflow.test.js` (2) | Venda 190000 era preexistente | Venda criada no próprio teste, com rollback |
| `legacyCommercialHistory.test.js` (8) | Lote ERP de 45 cotações, produtos, versões, imagens, aliases e valores não existia | Fixture determinística de 45 cotações, 112 itens e catálogo correlato |
| `productsListing.test.js` (1) | Produto ativo com imagem não existia | Produto e imagem sintéticos |
| `purchasesClosure.test.js` (1) | Solicitação SC-2026-00004 era preexistente | Solicitação sintética criada no teste |

A migração `20260827_zzz_fix_legacy_number_order.sql` é correção de dados do lote ERP antigo, não estrutura. Somente a preparação do banco sintético vazio registra seu checksum sem executar a correção; todas as demais migrações são executadas. A fixture comercial é inserida depois, já com numeração consistente. Bancos operacionais continuam usando o fluxo normal de migração.

Os scripts `prepare-isolated-postgres.mjs`, `drop-isolated-postgres.mjs` e `seed-legacy-qa.mjs` são idênticos nas duas branches. A preparação exige banco vazio, nome `olimen_qa_*`, PostgreSQL local em cluster temporário `olimen-pg-*` e UTF-8. A limpeza exige marcador criado pela preparação. Nenhum dado real foi copiado.

## Resultados

| Branch / banco recém-criado | Suíte completa |
| --- | --- |
| Funcionários / `olimen_qa_main1` | 266/266 aprovados |
| Funcionários / `olimen_qa_main2` | 266/266 aprovados |
| Férias / `olimen_qa_ferias1` | 271/271 aprovados |
| Férias / `olimen_qa_ferias2` | 271/271 aprovados |

Testes específicos: relatórios de Funcionários 4/4; verificação integrada de filtros, busca, paginação, contagem, PDF, Excel e permissões aprovada. Em Férias, testes de alertas, saldos, lançamentos, agenda e três testes unitários de documentos aprovados; verificações PostgreSQL de alertas, lançamentos e 12 regras de férias aprovadas. A verificação integrada de documentos cobriu PDF/PNG, vínculos, múltiplos anexos, assinatura/MIME/tamanho inválidos, acesso negado, funcionário incorreto, ZIP, SHA-256, persistência em outro processo, arquivo ausente/adulterado, falha de gravação, auditoria, exclusão lógica e saldo inalterado. `npm run build` e `git diff --check` passaram nas duas branches. O build emite apenas o aviso Vite de bundle superior a 500 kB.

## Arquivos principais

Funcionários: `backend/src/controllers/employeeController.js`, `backend/src/routes/employeeRoutes.js`, `backend/src/services/employeeService.js`, `backend/src/services/employeeListReportService.js`, `src/pages/EmployeesPage/*`, `tests/employeeListReport.test.js`, `scripts/verify-employee-list.mjs`, `package.json` e `package-lock.json`; mais as seis correções de testes legados e os três scripts de banco sintético compartilhados.

Férias: `backend/src/routes/vacationRoutes.js`, `backend/src/services/vacationService.js`, `backend/src/services/vacationRules.js`, `backend/src/services/vacationAlerts.js`, `backend/src/services/vacationDocumentService.js`, `database/migrations/20261022_vacation_documents.sql`, `src/pages/VacationsPage/*`, `tests/vacationAlerts.test.js`, `tests/vacationLaunchBalances.test.js`, `tests/vacationDocuments.test.js`, `scripts/verify-vacation-*.mjs` e documentação; mais as mesmas correções de testes legados e scripts de banco.

## Pendências antes da integração

Revisar a migração de permissões e a configuração do volume persistente/backup no ambiente de destino. A restauração do backup não foi ensaiada em infraestrutura operacional. Não há antivírus integrado. A inspeção mobile foi feita em navegador de homologação com dados sintéticos. Nenhuma das branches foi integrada à `develop`.
