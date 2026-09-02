# 01 — Matriz geral de integração

## Legenda

| Decisão | Significado |
|---|---|
| `REUTILIZAR` | Usar estrutura/valor já oficial no OliMen |
| `COPIAR` | Levar valor da origem após validação simples |
| `ADAPTAR` | Transformar semântica, tipo, enum, formato ou relacionamento |
| `SNAPSHOT` | Congelar no documento/revisão histórica |
| `NOVO CAMPO` | Evoluir tabela existente |
| `NOVA TABELA` | Criar estrutura de domínio/integração |
| `DESCARTAR` | Não transportar no escopo definido |
| `REAVALIAR` | Exige política/decisão humana ou dado insuficiente |

## Cadastros mestres

| Origem ERP Universal | Destino OliMen | Tipo | Transformação | Decisão |
|---|---|---|---|---|
| `produtos.id` | `product_external_ids.source_id` | integer → texto/inteiro externo | Preservar como chave da origem, nunca como UUID local | NOVA TABELA |
| `produtos.nome` | `products.name` | text → varchar | Aparar espaços; não sobrescrever equivalente sem confirmação | ADAPTAR |
| `produtos.descricao` | `products.description` | text | Preservar como descrição geral opcional | NOVO CAMPO |
| `produtos.sku` | `product_external_ids.source_code`; opcionalmente `products.internal_code` | varchar(50) → varchar | Copiar para código local somente sem colisão e com política confirmada | ADAPTAR |
| `produtos.tipo` | `products.type`/`product_types` | enum textual | Tabela de conversão; `conjunto`/`consumivel` exigem revisão | ADAPTAR |
| `produtos.unidade_medida` | `products.measurement_unit_code` | varchar(10) → varchar(20) | Canonicalizar aliases/códigos | ADAPTAR |
| `produtos.preco_venda` | `product_commercial_profiles.reference_sale_price` + item de Orçamento | numeric(12,2) | Preservar como referência opcional; preço emitido é snapshot do item | NOVA TABELA |
| `produtos.status` | `products.is_active` | ativo/inativo → boolean | `ativo=true`, `inativo=false` | ADAPTAR |
| `produtos.criado_em` | metadado de origem/importação | timestamp | Não falsificar `products.created_at`; guardar proveniência se necessário | REAVALIAR |
| `produtos.estoque_minimo` | nenhum no Comercial | numeric | Não importar no primeiro escopo | DESCARTAR |
| `produtos.custo` | nenhum no Comercial | numeric | Dado operacional/Compras | DESCARTAR |
| `produtos.ultimo_preco_compra` | nenhum no Comercial | numeric | Dado de Compras | DESCARTAR |
| ausência na origem | `products.sector_id` | UUID | Não inventar setor; manter existente em equivalentes | REAVALIAR |
| ausência na origem | `products.default_volume_quantity` | integer obrigatório | Não usar `1` como verdade; revisar/permitir pendência controlada | REAVALIAR |
| ausência na origem | `products.default_total_weight_kg` | numeric obrigatório | Não usar `1 kg` como verdade; revisar/permitir pendência controlada | REAVALIAR |
| ausência na origem | `products.review_status` | enum | Novo importado deve ficar pendente até validar campos operacionais | ADAPTAR |
| ausência na origem | `products.creation_origin` | enum manual/purchases | Não representa sistema externo | REUTILIZAR |
| `clientes.id` | `customer_external_ids.source_id` | serial → identidade externa | Não preservar como UUID | NOVA TABELA |
| `clientes.nome` | `customers.name` | varchar(120) | Nome oficial/razão social | COPIAR |
| `clientes.nome_fantasia` | `customers.trade_name` | varchar(120) | Campo ausente no destino | NOVO CAMPO |
| `clientes.cpf_cnpj` | `customers.tax_id` | varchar(20) | Normalizar dígitos; validar; unicidade só para documento válido/não vazio | NOVO CAMPO |
| `clientes.telefone` | `customers.phone` | varchar | Normalizar para matching, preservar exibição | ADAPTAR |
| `clientes.email` | `customers.email` | varchar(120) | Normalizar case/espaços | NOVO CAMPO |
| `clientes.endereco` | `customers.address_line` | text | Não concatenar silenciosamente com `location` | NOVO CAMPO |
| `clientes.numero` | `customers.address_number` | varchar(20) | Preservar como texto | NOVO CAMPO |
| ausência na origem | `customers.address_complement` | varchar/text | Manter nulo | NOVO CAMPO |
| `clientes.bairro` | `customers.neighborhood` | varchar(120) | Preservar | NOVO CAMPO |
| `clientes.cidade` | `customers.city` | varchar(120) | Não usar `location` como destino definitivo | NOVO CAMPO |
| ausência na origem | `customers.state` | char(2) | Não copiar de `destination_uf`; requer enriquecimento/revisão | NOVO CAMPO |
| `clientes.cep` | `customers.postal_code` | varchar(20) | Normalizar sem perder valor original até validação | NOVO CAMPO |
| `clientes.observacoes` | `customers.notes` | text | Preservar | NOVO CAMPO |
| `clientes.status` | `customers.is_active` | enum → boolean | ativo/inativo | NOVO CAMPO |
| `clientes.criado_em` | metadado de origem/importação | timestamp | Preservar apenas se houver necessidade de proveniência | REAVALIAR |
| ausência na origem | `customers.location` | varchar | Legado operacional OliMen; manter sem sobrescrever | REUTILIZAR |
| ausência na origem | `customers.carrier_name` | varchar | Preferência de entrega OliMen; manter | REUTILIZAR |
| ausência na origem | `customers.destination_uf` | char(2) | Destino de entrega, não UF civil | REUTILIZAR |
| `customers.normalized_name UNIQUE` | índice de busca não único | constraint | Retirar unicidade; homônimos devem coexistir | ADAPTAR |

