# Consolidação do Catálogo — 23/09/2026

Implementação e validação concluídas na branch `feature/comercial-module`. Foram preservadas as alterações que já estavam no working tree e no index. Não houve commit, push, merge ou troca de branch.

## Código comercial

1. **Campo real:** `commercial_products.commercial_number`, tipo `BIGINT`. `commercial_code` continua como referência comercial anterior; `products.internal_code` é o código independente do Estoque.
2. **Allocator:** função existente `assign_commercial_product_number()`, chamada pelo trigger `commercial_products_assign_number` antes de INSERT/UPDATE. Usa o menor inteiro positivo livre e `pg_advisory_xact_lock(hashtextextended('commercial_products_number',0))`. Nenhum allocator adicional foi criado.
3. **Rotas auditadas:** `POST /api/commercial/catalog/products`; `POST /api/commercial/catalog` com Produto operacional legado; criação indireta de item salvo em `commercialQuoteService.js`; INSERTs de `scripts/import-erp-commercial-history.js`; scripts de smoke e INSERTs diretos. A migration histórica de produtos comerciais foi inspecionada, sem alteração. Não existe endpoint próprio para duplicar Produto Comercial. Todos os INSERTs normais omitem `commercial_number` e passam pelo trigger. A proteção no banco também cobre novas rotas e scripts.
4. **Criação direta:** já devolve o número na resposta da mesma transação. Mesmo com preço de referência, criar Produto Comercial não cria automaticamente um Product operacional.
5. **Criação via Catálogo:** usa o mesmo trigger. A criação comercial a partir de `product_id` deixou de copiar o código operacional para a referência comercial; agora o banco atribui a numeração comercial independente.
6. **Concorrência:** duas conexões reais foram testadas; a segunda aguarda o allocator e recebe outro número. Testes também cobrem lacuna, próximo livre, salto de ocupado e criação de uma cópia pelo service sem reaproveitar a identidade anterior.
7. **Constraints:** `NOT NULL`, `UNIQUE(commercial_number)` e `CHECK(commercial_number > 0)` já estavam aplicadas. A unicidade foi exercitada por tentativa rejeitada de INSERT duplicado. O código numérico existente não pode ser alterado pelo trigger e aparece somente para leitura na interface.
8. **Total final:** 88 Produtos Comerciais.
9. **Sem código:** 0.
10. **Códigos numéricos duplicados:** 0.
11. **Preservação:** comparação integral de `id`, `commercial_number` e `commercial_code` antes/depois confirmou igualdade dos 88 registros. Não houve renumeração.

## Ordenação e busca

12. **Implementação:** `listCatalogs()` no backend e seletor “Ordenar por” na aba Comercial > Catálogo.
13. **ASC:** `sort=code_asc`, “Código: menor → maior”; padrão inicial.
14. **DESC:** `sort=code_desc`, “Código: maior → menor”.
15. **Numérica:** `ORDER BY cp.commercial_number`, diretamente no campo BIGINT, com desempate por ID. Valores de ordenação são aceitos por lista explícita. Não há ordenação textual no frontend.
16. **Paginação:** ORDER BY ocorre antes de LIMIT/OFFSET. A tela agora navega em páginas de 20 itens, sem restringir o acesso aos primeiros 100. Alterar a ordenação ou buscar retorna à primeira página. Os maiores/menores códigos globais e a segunda página foram comparados com SQL real.
17. **Filtros:** busca, status e configuração do Catálogo continuam compondo o WHERE antes da ordenação. Testes cobrem ASC/DESC com busca, filtros e paginação.
18. **Busca por código:** a busca existente em `commercial_number::text`, referência comercial e nome foi preservada e validada na API e na interface pública.

## Produto gêmeo operacional

19. **Service:** `ensureCommercialProductOperationalProduct()` em `commercialProductOperationalService.js`, com opções específicas para criação de Catálogo. Reutiliza `insertOperationalProduct()`, também usado pelo cadastro rápido. A política histórica de regularização foi preservada para seus outros chamadores.
20. **Quando cria:** ao criar a primeira versão do Catálogo, sem vínculo atual e sem Product selecionado, com setor ativo informado. O nome vem do Produto Comercial.
21. **Quando não cria:** cadastro comercial isolado, cadastro apenas com preço, vínculo atual já existente, vínculo operacional legado do Catálogo ou Product explicitamente selecionado. O Product existente mantém suas configurações.
22. **Padrão Solda:** preenchido automaticamente na interface quando existe exatamente um setor Solda ativo.
23. **Resolução:** a tela recebe IDs e nomes reais de `/api/commercial/catalog/manufacturing-sectors`; compara o nome aparado, sem distinção de maiúsculas/minúsculas. Nenhum UUID está fixado no código. Sem Solda ou com resultado ambíguo, fica “Selecionar setor”. A ausência de Solda foi simulada somente na resposta de rede do navegador, sem alterar setores reais; a seleção obrigatória foi confirmada.
24. **Tipo:** `manufactured`, já existente no sistema.
25. **Revisão:** `pending_review`, com `creation_origin='commercial'`. A presença em Estoque > Produtos > Pendentes foi confirmada na interface pública.
26. **Vínculo:** grava `commercial_products.operational_product_id` e o vínculo de `product_catalogs` na transação da criação do Catálogo. A resposta atualiza imediatamente o seletor com nome e código reais do Product.
27. **Reload:** vínculo e código comercial permaneceram visíveis após recarregar. Na última execução pública, o comercial temporário recebeu 89 e seu operacional 227.
28. **Mesmo nome:** comparação normalizada exata. O fluxo do Catálogo responde 409 com candidatos, sem vínculo silencioso. A interface oferece selecionar um existente ativo ou confirmar “Criar novo mesmo assim”. As duas decisões foram exercitadas pelos testes de integração.
29. **Duplo clique/concorrência:** trava síncrona no formulário e botão desabilitado durante salvamento; bloqueio `FOR UPDATE` no Produto Comercial; reconsulta do vínculo dentro da transação. Duas chamadas reais simultâneas de criação do Catálogo deixaram um Catálogo e um gêmeo: uma concluiu e a outra recebeu 409. O botão “+” também reutiliza vínculo já existente sob o mesmo bloqueio.
30. **Rollback:** uma ficha técnica inválida, após a tentativa de criação operacional, reverteu o Product e o vínculo. O teste verificou ausência de órfão no banco.
31. **Efeitos operacionais:** custo, peso, volume e unidade permaneceram NULL. Zero componentes, etapas de fabricação, itens de compra, itens vendidos ou outras referências operacionais do Product de teste. Contagens de ordens internas, tarefas, itens vendidos, volumes de expedição, compras e itens de compra permaneceram iguais em teste transacional. O schema atual não possui tabela `stock_movements` nem tabela própria de saldo; o fluxo só insere o cadastro mestre, sem chamar serviços de saldo/movimentação ou produção.

