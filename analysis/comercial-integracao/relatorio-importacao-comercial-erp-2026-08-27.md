# Importação completa do histórico comercial — ERP Universal → OliMen Gestão

Data da execução: 27/08/2026  
Lote: `f331c135-b41a-40ee-904f-d7ffb90966c8`  
Hash do snapshot de origem: `0f1deab45416f9e9ae4b6f94e735d7497cbd762ac5a3d660938b7bd8819847bf`

## Resultado executivo

- 47 Orçamentos brutos e 114 linhas foram relidos do ERP.
- O grupo integralmente idêntico ERP #95/#96/#97 foi deduplicado: #95 é a origem canônica e #96/#97 permanecem como aliases de auditoria.
- Resultado: 45 históricos imutáveis, 112 linhas e sequência cronológica OliMen #1–#45 sem gaps.
- Totais únicos importados: bruto R$ 5.498.005,00; descontos de itens R$ 162.200,00; desconto geral R$ 10,00; frete R$ 0,00; final R$ 5.335.795,00; pagamentos R$ 5.035.795,00.
- 65 Produtos Comerciais foram criados: 61 por identidade cadastral ERP e 4 por fingerprint conservador de itens manuais. Nenhum foi fundido por similaridade textual.
- 14 Produtos possuíam Catálogo Técnico: 19 versões, 19 referências de imagem/15 arquivos físicos únicos, 38 especificações e 62 itens inclusos.
- As 112 linhas históricas foram vinculadas a Produtos Comerciais e continuam completas por snapshot.
- ZERO vínculos operacionais foram inferidos e ZERO registros foram criados em `products`, Produção, Venda, Estoque, Compras ou Expedição.
- A numeração moderna permaneceu em #250; o próximo número efetivo continua #251.
- Nenhum PDF foi marcado como original. Os históricos possuem zero documentos oficiais importados.

## Arquitetura, origem e imutabilidade

O histórico usa tabelas próprias `commercial_legacy_quotes`, `commercial_legacy_quote_items`, pagamentos, parcelas, aliases e documentos. Não entra no fluxo de estados moderno. Triggers bloqueiam update/delete após o lock; documentos podem ser anexados posteriormente, mas não alterados ou removidos. `source_system`, `source_id`, `source_legacy_number`, fingerprint, lote e 310 registros de ledger preservam rastreabilidade e idempotência.

Produtos Comerciais usam `commercial_products` e Catálogos usam a estrutura nativa OliMen. Todos os 65 importados possuem `source_system = ERP_UNIVERSAL` e `operational_product_id = NULL`. Preço mestre veio somente do cadastro ERP; preços exclusivamente históricos ficaram no item. Nenhuma SOP foi inferida.

## Interface e duplicação

`Comercial > Orçamentos` possui `Todos | Atuais | Antigos`. A listagem apresenta número, Cliente, data, contagem de linhas, total e origem. Nos cards móveis o histórico apresenta, por exemplo, `Orçamento #25` e `ERP original #83`, atendendo à exibição simultânea dos dois números.

O detalhe é somente leitura e mostra discretamente a origem e o número ERP. `Duplicar para novo orçamento` cria um rascunho moderno com o próximo número >=250. Produtos Comerciais seguramente vinculados são reutilizados; qualquer fallback permanece manual com `save_product_requested = false`. O teste real de duplicação foi executado em transação e revertido, sem consumir número.

## Backup

Local: `tmp/backups/erp-commercial-history-20260827-105726`

- OliMen antes da importação: `olimen-controle-os-before-import.dump` — 3.924.574 bytes — SHA-256 `A6E77D8B17D11EF094ACE06832B05C398FF24FA22ABF67EB837F4805011255EE`.
- ERP origem: `erp-universal-commercial-source.dump` — 52.814 bytes — SHA-256 `34CD8BD4963E72EF1B3AF3FFB3CF6B0E4A3C54767E15D9CE14313C2CD6B60565`.

## Catálogos e arquivos

- 14 Produtos ERP com Catálogo; 14 Catálogos importados.
- 19 versões preservadas. Versões 56, 62, 65 e 67 não estavam referenciadas como ativas, mas foram mantidas por segurança e exigem revisão humana.
- 19 linhas de imagem e 15 conteúdos físicos únicos foram copiados para o storage protegido `uploads/commercial-catalog`, com nome content-addressed e SHA-256.
- Arquivos ausentes: zero. Quatro referências compartilham conteúdo idêntico sem vínculo de exclusão frágil.
- 38 especificações e 62 itens inclusos foram preservados sem revisão editorial criativa.
- Os 11 arquivos de desenvolvimento e os dois candidatos ligados ao ERP #83 não foram tratados como PDFs oficiais.