## Empresa e documentos

| Origem ERP Universal | Destino OliMen | Tipo | Transformação | Decisão |
|---|---|---|---|---|
| `configuracoes_empresa.nome_exibido` | `company_settings.nome_fantasia` | varchar | OliMen prevalece; preencher só por decisão administrativa | REUTILIZAR |
| `razao_social` | `company_settings.razao_social` | varchar | OliMen prevalece | REUTILIZAR |
| `cnpj` | `company_settings.cnpj` | varchar | OliMen prevalece/validar | REUTILIZAR |
| `endereco` | `company_settings.endereco/numero/complemento` | text → estruturado | Revisão humana; origem pode estar concatenada | ADAPTAR |
| `cidade`, `estado`, `cep` | campos homônimos | varchar | OliMen prevalece | REUTILIZAR |
| `telefone`, `email` | campos homônimos | varchar | OliMen prevalece | REUTILIZAR |
| `logo_url` | `company_settings.logo_path` | URL/caminho → storage key | Não copiar referência; selecionar/migrar arquivo oficial controladamente | ADAPTAR |
| `responsavel_nome` | `company_settings.nome_representante` | varchar | Confirmar representante oficial | ADAPTAR |
| `assinatura_url` | `company_settings.signature_path` | URL/caminho | Campo ausente; arquivo opcional protegido | NOVO CAMPO |
| `documentos_exibicao` | configuração do renderer | JSONB | Não migrar cegamente; usar defaults OliMen ou configuração geral aprovada | REAVALIAR |
| `logo_documento_largura` | configuração do renderer | integer | Converter apenas se personalização for mantida | REAVALIAR |
| Empresa no momento da emissão | `commercial_quotes.company_snapshot` | JSONB versionado | Congelar dados usados pelo documento | SNAPSHOT |
| PDF emitido | `commercial_quote_documents` + storage | arquivo/hash | Persistir binário oficial; download e impressão usam o mesmo | NOVA TABELA |

## Orçamentos e itens

