# Dry-run — Orçamentos históricos do ERP Universal

Data da análise: 27/08/2026  
Modo: `READ_ONLY_DRY_RUN`  
Origem: `ERP_UNIVERSAL`  
Identidade estável da origem: `orcamentos.id`

## Escopo e segurança desta execução

- Nenhum Orçamento foi importado.
- Nenhuma migration foi criada ou aplicada.
- Nenhuma tabela ou registro foi alterado.
- As duas conexões PostgreSQL foram abertas com `BEGIN TRANSACTION READ ONLY` e encerradas com `ROLLBACK`.
- Nenhum PDF foi copiado.
- Não houve commit, push ou merge.

## Resultado executivo

| Verificação | Resultado |
|---|---:|
| Orçamentos ERP | **47** |
| Intervalo numérico | **#2 a #105** |
| Orçamentos com número >= 250 | **0** |
| Duplicidades de número | **0** |
| Lacunas entre #2 e #105 | **57 números** |
| Linhas de itens | **114** |
| Orçamentos sem linhas | **0** |
| Orçamentos sem `cliente_id` na origem | **41** |
| Orçamentos sem nome snapshot | **0** |
| PDFs oficiais persistidos e validados | **0** |
| Orçamentos sem PDF oficial validado | **47** |
| Período comercial | **30/05/2026 a 26/08/2026** |
| Número comercial atual no OliMen | **#250** |
| Conflitos exatos de numeração | **0** |

A condição de parada por número ERP maior ou igual a 250 **não foi acionada**. A importação ainda não está autorizada: este documento é apenas o dry-run para revisão.

## Numeração e duplicidades