## Casos especiais e decisões humanas

- ERP #4 não possui pagamento e aparece como “Forma de pagamento não informada”.
- Os 45 históricos não foram vinculados automaticamente a Cliente mestre; o nome snapshot permanece como verdade histórica.
- Quatro Produtos Comerciais manuais foram preservados separadamente mesmo quando o nome coincide com um Produto cadastral ERP. A limpeza/mesclagem é decisão humana.
- Todos os 65 Produtos Comerciais estão sem Produto operacional vinculado. Vínculos industriais futuros devem ser feitos manualmente ou por identidade absolutamente segura.
- Catálogos e nomes mantêm o conteúdo da origem e precisam de revisão comercial posterior.
- PDF histórico reconstruído pode ser desenvolvido futuramente, sempre identificado como `RECONSTRUCTED`, nunca `ORIGINAL_ERP`.

## Validação e regressão

- Banco real: 45 históricos, 45 números distintos, #1–#45, 112 linhas, 112 vínculos comerciais, 47 aliases, 2 aliases descartados, zero documentos oficiais.
- Importação reaplicada com `idempotent_reuse = true`; nenhum registro duplicado.
- HTTP real pelo proxy: listagem de antigos, detalhe, busca `ERP 83`, Catálogo e frontend retornaram 200.
- Mobile: regras e testes de cards/overflow cobrem 320, 375, 390, 430 e 768 px; o navegador isolado não tinha sessão autenticada e nenhuma credencial real foi alterada para forçar inspeção visual autenticada.
- `npm run rbac:audit`: passou.
- `npm test`: 173/173 testes passaram após a correção, incluindo a ordem por data/criação/ID.
- `npm run build`: passou; apenas aviso conhecido de chunk >500 kB.
- `git diff --check`: passou; somente avisos informativos LF/CRLF.
- PM2: somente `controle-os-backend` e `controle-os-frontend` foram reiniciados; ambos online, sem loop. Logs de erro têm última escrita em 11/08/2026 e 07/06/2026, portanto sem erro novo após esta execução. O ERP não foi reiniciado.
- RBAC real preservado: Admin e Gerente mantêm as 14 permissões comerciais explícitas; Estoquista não recebeu permissões comerciais.

## Matriz de Orçamentos