| Origem ERP Universal | Destino OliMen | Tipo | Transformação | Decisão |
|---|---|---|---|---|
| `orcamentos.id` | `commercial_quotes` + identidade de importação | serial | Novo UUID; preservar ID externo | NOVA TABELA |
| `orcamentos.id` como número exibido | `quote_number` | integer/bigint | Para histórico, preservar número legado em namespace/proveniência; não colidir com sequência local | ADAPTAR |
| `cliente_id` | `commercial_quotes.customer_id` | integer → UUID | Resolver pelo mapa de Clientes | ADAPTAR |
| `cliente_nome` | snapshot de Cliente | varchar | Parte do snapshot, não substitui o FK | SNAPSHOT |
| Cliente atual consultado pelo ERP | snapshots estruturados | vários | Capturar valores disponíveis na extração e registrar limitação histórica | SNAPSHOT |
| `desconto_geral` | `general_discount_amount` | numeric(12,2) | Preservar regra de cálculo | COPIAR |
| `status` | `commercial_quotes.status` | enum | Mapear rejeitado→refused; aprovação sem efeito operacional | ADAPTAR |
| `criado_em` | `created_at`/`source_created_at` | timestamp | Auditoria; não confundir com data comercial | ADAPTAR |
| `data_orcamento` | `commercial_date` | date | Preservar exatamente | COPIAR |
| `observacoes` | `notes_snapshot`/`notes` | text | Congelar na revisão emitida | SNAPSHOT |
| `itens_orcamento.produto_id` | `commercial_quote_items.product_id` | integer → UUID | Resolver por `product_external_ids` | ADAPTAR |
| ausência de código persistido no item | `product_code_snapshot` | varchar | Histórico ERP pode usar ID legado exibido; novos usam código local da emissão | SNAPSHOT |
| `nome_customizado`/Produto atual | `product_name_snapshot` | text | Definir nome efetivamente exibido | SNAPSHOT |
| `descricao` | `description_snapshot` | text | Preservar texto comercial do item | SNAPSHOT |
| ausência de unidade persistida | `measurement_unit_snapshot` | varchar | Histórico exige reconstrução registrada; novos congelam na emissão | SNAPSHOT |
| `quantidade` | `quantity` | numeric(12,2) | Preservar | COPIAR |
| `preco_unitario` | `unit_price` | numeric(12,2) | Congelar | SNAPSHOT |
| `desconto_valor` | `unit_discount_amount` | numeric(12,2) | Documentar que no ERP é por unidade | ADAPTAR |
| `desconto_percentual` | `discount_percent` | numeric(12,2) | Valor absoluto tem precedência quando > 0 | ADAPTAR |
| total calculado | `line_total_snapshot` | numeric | Persistir resultado/versão da fórmula na emissão | SNAPSHOT |
| `incluir_catalogo` | `include_catalog` | boolean | Manter regra por item | COPIAR |
| `catalogo_versao_id` | `product_catalog_version_id` | integer → UUID | Resolver versão exata, FK restritiva | ADAPTAR |
| formas de pagamento | `commercial_quote_payment_methods` | linhas | Copiar ordem, forma, valor e quantidade de parcelas | NOVA TABELA |
| parcelas | `commercial_quote_installments` | linhas | Copiar número, vencimento e valor | NOVA TABELA |

## Catálogo Técnico

| Origem ERP Universal | Destino OliMen | Tipo | Transformação | Decisão |
|---|---|---|---|---|
| `catalogo_produto` | `product_catalogs` | 1:1 Produto | Resolver Produto pelo mapa; não duplicar catálogo por origem | NOVA TABELA |
| `possui_catalogo` | `is_enabled`/existência | boolean | Preservar elegibilidade, sem invalidar Produto sem catálogo | ADAPTAR |
| `categoria_catalogo` | `category` | enum | equipamento/acessorio/peca/servico | COPIAR |
| `catalogo_versoes.id` | identidade de importação | serial | Novo UUID + mapa externo | ADAPTAR |
| `versao` | `version_number` | integer | Preservar por catálogo | COPIAR |
| `nome_comercial` | campo homônimo | text | Preservar | COPIAR |
| `subtitulo`, `descricao_comercial`, `aplicacoes`, `observacoes` | campos homônimos | text | Preservar nulos | COPIAR |
| `ordem_catalogo` | `catalog_order` | integer | Preservar | COPIAR |
| `ativo` | `is_active`/publicação | boolean | Uma ativa por catálogo; versão publicada permanece bloqueada | ADAPTAR |
| imagens | `product_catalog_images` + storage OliMen | linhas/arquivo | Copiar conteúdo, gerar nova storage key, hash e ordem | ADAPTAR |
| especificações | `product_catalog_specifications` | linhas ordenadas | Preservar nome/valor/ordem | NOVA TABELA |
| itens inclusos | `product_catalog_included_items` | linhas ordenadas | Preservar descrição/ordem | NOVA TABELA |
| caminhos compartilhados entre versões | arquivos independentes ou assets imutáveis | caminho | Nunca compartilhar arquivo mutável sem controle de referências | ADAPTAR |

## Fora do contrato inicial

| Origem ERP Universal | Destino OliMen | Tipo | Transformação | Decisão |
|---|---|---|---|---|
| movimentos/saldos/reservas | Estoque | operacional | Não transportar nem disparar | DESCARTAR |
| componentes/BOM/ordens/tarefas | Produção | operacional | Não transportar | DESCARTAR |
| aprovação → venda/reserva/produção/entrega | apenas status comercial | efeito colateral | Remover efeitos; auditar estado | ADAPTAR |
| Compras/Financeiro | módulos existentes | operacional | Formas do Orçamento não criam título financeiro | DESCARTAR |
| usuários/roles do ERP | RBAC OliMen | segurança | Não migrar; criar Permissões na convenção OliMen | REUTILIZAR |
