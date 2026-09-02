# Transição: Produto Comercial e Catálogo

## Domínios

- `products` continua sendo o Produto operacional de Estoque, Produção, tarefas,
  serviços, componentes, custos, setores, volumes e rotas.
- `commercial_products` é o Produto apresentado e vendido pelo Comercial. Ele
  pode existir sem Produto operacional, preço, SOP ou Catálogo Técnico.
- `commercial_products.operational_product_id` é apenas uma referência
  administrativa opcional. Não é BOM, roteiro ou configuração industrial.

## Catálogo

`product_catalogs.commercial_product_id` passa a identificar a raiz comercial.
O campo legado `product_id` permanece opcional e não foi apagado. Catálogos que
já existiam foram associados, por backfill, a um Produto Comercial próprio e
mantiveram o vínculo operacional original.

Preço de referência, descrição usada pelo perfil e SOP permanecem fisicamente
em `product_catalogs`. Uma linha sem versões funciona como o perfil comercial de
preço/SOP; a UI só considera “Catálogo Técnico configurado” quando existe ao
menos uma `product_catalog_versions`.

## Orçamentos

Novas buscas priorizam Produtos Comerciais ativos. Produtos operacionais ainda
aparecem como origem `operational_legacy` quando não há Produto Comercial ativo
ligado a eles. Itens históricos continuam aceitando `product_id` e preservam os
snapshots anteriores.

Itens de Produto Comercial congelam:

- `commercial_product_id`;
- código, nome e descrição comerciais em colunas de snapshot;
- preço de referência e SOP;
- `product_catalog_id` e `product_catalog_version_id`;
- preço efetivamente proposto.

O PDF prefere os snapshots comerciais e carrega exclusivamente a versão de
Catálogo congelada no item. SOP e Produto operacional nunca são enviados ao PDF.

## Item manual e “Salvar produto”

- marcado: cria `commercial_products` e um perfil comercial com o preço do item;
  não insere em `products` e não aciona Produção;
- desmarcado: persiste apenas o item manual do Orçamento;
- nome comercial exatamente existente: retorna
  `COMMERCIAL_PRODUCT_DUPLICATE`, com o cadastro candidato, para que o vendedor
  o selecione ou desmarque a opção. Não existe merge automático.

## Próxima fase (não implementada)

Uma futura Configuração Industrial poderá relacionar um Produto Comercial a
vários Produtos internos, componentes, serviços e setores. O vínculo opcional
atual não deve ser promovido automaticamente a essa configuração.
