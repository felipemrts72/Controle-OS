# 05 — Catálogo Técnico versionado

## Decisão

Catálogo pertence ao Produto mestre, não ao módulo Comercial. A interface natural é uma aba/subrota em Produtos. O Comercial apenas seleciona e referencia versões ao compor o Orçamento.

Estrutura:

```text
products
└── product_catalogs (0..1)
    └── product_catalog_versions (0..N)
        ├── product_catalog_images
        ├── product_catalog_specifications
        └── product_catalog_included_items
```

Produto sem Catálogo continua ativo e utilizável.

## Mapeamento de tabelas

### `catalogo_produto` → `product_catalogs`

| Origem | Regra | Destino | Decisão |
|---|---|---|---|
| `id` | serial | UUID/identidade de importação | Novo ID; mapear |
| `produto_id` | unique, FK cascade | `product_id UUID UNIQUE` | Resolver em `product_external_ids` |
| `possui_catalogo` | boolean default false | `is_enabled` ou estado | Preservar sem invalidar Produto |
| `categoria_catalogo` | equipamento/acessorio/peca/servico | `category` | Copiar enum |
| timestamps | auditoria | created/updated | Importar/proveniência conforme política |

### `catalogo_versoes` → `product_catalog_versions`

| Origem | Regra | Destino | Decisão |
|---|---|---|---|
| `id` | serial | UUID + mapa externo | Não preservar PK |
| `catalogo_id` | FK cascade | `product_catalog_id` | Resolver mapa |
| `versao` | integer > 0, unique por catálogo | `version_number` | Preservar |
| `nome_comercial` | obrigatório | `commercial_name` | Copiar |
| `subtitulo` | nullable | `subtitle` | Copiar |
| `descricao_comercial` | nullable | `commercial_description` | Copiar |
| `aplicacoes` | nullable | `applications` | Copiar |
| `observacoes` | nullable | `notes` | Copiar |
| `ordem_catalogo` | nullable | `catalog_order` | Copiar |
| `ativo` | uma ativa por catálogo | publicação/ativa | Adaptar para estado persistente e imutabilidade |
| timestamps | auditoria | timestamps + `published_at/locked_at` | Acrescentar selo permanente |

### Filhos da versão

- imagens: caminho, legenda, ordem e principal;
- especificações: ordem, nome e valor;
- itens inclusos: ordem e descrição.

As ordens devem ser explícitas, estáveis e fazer parte do conteúdo versionado.

## Imutabilidade

No ERP, o bloqueio é derivado da existência atual de item de Orçamento apontando a versão. Se todas as referências forem removidas, a versão pode voltar a ser editável. Isso não é suficiente para história forte.

Contrato no OliMen:

1. versão em rascunho pode ser editada;
2. publicar/ativar grava `published_at`/`locked_at` e torna todo o agregado imutável;
3. qualquer versão referenciada por Orçamento também é imutável, independentemente do estado;
4. edição técnica posterior clona para novo `version_number`;
5. imagem, especificação e item incluso herdam o bloqueio;
6. ativar outra versão não altera Orçamentos existentes;
7. não existe “desbloqueio” por exclusão de referência.

Uma constraint/índice deve assegurar uma versão ativa por catálogo. A invariância de bloqueio também precisa de validação transacional no service.

## Migração de versões

Ordem obrigatória:

1. resolver Produto;
2. criar/reutilizar Catálogo por Produto;
3. mapear todas as versões por `(source catalog, version_number/source_id)`;
4. migrar conteúdo textual;
5. migrar e validar imagens;
6. ativar a versão correspondente somente depois de o agregado estar completo;
7. validar referências dos itens históricos;
8. selar versões importadas que já eram usadas ou publicadas.

Uma reexecução encontra a mesma versão pela identidade externa e pelo número dentro do Catálogo; não cria nova versão.

## Imagens e compartilhamento entre versões

Ao clonar versão, o ERP cria novas linhas que podem apontar para o mesmo arquivo físico. Excluir uma imagem só remove o arquivo quando o contador de referências chega a zero. Copiar caminhos literalmente para o destino manteria acoplamento perigoso e dependência do filesystem antigo.

Estratégia segura recomendada:

- cada relação de imagem no destino recebe storage key OliMen e hash SHA-256;
- por padrão, copiar o conteúdo para arquivo imutável pertencente à versão, mesmo que isso duplique bytes;
- alternativa otimizada: asset content-addressed compartilhado, mas apenas com tabela/referência explícita e exclusão após zero referências;
- nunca compartilhar um caminho mutável sem controle;
- nunca apagar arquivo durante importação/reexecução;
- comparar hash, dimensões e MIME após a cópia futura.

O manifesto deve reconhecer que várias linhas fonte podem ter o mesmo caminho/hash e registrar a estratégia escolhida.

## Catálogo no Orçamento e PDF

- `commercial_quote_items.product_catalog_version_id` aponta a versão exata com FK restritiva;
- `include_catalog=true` exige versão não nula e elegível;
- a emissão valida que versão e Produto do item pertencem ao mesmo Catálogo;
- páginas de Catálogo não têm assinatura nem rodapé comercial de assinatura;
- fichas iguais são deduplicadas por `(product_id, version_id)`, não apenas por Produto;
- a ordem das fichas é determinística, baseada na ordem dos itens e `catalog_order` definido.

## Permissões

Convenção recomendada, integrada ao domínio Produto:

- `products.catalog.view`;
- `products.catalog.edit`;
- `products.catalog.publish`.

Se a implementação exigir códigos sem segundo ponto, usar `product_catalogs.view/edit/publish`; a decisão deve ser uniforme no catálogo de Permissões, middleware e frontend. Não reutilizar `products.edit` como autorização suficiente para publicar versão histórica.

## UI futura

A página/modal atual de edição de Produto não possui abas técnicas robustas. Recomenda-se detalhe de Produto com subrota/aba **Catálogo Técnico**, mantendo o padrão visual OliMen: PageHeader/Card, tabelas responsivas, Modal/ConfirmModal, Toast e estados de loading/empty/error.

Versões devem mostrar estado (rascunho/publicada/inativa), número, data, autoria, uso em Orçamentos e ações permitidas. Conteúdo bloqueado deve ser visível em modo leitura.

## Integridade e exclusão

- não apagar fisicamente Catálogo/versão usada;
- inativar Produto não remove Catálogo nem quebra PDF histórico;
- exclusão de versão em rascunho só é possível sem referências;
- arquivos só são removidos após commit de DB e confirmação de ausência de referência;
- falha parcial DB/filesystem exige compensação e relatório, pois não há transação única.