No ERP, `orcamentos.id` é simultaneamente chave primária e número mostrado. Por isso, duplicar o mesmo número dentro da tabela é impedido pelo próprio banco. Não foi encontrada colisão entre a origem (#2–#105) e a faixa moderna do OliMen, atualmente com #250.

Existem 57 lacunas no intervalo. Elas devem ser preservadas; a importação não deve criar registros artificiais nem compactar a sequência.

Foi encontrado um grupo de conteúdo exatamente repetido nos Orçamentos **#95, #96 e #97**. Como os números são identidades históricas distintas, a proposta padrão é importar os três e apenas sinalizar o grupo. Não deve haver merge automático.

Também foram identificados três registros com aparência de teste pelo nome do Cliente: **#2, #3 e #4**. A inclusão ou exclusão precisa de decisão humana antes da execução real.

## Itens, descontos e totais

O ERP possui 114 linhas de itens, incluindo:

- 4 itens sem `produto_id`;
- 30 itens marcados para incluir Catálogo;
- 0 itens com Catálogo marcado e versão ausente;
- 0 itens com desconto absoluto e percentual simultaneamente;
- 8 linhas com quantidade física maior ou igual a 100 — continuam sendo 8 linhas na contagem da listagem.

Totais reconstruídos pelo dry-run usando a fórmula real do ERP:

| Componente | Total agregado |
|---|---:|
| Bruto | R$ 5.508.205,00 |
| Descontos dos itens | R$ 162.800,00 |
| Desconto geral | R$ 10,00 |
| Final calculado | R$ 5.345.395,00 |

Fórmula da origem:

1. bruto da linha = quantidade × preço unitário;
2. se `desconto_valor > 0`, ele é desconto **por unidade** e é multiplicado pela quantidade;
3. senão, aplica-se `desconto_percentual` ao bruto;
4. total = máximo entre soma líquida das linhas menos desconto geral e zero.

Limitação importante: o ERP **não armazena** subtotal, frete ou total final no cabeçalho. O valor acima é reproduzido a partir das linhas e da fórmula da origem, não lido de um campo histórico selado. Em 46 Orçamentos, a soma das formas de pagamento confere com o total calculado, sem divergência de centavos. O #4 não possui forma de pagamento e não pode ser comparado.

Proposta: persistir na importação os valores reconstruídos, a fórmula `ERP_UNIVERSAL_V1`, a data de extração e `total_provenance = reconstructed_from_source_rows`. Não apresentá-los como “total oficial armazenado pelo ERP”. Frete deve ficar `NULL/not_available`, e não ser inventado como zero.

## Clientes

- 41 dos 47 Orçamentos não possuem vínculo `cliente_id` na origem, mas todos possuem `cliente_nome`.
- Os outros 6 apontam para 5 Clientes mestre do ERP.
- Nenhum dos 5 Clientes mestre teve correspondência segura no OliMen por CPF/CNPJ ou nome normalizado.

Na execução real, portanto, nenhum vínculo a `customers` deve ser feito automaticamente com as evidências atuais. Todos os históricos conseguem abrir usando o snapshot de nome. Eventuais vínculos devem ser decididos e registrados numa etapa de conciliação, sem criar Cliente mestre só para satisfazer a FK.

## Status e pagamento

Status encontrados:

| Status ERP | Quantidade |
|---|---:|
| `rascunho` | 44 |
| `aprovado` | 1 |
| `rejeitado` | 2 |

Eles devem ser preservados em `legacy_status`, sem executar transições modernas. Em especial, `aprovado` histórico não pode criar Venda, Produção, reserva ou qualquer efeito operacional.

Pagamento:

- 46 Orçamentos possuem forma de pagamento;
- 47 linhas de forma de pagamento no total;
- 45 Orçamentos usam PIX, um deles com duas linhas;
- 1 usa boleto;
- somente 1 parcela detalhada está persistida;
- o #4 não possui forma de pagamento.

## PDFs

O ERP não possui tabela ou storage oficial de PDFs congelados. O endpoint atual regenera o documento sob demanda a partir dos dados vivos, portanto esse resultado não pode ser chamado de original histórico.

Foram encontrados 11 PDFs na pasta de desenvolvimento `output/pdf`. Nove são arquivos de validação de renderer. Dois nomes apontam para o Orçamento #83:

| Arquivo candidato | Tamanho | SHA-256 |
|---|---:|---|
| `orcamento-83-documento-unificado.pdf` | 17.991.906 bytes | `ac071e486a2e35e55d47f825e5274b0a6e37722dd4d798a71dc06429e60d7d8b` |
| `orcamento-83-tabela-itens-refinada.pdf` | 17.991.906 bytes | `213c495fb569a68ae3da81ede440ee23911c1064677b3b01b780c754ed7160f5` |

Os hashes diferentes mostram que são documentos distintos. Eles permanecem apenas como candidatos e precisam de validação humana de autoria/finalidade. Até essa validação, a contagem oficial é **0 com PDF e 47 sem PDF**.

### Storage proposto

Guardar somente documentos comprovadamente históricos em storage protegido e imutável, fora da pasta pública:

`commercial-quotes/legacy/ERP_UNIVERSAL/{source_id}/{sha256}.pdf`

Metadados em `commercial_legacy_quote_documents`:

- `legacy_quote_id`;
- `source_system`, `source_id`;
- `storage_key`;
- `original_filename` e caminho de origem auditável;
- `mime_type`, `byte_size`, `sha256`;
- `document_kind = original_historical` somente após validação;
- `import_run_id`, `imported_at`, `validated_by`, `validated_at`.

Download deve ocorrer por endpoint autenticado. Arquivo regenerado depois pode ser guardado como `reconstructed_copy`, nunca como original e nunca sobrescrevendo outro hash.

## Mapeamento de campos

### Cabeçalho

| ERP Universal | Destino legado proposto | Regra |
|---|---|---|
| `orcamentos.id` | `legacy_number` + `source_id` | Exibir # original; não usar como UUID local |
| constante | `source_system` | `ERP_UNIVERSAL` |
| `cliente_id` | `source_customer_id` | Somente rastreabilidade da origem |
| conciliação segura | `customer_id` | Nullable; atualmente nenhum match automático |
| `cliente_nome` | `customer_name_snapshot` | Verdade histórica disponível |
| `data_orcamento` | `quote_date` | Preservar data comercial |
| `criado_em` | `source_created_at` | Não confundir com data de importação |
| `status` | `legacy_status` | Não mapear para workflow moderno |
| `observacoes` | `notes_snapshot` | Imutável |
| `desconto_geral` | `general_discount_amount` | Valor absoluto da origem |
| ausente | `freight_amount` | `NULL`, com proveniência “não disponível” |
| calculado | totais snapshot | Congelar com fórmula/proveniência |

### Itens

| ERP Universal | Destino legado proposto | Regra |
|---|---|---|
| `itens_orcamento.id` | `source_item_id` | Idempotência |
| `produto_id` | `source_product_id` | Não criar nem vincular Produto automaticamente |
| `nome_customizado` | `product_name_snapshot` | Preferência de nome; fallback extraído deve ser marcado reconstruído |
| `descricao` | `description_snapshot` | Preservar |
| `quantidade` | `quantity` | Preservar decimal |
| `preco_unitario` | `unit_price` | Preservar |
| `desconto_valor` | `unit_discount_amount` | No ERP é desconto por unidade |
| `desconto_percentual` | `discount_percent` | Usado só quando desconto absoluto é zero |
| calculado | bruto, desconto e líquido da linha | Congelar com `ERP_UNIVERSAL_V1` |
| `incluir_catalogo` | `legacy_include_catalog` | Informação histórica, não seleção de Catálogo atual |
| `catalogo_versao_id` | `source_catalog_version_id` | Não vincular/publicar Catálogo atual automaticamente |

### Pagamentos

| ERP Universal | Destino legado proposto |
|---|---|
| `forma` | `legacy_method` + tipo normalizado de exibição |
| `valor` | `amount` |
| `parcelas` | `installment_count` |
| `ordem` | `line_order` |
| número/data/valor de parcela | snapshot da parcela histórica |

## Estrutura legacy/origem proposta

Recomendação: manter os históricos em tabelas dedicadas e servi-los dentro do mesmo módulo **Comercial > Orçamentos**:

- `commercial_legacy_quotes`;
- `commercial_legacy_quote_items`;
- `commercial_legacy_quote_payment_methods`;
- `commercial_legacy_quote_installments`;
- `commercial_legacy_quote_documents`;
- `integration_import_runs` para lote, hash e auditoria.

Razões:

- não altera a constraint moderna que reserva `commercial_number >= 250`;
- não mistura `legacy_status` com estados atuais;
- reduz o risco de consultas futuras de Venda/Produção capturarem um histórico aprovado;
- permite `customer_id`, Produto e PDF ausentes sem degradar o modelo moderno;
- torna a imutabilidade mais simples de aplicar.

Constraints principais:

- `UNIQUE (source_system, source_id)`;
- `UNIQUE (source_system, legacy_number)`;
- `legacy_number BETWEEN 1 AND 249` para `ERP_UNIVERSAL`;
- snapshots e totais ficam bloqueados após `locked_at`;
- update/delete bloqueados no service e por trigger de banco após o fechamento do lote.

A API de listagem pode unir atuais e antigos em uma resposta comum, sem expor ao usuário a separação física das tabelas.

## Listagem e detalhe propostos

Dentro de **Comercial > Orçamentos**:

- filtro simples `Todos | Atuais | Antigos`;
- listagem com número, Cliente snapshot, data, status/origem, `COUNT` de linhas e total snapshot;
- badge `ERP antigo`;
- detalhe sem controles de edição, alteração de número ou transição de status;
- PDF apenas quando houver arquivo histórico validado;
- ausência de PDF exibida explicitamente.

No mobile, cada registro vira card com número, Cliente, data, linhas, total e origem. A implementação deverá ser testada em 320, 375, 390, 430 e 768 px, sem tabela com largura mínima ou ações fora do viewport.

## “Duplicar para novo orçamento”

Proposta de endpoint: `POST /api/commercial/legacy-quotes/:id/duplicate`.

Operação transacional e auditada:

1. lê o histórico bloqueado, sem alterá-lo;
2. reserva o próximo `commercial_number` moderno pelo contador existente — hoje seria #251, pois #250 já existe;
3. cria um novo `commercial_quotes` com `status = draft`;
4. registra `duplicated_from_legacy_quote_id` ou evento equivalente no histórico moderno;
5. copia Cliente snapshot, condições, pagamento, observações, quantidades, preços e descontos;
6. usa `customer_id` somente se houver vínculo humano/seguro; caso contrário mantém snapshot e exige resolução antes de emitir;
7. usa `commercial_product_id` somente quando existir mapeamento confirmado;
8. sem mapeamento, cria item moderno manual/snapshot com `save_product_requested = false`;
9. não copia Catálogo histórico como Catálogo atual publicado;
10. não cria Produto Comercial, `products`, Venda, Produção, Estoque, reserva, Compra, Expedição, tarefa ou etiqueta.

Permissões: visualizar usa `commercial.quotes.view`; duplicar usa `commercial.quotes.create`. O backend precisa negar toda rota mutável para a entidade legacy, exceto a clonagem que grava apenas no domínio moderno.

## Riscos

1. **Total sem campo oficial:** todos os totais dependem da reconstrução da fórmula da origem.
2. **PDFs não congelados:** não há acervo oficial identificado; regenerar hoje usaria dados vivos.
3. **Clientes:** 41 sem FK na origem e zero correspondências locais seguras no dry-run.
4. **Registros de teste:** #2, #3 e #4 parecem testes.
5. **Conteúdo repetido:** #95, #96 e #97 são idênticos, mas têm números históricos distintos.
6. **Catálogo:** 30 itens carregam intenção/versão antiga, que não deve virar publicação atual.
7. **Status aprovado:** o único aprovado precisa permanecer puramente histórico.
8. **Snapshot incompleto:** código/unidade do item e dados completos do Cliente não foram congelados pelo ERP.
9. **Imutabilidade:** apenas esconder botões não basta; API e banco devem impedir mutação.
10. **Duplicação órfã:** um novo rascunho pode nascer sem Cliente mestre; a emissão deve exigir revisão.

## Decisões humanas necessárias antes da importação

1. Confirmar se os Orçamentos #2, #3 e #4, com aparência de teste, entram no histórico.
2. Confirmar que #95, #96 e #97 devem permanecer como três históricos separados.
3. Aceitar ou rejeitar o uso de totais reconstruídos com rótulo/proveniência explícitos.
4. Decidir se o #4 pode ser importado sem forma de pagamento ou se requer correção documental.
5. Validar se algum dos dois PDFs candidatos do #83 é realmente documento histórico oficial; sem prova, nenhum deve ser importado como original.
6. Revisar manualmente os 5 Clientes mestre do ERP caso se deseje criar vínculos com `customers`.
7. Aprovar a estrutura em tabelas legacy dedicadas, em vez de relaxar as constraints do fluxo moderno.
8. Definir a política de retenção/LGPD e quem pode baixar documentos históricos.

## Reprodutibilidade

O analisador está em `scripts/dry-run-erp-legacy-quotes.js`. Ele apenas executa `SELECT`, varre arquivos PDF e encerra ambas as transações com `ROLLBACK`. Uma futura execução real deve ser outro comando, com outro modo explícito e somente após aprovação deste relatório.
