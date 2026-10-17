# Férias — auditoria e plano de validação integrada (17/10/2026)

## Estado inspecionado

- Branch `feature/ferias-module`; sem commit, push ou merge nesta etapa.
- `npm run migrate:status`: 43 migrations aplicadas, `20261016_vacation_module.sql` pendente, nenhuma migration marcada como alterada.
- Leitura de metadados: PostgreSQL 18.4, banco `controle_os` local, aproximadamente 120 MB, tabelas de férias ausentes. Não foi encontrada URL de banco de teste separada.
- `scripts/migrate.js` aplica cada arquivo em uma transação e sob advisory lock. Um erro faz rollback do arquivo. A nova migration usa `SET LOCAL` para limitar espera por lock e tempo de execução.
- A migration só cria tabelas, índices, restrições e permissões novas; não altera dados ou tabelas dos módulos anteriores. Executá-la novamente fora do runner não é um procedimento suportado; o controle de aplicação é `schema_migrations`.

## Riscos tratados no código

- Baixa confirmada: correção e cancelamento lógico exigem `vacations.confirmed.correct`, motivo, versão atual e transação. `SELECT ... FOR UPDATE` no funcionário serializa operações concorrentes. O histórico grava JSON antes/depois e motivo. Saldo é revalidado antes do commit.
- Baixa repetida: status diferente de `programada` impede segunda confirmação. A confirmação revalida direito, faltas pendentes e todas as frações.
- Referência cruzada: faltas, férias e auditoria usam chave composta `(period_id, employee_id)` para impedir associação a período de outro funcionário.
- Mudança da admissão após geração de períodos: mantém os registros, sinaliza caso especial e impede conferência/novos lançamentos até revisão do RH. Não recalcula ou apaga histórico automaticamente.
- Datas: cálculos em UTC para intervalos civis, datas do PostgreSQL lidas pelos componentes locais, e "hoje" no fuso de negócio (`APP_TIME_ZONE`, padrão `America/Cuiaba`).
- Programação: exige aviso prévio registrado, concordância do empregado, permissão de conferência administrativa e nota da revisão de feriados locais e escala. Feriados e escalas ainda não são importados automaticamente.

## Backup e recuperação antes de qualquer ativação

1. Agendar janela com baixo movimento. Confirmar destino de `DATABASE_URL`, versão do PostgreSQL, espaço livre e acesso à instância de teste. Não usar o banco `controle_os` para ensaios destrutivos.
2. Gerar backup completo em formato custom (`pg_dump -Fc`) com conexão segura, sem senha na linha de comando, em diretório protegido e fora do repositório. Gerar hash SHA-256, registrar horário e tamanho, copiar para armazenamento separado. Como o banco atual tem cerca de 120 MB, reservar espaço para backup e restauração, medindo o tamanho real do arquivo.
3. Validar o arquivo com `pg_restore --list` e restaurá-lo em **outra instância PostgreSQL ou banco de teste explicitamente identificado**. Validar conexão, tabelas, papéis/permissões e contagens básicas. Não apontar serviços PM2 para essa instância.
4. No banco isolado, executar `npm run migrate:status` com `DATABASE_URL` de teste, confirmar que apenas a migration de Férias está pendente e então executar `npm run migrate`. Confirmar tabelas, FKs compostas, índices e permissão administrativa. Criar apenas funcionários e usuários sintéticos para testes mutáveis; não editar registros restaurados de funcionários reais.
5. Exercitar falta, conferência, programação, baixa, correção, cancelamento e duas sessões concorrentes. Conferir auditoria e saldos diretamente no banco de teste. Verificar 403 sem cada permissão e ausência de efeitos em Vales/Comercial.
6. Se o ensaio falhar, corrigir o código/migration **antes** de qualquer aplicação no ambiente em operação. Como o arquivo ainda não foi aplicado, ele pode ser ajustado nesta fase; após aplicação, não alterá-lo.

## Sequência proposta para ativação, sujeita a autorização

1. Obter autorização explícita para ativação; conferir branch e diff, repetir testes, build e `git diff --check`.
2. Fazer backup novo, verificar sua restauração isolada e documentar ponto de retorno. Confirmar `migrate:status` sem checksums alterados.
3. Em janela combinada, executar somente `npm run migrate` apontando ao banco de operação. O runner aplica arquivos pendentes em transações separadas; confirmar que a única pendência é `20261016_vacation_module.sql`.
4. Confirmar schema, grants e `migrate:status`. Fazer smoke de leitura do módulo com perfil autorizado e 403 com perfil sem permissão. Não testar escrita em funcionários reais.
5. Publicar o build e reiniciar somente processos do próprio ERP se isso for autorizado e necessário. Monitorar health, logs e tempos de resposta. Sem reinício de outros processos PM2.
6. Habilitar cadastro operacional gradualmente após conferência histórica pelo RH. Se houver falha de aplicação, a transação da migration faz rollback. Se houver falha posterior, retirar acesso ao menu/API e usar o backup verificado para recuperação planejada; não executar restauração ou exclusão de tabelas sem análise do incidente.

## Pendências de liberação ampla

- Não existe banco de teste configurado; o ensaio integrado real ainda não ocorreu.
- Feriados locais, repouso individual, afastamentos do art. 133, férias coletivas, abono e rescisão exigem processo/dados adicionais. A aprovação administrativa documentada cobre a revisão do calendário, mas não substitui automação ou parecer jurídico.
- A aplicação não registra pagamento, não emite aviso escrito e não calcula folha. A data limite de pagamento é apenas informativa.
- Períodos com admissão alterada são bloqueados para revisão do RH; fluxo de realinhamento do período e suas referências ainda exige desenho específico.
- O painel limita a listagem a 500 funcionários e seus indicadores acompanham a busca; revisar paginação e escopo dos indicadores antes de adoção em base maior.
