Auditoria do Catálogo Técnico — 21/09/2026

Status: persistência, imagem, numeração, vínculo e deploy validados. O 502 informado pelo usuário NÃO foi reproduzido e NÃO está declarado resolvido. Não há evidência suficiente para afirmar a camada de origem ou a causa raiz dessa ocorrência.

1. **Requisição exata:** o botão faz, em sequência, `PUT /api/commercial/catalog/products/0592a871-cb8d-4e45-88c2-f3625dac2a5f`, `PUT /api/commercial/catalog/versions/c320b7f2-e422-4782-a681-d27a985f5cb3` e GET da ficha. Não foi possível determinar qual deles devolveu o 502 no celular, pois nenhum falhou nesta reprodução.
2. **Origem do 502:** indeterminada. Backend 3333, proxy 4173 e caminho público responderam 200 aos PUTs antes e depois das alterações.
3. **Causa raiz:** não comprovada. Não houve reprodução de timeout, ECONNRESET, ECONNREFUSED, socket hang up, excesso de body ou reinício durante o salvamento. Não foi atribuída falha genérica ao Cloudflare.
4. **Ausência no log backend:** os logs anteriores não eram access logs; registravam inicialização e erros internos tratados. A ausência de registro não permite concluir que a requisição não chegou. Agora proxy e backend registram entrada/saída, método, caminho, tamanho, duração, status e X-Request-ID, sem conteúdo ou credenciais.
5. **Alterações realizadas:** JSON limitado aos campos editáveis, mensagem “Alterações salvas.”, mensagem útil e HTTP 502 real para erro de proxy, rastreamento correlacionado. Sem retry, sem conversão de falha em 200. Estas melhorias não constituem prova de correção do 502 original.
6. **Local 3333:** PUT ficha 200/21 ms; PUT versão 200/17 ms na execução final de persistência.
7. **Via 4173:** PUT ficha 200/10 ms; PUT versão 200/12 ms.
8. **Público:** PUT ficha 200/91 ms; PUT versão 200/96 ms; botão real em navegador mobile de 390 px também validado. É emulação Chromium/Edge, não o aparelho físico do usuário.
9. **Status 502:** aberto para correlação da próxima ocorrência. É necessário o horário/request ID da falha para localizar a camada; não se afirma encerramento.
10. **Sete grupos:** título, subtítulo, apresentação, especificações, itens inclusos, aplicações e observações alterados temporariamente e conferidos individualmente.
11. **Reload/reabertura:** todos conferidos após reload e após fechar a página e abri-la novamente pelo hostname público.
12. **Banco:** verificados diretamente product_catalog_versions, product_catalog_specifications e product_catalog_included_items. Conteúdo original restaurado e novamente conferido. Auditoria e updated_at registram os testes, como esperado.
13. **Versões:** versão 3 permaneceu versão 3; quantidade antes/depois: 3. Nenhuma nova versão criada pelo teste.
14. **Imagem:** imagem f10ddd04-b3f9-46ab-ac5a-77ae605d997f, 3.036.244 bytes, preservada. Hash SHA-256 673d6d73e1e25c28f19abc769da53d8eddb9df50f67ed3144a52c4bd2afe7c99 idêntico. Sem duplicação, upload ou bytes/base64 no save. Antes havia apenas metadados no JSON; agora nem esses metadados são reenviados.
15. **Build:** npm run build concluído; bundle index-JHvHThVh.js. Build anterior index-Ci9izcAg.js, de 17/09, estava igual em localhost/público; o teste anterior já exibia o fluxo UPDATE. Não foi comprovado build obsoleto como causa do 502.
16. **Porta 4173:** PM2 controle-os-frontend, server.js, cwd C:\Users\Win 10\Documents\Controle-OS. Proxy target padrão http://127.0.0.1:3333. Backend PM2 controle-os-backend, backend/src/server.js no mesmo cwd.
17. **Bundle servido:** bytes iguais no dist, localhost:4173 e hostname público. SHA-256 c4406a6e6bf78fb51c02066a7c18151122b2a53a5ff20c3d77093bf83b135e19.
18. **Códigos anteriores:** existia commercial_code opcional; não existiam allocator/UNIQUE numérico. Implementada migration 20260921_commercial_product_numbers.sql. O número canônico está em commercial_number; commercial_code preserva referências anteriores, inclusive as 9 alfanuméricas. Nos sem referência, também recebe o novo número como texto.
19. **Total:** primeiro retrato 87; total final 88. Um produto real foi criado durante a auditoria, antes da migration, confirmado em audit_logs. Esse produto não foi excluído nem tratado como fixture.
20. **Sem código antes:** 51 no primeiro retrato; 52 incluindo o produto criado durante a auditoria. O histórico desse produto confirma commercial_code NULL antes da migration.
21. **Atribuições:** 61 novos números = 52 sem código + 9 com referência alfanumérica. Os 27 códigos numéricos existentes foram reaproveitados. Todas as 36 referências anteriores foram preservadas exatamente.
22. **Sem número ao final:** zero; NOT NULL e CHECK > 0 no banco.
23. **Duplicidades:** zero. UNIQUE em commercial_number e em commercial_code. Testes de concorrência em duas conexões e bloqueio advisory transacional aprovados; inserção automática e rejeição de duplicação verificadas.
24. **Faixa:** mínimo 1, máximo 88. Cada atribuição histórica foi comparada ao menor inteiro positivo livre, na ordem created_at,id.
25. **Frontend:** lista e ficha mostram commercial_number, somente leitura. Referência anterior é exibida quando diferente. Jackpot comercial 84; operacional 166. Códigos independentes; removida a inferência de vínculo apenas por igualdade entre os códigos.
26. **Seletor operacional:** existente, preservado e validado com o produto selecionado após reload.
27. **Botão +:** não existia; implementado ao lado do seletor, com permissão products.create além da edição/criação comercial.
28. **Modal:** reutiliza ConfirmModal; nome pré-preenchido, setores ativos reais da API, criação mínima reutilizando o serviço operacional existente.
29. **Revisão:** produto criado como pending_review, creation_origin commercial, sem custo operacional definido.
30. **Vínculo:** criação e vínculo ao Commercial Product na mesma transação; selecionado na interface e persistente após reload. Em um cadastro comercial ainda novo, a seleção é enviada ao criar a ficha.
31. **Efeitos:** zero componentes, etapas de fabricação, itens vendidos, itens de orçamento, itens de solicitação de compra, imagens operacionais ou perfis comerciais no produto de teste. Nenhuma ordem/movimentação gerada pelo serviço. Fixture comercial/operacional removida ao final; trilha de auditoria preservada.
32. **Específicos:** 16/16 aprovados: catálogo, ciclo de versões, vínculo operacional, cadastro rápido e numeração/concorrência. Smoke público dos sete grupos e smoke público do modal aprovados.
33. **npm test:** 232/232 aprovados, zero falhas. rbac:audit: exit 0, 116 permissões em código/banco/apresentação; o relatório inclui apontamentos legados de permissões órfãs, sem removê-las.
34. **Build:** exit 0. Permanece aviso Vite de bundle maior que 500 kB.
35. **Diff check:** git diff --check passou. Verificação extra --cached encontrou três espaços finais que já estavam staged em output/pdf/britador-30x20-catalogo.txt e output/pdf/britador-30x20-orcamento-preview.txt; índice preservado.
36. **PM2:** backend PID 6804 e frontend PID 20136 online, restart count 2 estável após a aplicação. Somente esses dois processos foram reiniciados. ERP, site institucional e cloudflared não foram reiniciados.
37. **Smoke:** backend /api/health 200, frontend HEAD 200, público /api/health 200, PUT real de catálogo público 200. Sem novos erros nos logs PM2 de backend/proxy durante a validação.
38. **Git:** working tree anterior e índice preservados. Novas alterações não commitadas; nenhum commit, push, merge, checkout, switch, reset ou restore executado. Estado detalhado em tmp/catalog-public/git-status.txt.