| Legacy novo | ERP original | Data | Cliente snapshot | Itens | Total | Duplicados descartados |
|---:|---:|---|---|---:|---:|---|
| 1 | 40 | 30/05/2026 | Mina São Jeronimo | 3 | R$ 16.500,00 | — |
| 2 | 2 | 21/07/2026 | Teste 1784641133282 | 1 | R$ 95,00 | — |
| 3 | 3 | 21/07/2026 | Teste 1784670090709 | 1 | R$ 95,00 | — |
| 4 | 4 | 21/07/2026 | Cliente Teste Item Manual | 1 | R$ 300.000,00 | — |
| 5 | 5 | 23/07/2026 | Mineradora Brasil Norte Extracao de Metais Preciosos LTDA | 3 | R$ 336.000,00 | — |
| 6 | 19 | 23/07/2026 | Mineradora Brasil Norte Extracao de Metais Preciosos LTDA | 3 | R$ 336.000,00 | — |
| 7 | 20 | 23/07/2026 | Edmilson | 1 | R$ 58.000,00 | — |
| 8 | 21 | 23/07/2026 | Edmilson Guilherme Surdi | 1 | R$ 58.000,00 | — |
| 9 | 22 | 24/07/2026 | Edmilson | 1 | R$ 60.000,00 | — |
| 10 | 23 | 24/07/2026 | Adna | 2 | R$ 125.300,00 | — |
| 11 | 24 | 25/07/2026 | Douglas dos Santos | 5 | R$ 21.010,00 | — |
| 12 | 25 | 27/07/2026 | Douglas dos Santos | 5 | R$ 21.310,00 | — |
| 13 | 36 | 27/07/2026 | Rodrigo | 1 | R$ 170.000,00 | — |
| 14 | 39 | 27/07/2026 | Rodrigo | 1 | R$ 190.000,00 | — |
| 15 | 37 | 28/07/2026 | Rodrigo | 1 | R$ 170.000,00 | — |
| 16 | 38 | 28/07/2026 | Rodrigo | 1 | R$ 190.000,00 | — |
| 17 | 41 | 30/07/2026 | Douglas dos Santos | 3 | R$ 15.525,00 | — |
| 18 | 76 | 04/08/2026 | Joao Silva | 1 | R$ 12.500,00 | — |
| 19 | 77 | 04/08/2026 | Cliente | 1 | R$ 12.500,00 | — |
| 20 | 78 | 04/08/2026 | Pablo Aripuana | 3 | R$ 22.400,00 | — |
| 21 | 79 | 04/08/2026 | Dornelles | 8 | R$ 128.490,50 | — |
| 22 | 80 | 05/08/2026 | Mina São Jeronimo | 1 | R$ 1.200,00 | — |
| 23 | 81 | 05/08/2026 | Fabiano | 1 | R$ 60.000,00 | — |
| 24 | 82 | 06/08/2026 | Fabio | 2 | R$ 22.600,00 | — |
| 25 | 83 | 11/08/2026 | Rodrigo Ferreira | 4 | R$ 533.000,00 | — |
| 26 | 84 | 11/08/2026 | Fabiano | 3 | R$ 40.900,00 | — |
| 27 | 85 | 11/08/2026 | Fabiano | 4 | R$ 7.842,00 | — |
| 28 | 86 | 11/08/2026 | Joao pé de feijao | 1 | R$ 4.000,00 | — |
| 29 | 87 | 12/08/2026 | Alexei H-10 Caixa Alta | 4 | R$ 62.590,00 | — |
| 30 | 88 | 12/08/2026 | Daniel | 1 | R$ 180.000,00 | — |
| 31 | 89 | 12/08/2026 | Daniel | 4 | R$ 503.000,00 | — |
| 32 | 90 | 17/08/2026 | Edmilson Guilherme Surdi | 1 | R$ 58.000,00 | — |
| 33 | 91 | 17/08/2026 | Wlademir | 2 | R$ 76.000,00 | — |
| 34 | 92 | 18/08/2026 | Walber Santa Helena | 2 | R$ 158.000,00 | — |
| 35 | 93 | 18/08/2026 | Walber Santa Helena | 2 | R$ 158.000,00 | — |
| 36 | 94 | 19/08/2026 | Gustavo | 2 | R$ 4.225,00 | — |
| 37 | 95 | 21/08/2026 | Cliente | 1 | R$ 4.800,00 | 96, 97 |
| 38 | 98 | 21/08/2026 | Cliente | 1 | R$ 3.800,00 | — |
| 39 | 99 | 22/08/2026 | Cliente padrão | 9 | R$ 13.412,50 | — |
| 40 | 100 | 22/08/2026 | Martelos | 2 | R$ 4.225,00 | — |
| 41 | 101 | 23/08/2026 | José Aldo Januário | 5 | R$ 14.650,00 | — |
| 42 | 102 | 24/08/2026 | Cliente Padrão | 3 | R$ 399.000,00 | — |
| 43 | 103 | 24/08/2026 | Cliente Padrão | 5 | R$ 734.000,00 | — |
| 44 | 104 | 25/08/2026 | Patrik | 3 | R$ 28.215,00 | — |
| 45 | 105 | 26/08/2026 | H-5 Super | 2 | R$ 20.610,00 | — |

## Matriz de Produtos Comerciais

Todos possuem origem `ERP_UNIVERSAL`, nenhum possui SOP e nenhum está vinculado a Produto operacional.