## Botão “+”

32. **Continua funcionando:** criação rápida, seleção imediata e reutilização ao criar o Catálogo foram verificadas na interface pública. Selecionar Product existente elimina a exigência do campo de setor do gêmeo e não cria outro Product.
33. **Regra compartilhada:** ambos os caminhos usam `insertOperationalProduct()` para código operacional, tipo fabricado, setor, NULLs operacionais e revisão pendente. A garantia de vínculo e bloqueio está no mesmo service operacional.

## Arquivos e validações

34. **Arquivos alterados nesta execução:**
    - `backend/src/services/commercialProductOperationalService.js`
    - `backend/src/services/productCatalogService.js`
    - `backend/src/controllers/productCatalogController.js`
    - `backend/src/routes/productCatalogRoutes.js`
    - `src/pages/CommercialCatalogPage/CatalogEditorPage.jsx`
    - `src/pages/CommercialCatalogPage/CatalogPage.jsx`
    - `src/pages/CommercialCatalogPage/CommercialCatalog.css`
    - `tests/commercialOperationalProducts.test.js`
    - `tests/catalogConsolidation.test.js` (novo)
    - `scripts/verify-catalog-consolidation.mjs` (novo)
    - este relatório e evidências em `tmp/catalog-consolidation/`.
35. **Migrations:** nenhuma nova migration; status confirmou 42 aplicadas, 0 pendentes e 0 alteradas. A migration de numeração já existente no working tree foi preservada.
36. **Testes específicos:** 21/21 passaram, abrangendo consolidação, allocator, Catálogo, ciclo de versões, Product operacional, vínculo e cadastro rápido.
37. **`npm test`:** 237/237 passaram, sem falhas ou testes ignorados. A verificação adicional de ausência de efeitos operacionais passou na execução final dos 21 testes específicos.
38. **Build:** `npm run build` passou após as alterações finais. Permanece o aviso do Vite sobre bundle maior que 500 kB. Assets finais: `index-DMOWionE.js` e `index-D7m4dF3M.css`.
39. **Diff:** `git diff --check` retornou 0. Avisos de conversão futura LF/CRLF não indicaram erros de whitespace.
40. **PM2:** `controle-os-backend` e `controle-os-frontend` reiniciados e online. Confirmado que a porta 4173 e o endereço público servem o mesmo JavaScript do dist final.
41. **Smokes:** HTTP 200 em `localhost:3333/api/health`, `localhost:4173`, `https://os.torneadorauniversal.com.br/api/health` e página pública. Interface validada em 390 px e 1440 px, sem overflow horizontal no celular. Fixtures, Catálogos, versões, Products e registros de auditoria temporários do smoke foram removidos. As sequências operacionais podem avançar durante testes/rollback; nenhum código existente foi alterado. Não foram alteradas permissões, papéis ou concessões de RBAC; o endpoint de opções utiliza a permissão de visualização do Catálogo já existente, e não houve necessidade de auditoria RBAC.
42. **Git final:** branch `feature/comercial-module`, working tree com alterações anteriores preservadas e alterações desta entrega. Estado detalhado em `tmp/catalog-consolidation/git-status.txt`. Nenhum comando de commit, push, merge, checkout, switch, reset ou restore foi executado.

## Evidências

- `tmp/catalog-consolidation/numbers-before.json` e `numbers-after.json`: identidade e códigos preservados.
- `tmp/catalog-consolidation/specific.log`: 21 testes específicos.
- `tmp/catalog-consolidation/npm-test.log`: suíte completa.
- `tmp/catalog-consolidation/build.log`, `diff-check.log` e `migration-status.log`.
- `tmp/catalog-consolidation/public-ui.json` e `smokes.json`: validação pública e HTTP.
- `tmp/catalog-consolidation/twin-mobile.png`, `catalog-mobile.png` e `catalog-desktop.png`: evidências visuais com fixtures que já foram removidas.

Conteúdo técnico histórico, versões existentes, PDFs, Orçamentos, Vendas, Produção, Compras, Expedição, Funcionários, Vales, PIS/CTPS, RBAC e Consumíveis não foram objeto de alteração nesta entrega.