Contrato auditado:

- Headers: Authorization Bearer (valor omitido), Content-Type application/json; Axios usa Accept application/json, text/plain, */*. O rastreamento acrescenta X-Request-ID no proxy/backend.
- Ficha: name, commercial_code, is_active, operational_product_id, reference_price, commercial_description e SOP quando permitido. Controller updateCommercialProduct → service updateCommercialProduct; UPDATE commercial_products e product_catalogs, auditoria e resposta JSON 200 com a ficha.
- Versão: commercial_title, subtitle, presentation_text, applications_text, additional_text, notes, specifications e included_items. Controller updateVersion → service updateCatalogVersion; bloqueio catálogo/versão, checagem de uso, UPDATE product_catalog_versions, DELETE/INSERT ordenados de specifications/included_items dentro da mesma transação, auditoria e resposta JSON 200 com a ficha atualizada. Imagens não são alteradas por esse fluxo.
- Imagem nova: POST /api/commercial/catalog/versions/:id/images, binário image/png, image/jpeg ou image/webp; X-File-Name; limite 8 MB. Legenda/posição/principal: PATCH /api/commercial/catalog/images/:id.
- Primeira publicação: POST /versions/:id/publish com conteúdo editável e “Versão publicada e ativada.”. Edição: PUT /versions/:id e “Alterações salvas.”.

Deploy/migrations: detectadas 18 divergências de checksum causadas somente por CRLF/LF. O runner agora aceita as duas representações do mesmo SQL, mas continua rejeitando alterações de conteúdo. Arquivos antigos voltaram aos bytes/terminações originais; não houve repair de checksums no banco. Status final: 42 aplicadas, zero pendentes, zero alteradas.

Evidências locais: tmp/catalog-public/persistence-report.json, persistence-public.png, persistence-original.json, quick-product-report.json, final-audit.json, specific-tests-final.log, npm-test.log, rbac.log, build-final.log, diff-check.log e git-status.txt.