| Produto ERP / OliMen | source_id | Catálogo? | Preço? | Observação |
|---|---|---|---|---|
| Bica 1.20 X 3.30 M sistema canadense | 111 | Sim | Sim | Catálogo ERP adaptado |
| Bica de 0.60 X 3.30 M sistema canadense | 100 | Sim | Sim | Catálogo ERP adaptado |
| Bica de 0.80 X 3.30 M sistema canadense | 103 | Sim | Sim | Catálogo ERP adaptado |
| Britador 20 - 15 com motor 7.5CV | 15 | Não | Sim | Item cadastral ERP |
| Britador 30 X 20 com motor estacionário 13 com partida e bateria | 9 | Não | Sim | Item cadastral ERP |
| Britador 30 X 20 com motor estacionário 13 com partida e bateria | manual:595d6b057a65dc6b52e854fb6e44012a | Não | Não | Snapshot manual preservado separadamente |
| Britador 60 - 40 com motor elétrico de 50 CV | 134 | Não | Sim | Item cadastral ERP |
| CAIXA DE ALIMENTAÇAO COM QUEBRADOR DE PEDRA 4MX5MX1M DE ABA | 131 | Não | Sim | Item cadastral ERP |
| Centrífuga 5 TON | 10 | Não | Sim | Item cadastral ERP |
| Centrífuga 5 TON | manual:b5f509078b6a5b9edf43fe4d0f8a22a3 | Não | Não | Snapshot manual preservado separadamente |
| Centrifuga TU - 20 | 122 | Sim | Sim | Catálogo ERP adaptado |
| Chapa da frente do motor Mercedes | 130 | Não | Sim | Item cadastral ERP |
| EIXO UNIVERSAL H-0.5 COM ROLAMENTOS | 60 | Não | Sim | Item cadastral ERP |
| Eixo Universal H-3.5 com rolamentos | 126 | Não | Sim | Item cadastral ERP |
| Espaçador de grelhas para aumentar vazão H-8 Super | 137 | Não | Sim | Item cadastral ERP |
| Fechadura da tampa Universal H-3.5 | 125 | Não | Sim | Item cadastral ERP |
| Grelha P/ Universal H-5 Super 0.75mm | 138 | Não | Sim | Item cadastral ERP |
| Grelhas H-10 Caixa Alta (3 MM) | 120 | Não | Sim | Item cadastral ERP |
| Grelhas H8 super 3 mm vazão | 135 | Não | Sim | Item cadastral ERP |
| Grelhas para Universal H-3.5 | 104 | Não | Sim | Item cadastral ERP |
| Jackpot de 1m sistema canadense | 110 | Sim | Sim | Catálogo ERP adaptado |
| Lateral Superior Grande H-10 Caixa Alta | 45 | Não | Sim | Item cadastral ERP |
| Lateral Superior Grande H-6 | 62 | Não | Sim | Item cadastral ERP |
| Lateral Superior Grande H-6 Caixa Alta | 21 | Não | Sim | Item cadastral ERP |
| Lateral Superior Pequena H-6 | 63 | Não | Sim | Item cadastral ERP |
| Lateral Superior Pequena H-6 Caixa Alta | 19 | Não | Sim | Item cadastral ERP |
| MARTELO P/ UNIVERSAL H-0.5 | 61 | Não | Sim | Item cadastral ERP |
| Martelo p/ Universal H-2 | 101 | Não | Sim | Item cadastral ERP |
| Martelo p/ Universal H-3.5 | 108 | Não | Sim | Item cadastral ERP |
| Meia Lua grande para Universal H-3.5 | 118 | Não | Não | Item cadastral ERP |
| Meia Lua Lateral Inferior Bi-Partida H-10 Caixa Alta | 43 | Não | Sim | Item cadastral ERP |
| Meia Lua Lateral Inferior Bi-Partida H-6 Caixa Alta | 18 | Não | Sim | Item cadastral ERP |
| MOINHO H-10 SUPER, COM BASE, ACOPLAMENTOS, CONTRAPESO, ADAPTAÇÃO PARA MOTOR SCANIA, SISTEMA DE EMBREAGEM. | 133 | Não | Sim | Item cadastral ERP |
| Moinho H10 especial | manual:a9068324ed5372fd35dff49df533b5f0 | Não | Não | Snapshot manual preservado separadamente |
| Moinho Triturador de Milho com Motor 50 CV 2 polos, peneira de 6mm capacidade de 10 toneladas por hora | 12 | Não | Sim | Item cadastral ERP |
| MOINHO UNIVERSAL H-0.5 COM BASE E MOTOR ESTACIONARIO | 59 | Sim | Sim | Catálogo ERP adaptado |
| Moinho Universal H-2 | 99 | Sim | Sim | Catálogo ERP adaptado |
| Moinho Universal H-2 com Motor Életrico 30 CV completo com base, polias, correias, proteções e Bica (calha) de 60 X 3.30 | 14 | Não | Sim | Item cadastral ERP |
| Moinho Universal H-3.5 | 102 | Sim | Sim | Catálogo ERP adaptado |
| Moinho Universal H-3.5 completo com motor Mercedes 352 6 Cilindros, radiador, filtro, base, baterias, instalações elétricas, bombinha de agua, Bica de 0.80 X 3.30M Sistema Canadense | 8 | Não | Sim | Item cadastral ERP |
| Moinho Universal H-3.5 completo com motor Mercedes 352 6 Cilindros, radiador, filtro, base, baterias, instalações elétricas, bombinha de agua, Bica de 0.80 X 3.30M Sistema Canadense | manual:2ab9da4fc49f0af136ee3e7bcb3b3368 | Não | Não | Snapshot manual preservado separadamente |
| Moinho Universal H-4 | 121 | Sim | Sim | Catálogo ERP adaptado |
| Moinho Universal H-4 completo com motor elétrico 60 de CV, base, polias, correias, proteções | 117 | Sim | Sim | Catálogo ERP adaptado |
| Moinho Universal H-5 (caixa semi-nova) peças internas novas, com base, motor eletrico semi-novo 75cv, 02 bicas semi-novas de 1.20 X 3.30 M sistema canadense, 02 Jackpots semi-novos de 1M sistema canadense, caixa de alimentação semi nova | 57 | Sim | Sim | Catálogo ERP adaptado |
| Moinho Universal H-5 (caixa semi-nova) peças internas novas, com base, motor estacionário John Deere, radiador, filtro de ar, bateria, 02 bicas semi-novas de 1.20 X 3.30 M sistema canadense, 02 Jackpots semi-novos de 1M sistema canadense, caixa de alimentação semi nova | 58 | Não | Sim | Item cadastral ERP |
| Moinho Universal H-5 Caixa Alta S completo com motor elétrico de 100 CV, base, polias, correias, proteções | 115 | Sim | Sim | Catálogo ERP adaptado |
| Moinho Universal H-5 completo com motor elétrico de 75 CV, base, polias, correias, proteções | 116 | Sim | Sim | Catálogo ERP adaptado |
| Moinho Universal H-6 Caixa Alta completo com motor elétrico de 100 CV, base, polias, correias, proteções | 114 | Sim | Sim | Catálogo ERP adaptado |
| Moinho Universal H - 4 com Base para acoplar em motor do Cliente, adaptacoes etc (Perifericos à parte) | 13 | Não | Sim | Item cadastral ERP |
| MOTOR SCANIA COMPLETO, COM CAIXA DE CÂMBIO, RADIADOR GRANDE, FILTROS DE AR, BATERIA. | 132 | Não | Sim | Item cadastral ERP |
| Parafuso 1/2 X 2.1/2 com porca | 107 | Não | Sim | Item cadastral ERP |
| Parafusos para H-3.5 | 119 | Não | Sim | Item cadastral ERP |
| Pino da tampa p/ Universal H-3.5 | 127 | Não | Sim | Item cadastral ERP |
| Pino p/ Universal H-3.5 | 109 | Não | Sim | Item cadastral ERP |
| Produto automatico 1784641133282 | 3 | Não | Sim | Item cadastral ERP |
| Produto automatico 1784670090709 | 5 | Não | Sim | Item cadastral ERP |
| Queixo furado para Universal H3.5 | 106 | Não | Sim | Item cadastral ERP |
| Queixo H-5 Super | 139 | Não | Sim | Item cadastral ERP |
| Queixo H-8 Super | 136 | Não | Sim | Item cadastral ERP |
| Queixo liso para Universal H-3.5 | 105 | Não | Sim | Item cadastral ERP |
| Queixo Universal H-6 Caixa Alta | 22 | Não | Sim | Item cadastral ERP |
| Recarga de Oxigênio | 129 | Não | Sim | Item cadastral ERP |
| Telhado Completo Universal H-10 Caixa Alta (5 pecas) | 16 | Não | Sim | Item cadastral ERP |
| Telhado Completo Universal H-3.5 | 128 | Não | Sim | Item cadastral ERP |
| Telhado Completo Universal H-6 Caixa Alta (5 pecas) | 17 | Não | Sim | Item cadastral ERP |

## Migrations aplicadas nesta etapa

- `20260827_legacy_commercial_history.sql`
- `20260827_z_commercial_long_names.sql`
- `20260827_zz_legacy_document_append_only.sql`
- `20260827_zzz_fix_legacy_number_order.sql`
- `20260827_zzzz_sync_legacy_mapping_ledger.sql`

As migrations são aditivas; a correção de ordem alterou somente `legacy_number` do lote ERP, preservando IDs e conteúdo.
