# Atualização rápida de remuneração

Local: Administrativo → Funcionários → Atualização cadastral.

Reutiliza `employees.current_salary`, `employees.meal_allowance`, os dois históricos existentes e `audit_logs`. Não exige migração nem reconstitui alterações antigas. A origem fica identificada como `Atualização rápida` no motivo do histórico e `atualizacao_rapida` na auditoria. Diferenças e percentuais podem ser consultados no relatório; percentual com base zero é não aplicável.

O endpoint individual recebe apenas os valores selecionados, os valores anteriores conferidos e a vigência. Exige `employees.view`, visualização do tipo de remuneração e sua permissão de gestão (ou `employees.manage`). Bloqueia campos alheios, reduções, valores inválidos e bases desatualizadas. Executa atualização, históricos e auditorias na mesma transação com bloqueio do funcionário. Repetições de valores já salvos não geram novos registros.

Vigência é informativa: a atualização do cadastro é imediata, sem agendamento, recálculo de folha ou lançamento financeiro.

O relatório mensal reúne os históricos existentes de ambos os tipos, pela data do registro, inclusive alterações feitas na ficha individual. Exclui registros iniciais sem valor anterior e valores inalterados. Exige visualização de ambos os tipos; não entrega relatório parcial silenciosamente. Os timestamps existentes seguem o fuso da conexão do banco (produção: America/Cuiaba). O PDF usa a empresa configurada, CNPJ, referência, emissão e detalhes por alteração.

Validação direcionada:

- `node --test tests/employeeCompensation.test.js tests/employeePendingReport.test.js`
- `node scripts/verify-employee-compensation.mjs`: cria e remove banco local isolado com dados fictícios; testa API autenticada, permissões, preservação, concorrência, rollback, histórico, relatório, PDF e interface em 390, 768 e 1365 px. Requer PostgreSQL local, build em `dist` e Playwright do runtime local (caminho seguindo o script de validação de funcionários existente).
- `npm run build`
- `git diff --check`

O roteiro isolado injeta deliberadamente uma falha `QA rollback` para comprovar que salário e histórico não ficam parcialmente gravados. Essa mensagem de erro é esperada durante o teste.
