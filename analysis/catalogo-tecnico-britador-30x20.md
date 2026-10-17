# Correção do Catálogo Técnico — Britador 30×20

Validação em 17/09/2026. Branch `feature/comercial-module`; working tree inicialmente limpo. Nenhum commit, push, merge, checkout, switch, reset ou restore executado.

## 1–5. Diagnóstico e identificação

O PDF incompleto foi reproduzido **antes da correção** usando o orçamento real em rascunho. Tinha duas páginas; a página do catálogo continha somente logo, título, badge V3 e fotografia. O arquivo completo tinha 3.039.891 bytes.

O conteúdo já estava ausente no banco: nas três versões, `subtitle`, `presentation_text`, `applications_text`, `additional_text` e `notes` eram nulos; não havia especificações nem itens inclusos. O renderer recebia esses valores vazios e corretamente não desenhava seções inexistentes. Não era perda de conteúdo por diferença entre nomes de campos do snapshot e do renderer.

Causas encontradas no editor:

1. A criação enviava `blankVersion(base.name)`, descartando o conteúdo que o usuário já havia digitado.
2. “Publicar” enviava apenas o ID, sem salvar/enviar os campos ainda presentes no formulário. O backend publicava somente o registro persistido anteriormente.
3. Upload/reordenação/remoção de imagens recarregavam a ficha e podiam descartar campos ainda não salvos.
4. A regra antiga bloqueava qualquer versão publicada, incentivando a clonagem da mesma ficha incompleta.

A criação agora envia o formulário preenchido. Publicação recebe `version` e persiste textos e tabelas filhas na mesma transação da publicação. Operações de imagem que recarregam a ficha salvam antes os campos técnicos. Payloads com coleções em formato inválido retornam erro de negócio.

| Identidade auditada | Valor |
|---|---|
| Nome do Commercial Product | Britador 30 - 20 com motor estacionário 13 com partida e bateria |
| `commercial_product_id` | `20335110-3ea7-4272-86e7-64d62ff6bce3` |
| Código comercial preservado | `51` |
| Origem | `ERP_UNIVERSAL`, `source_id=9` |
| Product operacional / `product_id` | `cba2888a-b60e-42c5-901b-f6d677101c1c` |
| Nome operacional | Britador 30 X 20 com motor estacionário 13 com partida e bateria |
| Código operacional preservado | `5` |
| Product Catalog / `catalog_id` | `88f1580e-b6d1-4ded-b019-c5e20e2b2a8a` |
| Technical Catalog | Representado por `product_catalog_versions` e suas tabelas filhas; não existe outra entidade técnica separada neste fluxo |

Todos os horários abaixo são UTC, em 17/09/2026.

| Versão | ID | Criada | Publicada | Status anterior | Uso histórico | Referência não histórica |
|---|---|---|---|---|---|---|
| 1 | `f6ad4790-826e-4aea-b6c0-94a4df8f6840` | 22:00:07.776 | 22:06:33.742 | archived | Nenhum | Nenhuma |
| 2 | `60f45e12-76ed-40cb-aa78-beb522c76c78` | 22:06:54.227 | 22:07:00.597 | archived | Nenhum | Nenhuma |
| 3 | `3c7184f0-d1ec-4526-a1c1-f3e88d9acb46` | 22:07:03.324 | 22:09:45.531 | published | Nenhum | Orçamento em rascunho |

Cada versão tinha uma referência à mesma fotografia `IMG_1834.jpeg`, armazenada como `catalog-bf6669ef-ab75-4ca4-84ea-6d4ca3740520.jpg` (418.930 bytes). Nenhuma foi reutilizada na ficha corrigida. Os IDs das imagens eram `78055348-4cb3-4553-b2e2-b1f8401dc457`, `1b406cae-0bbf-47a5-94c5-13136ad3ee50` e `2e5a59b4-a1bb-49f1-94cd-e5ee1b7e084e`. Não foi apagado arquivo físico compartilhado.

Auditoria de referências:

- `ORC-2026-000033`, número comercial 268, ID `1c0cbf8e-678a-4c16-b08a-afd6598c7a08`: draft, `sent_at=NULL`, histórico apenas “created”, V3, zero PDFs oficiais e zero vendas.
- `ORC-2026-000032`, ID `ea4b23f4-47cb-4137-b5f5-ce28892ade80`: draft, aponta para a base do catálogo, mas não para versão técnica.
- Zero documentos oficiais atuais, documentos legados ou itens legados referenciando essas três versões.
- FKs reais da versão: versão ativa da base, imagens, especificações, itens inclusos e `commercial_quote_items.product_catalog_version_id`.
- FKs da base: versões e itens de orçamento. Vendas vinculam-se ao orçamento; não possuem FK direta para versão técnica.
- Também foram auditadas colunas JSON/snapshot, referências de origem legada e o conteúdo usado para construir documentos. Audit logs e metadados de importação não representam emissão de documento.

Evidências completas estão em `output/pdf/britador-auditoria-antes.json`, `britador-referencias-antes.json` e `britador-reproducao-antes.pdf`.

## 6–14. Limpeza, versionamento e concorrência

**Antes: 3 versões. Removidas: 2 (V1 e V2). Depois: 1 (V3 corrigida). Nenhuma versão utilizada foi apagada.**

A V3 foi mantida no mesmo ID, número, status publicado e data de publicação. Isso evita mexer no vínculo do orçamento em rascunho. A regularização foi transacional, com locks, nova verificação de uso e validação dos IDs, código e origem do produto. A ficha anterior foi registrada em arquivo antes da primeira mutação e as operações foram auditadas no banco. Nenhum catálogo de outro produto foi limpo.

`catalogVersionUsageService.js` considera uso histórico:

- itens de orçamento já enviado/emitido/aprovado/rejeitado, inclusive reaberto quando há data/histórico de emissão;
- vínculo com venda pelo orçamento;
- `version_id` nos snapshots de PDFs oficiais atuais e reconstruídos;
- itens históricos legados com inclusão de catálogo, cruzando `source_system` e `source_catalog_version_id`.

Publicação, visualização, preview e vínculo a orçamento apenas em rascunho não constituem uso histórico. O detalhe retorna `is_used` e `has_quote_references`, sem contagem estimada de documentos.

- Versão publicada sem uso: UPDATE no próprio ID; não incrementa número nem cria outra versão.
- Versão utilizada: UPDATE e DELETE retornam 409, inclusive operações de imagem.
- Criação de nova versão: clona a versão utilizada selecionada, com número máximo existente + 1. Se já houver versão sem uso, retorna 409 para reutilizá-la.
- Exclusão sem uso: permitida; vínculo a rascunho ainda impede exclusão por integridade estrutural e retorna 409 específico. Não é classificado como uso histórico.
- Publicar a nova versão altera a versão ativa para documentos futuros, sem alterar conteúdo nem metadados da versão histórica utilizada. Documentos anteriores continuam com seus IDs e snapshots.

Mutações seguem ordem de locks base → versão. A emissão oficial/reconstrução histórica bloqueia as versões com `FOR SHARE` antes de ler campos e montar o PDF, até o fim da transação; edição/exclusão usam `FOR UPDATE` e consultam uso novamente depois de obter o lock. O teste com duas conexões observou o lock real em `pg_stat_activity`: a edição aguardou o commit do uso, retornou 409 e manteve o conteúdo antigo. Se a edição termina primeiro, a emissão lê a ficha inteiramente atualizada.

## 15–20. Editor

Seções finais: **01 Título comercial; 02 Subtítulo; 03 Apresentação; 04 Especificações; 05 Itens inclusos; 06 Aplicações; 07 Observações.**

Especificações livres com Característica e Valor; itens inclusos separados, com descrição. Ambos permitem adicionar, editar, remover, subir e descer. Metadados legados de unidade/quantidade/notas continuam preservados no payload; notas preexistentes têm campo complementar para evitar perda silenciosa.

Aplicações e Observações são textareas com os placeholders solicitados. Subtítulo e descrição de item aceitam quebra visual em mobile. Botões de reordenação têm área mínima de 44×44 px e rótulos acessíveis. O botão salvar não cobre campos. Sem overflow horizontal em 320, 390, 768 e 1440 px. Capturas em `output/pdf/britador-editor-390.png` e `britador-editor-1440.png`.

Sem versão: “Criar primeira versão”. Sem uso: “Salvar alterações”. Utilizada: campos bloqueados, aviso explícito e “Criar nova versão”. “Salvar e publicar” persiste o formulário na própria publicação; o PDF da versão salva está acessível no editor.

## 21–24. Ficha final persistida

Produto identificado acima; versão final **3**, ID **`3c7184f0-d1ec-4526-a1c1-f3e88d9acb46`**.

- Título: **Britador de Mandíbula 30×20**.
- Subtítulo: **Britador compacto para redução primária de pedras e minérios.**
- Apresentação: **O Britador de Mandíbula 30×20 é indicado para a quebra e redução do material antes da etapa de moagem, preparando a granulometria para alimentação do moinho.**
- Especificações, nesta ordem: **Boca de britagem | 30 × 20 cm**; **Motor | 13 CV**.
- Item incluso: **Base completa com adaptações necessárias**.
- Aplicações: **Britagem de pedras, minérios e materiais de mineração, especialmente como etapa de preparação antes do moinho.**
- Observações, em duas linhas: **Estrutura reforçada**; **Equipamento completo com motor**.
- Imagens do equipamento: **nenhuma**. Não foram acrescentadas outras especificações.

O nome/código do Commercial Product e do Product operacional foram preservados. O título técnico é o texto acima; a descrição comercial já existente no item do orçamento não foi substituída.

## 25–33. PDFs e orçamento

| Artefato | HTTP | Páginas | Bytes | Resultado |
|---|---|---|---|---|
| `output/pdf/britador-30x20-catalogo.pdf` | 200 | 1 | 1.311.136 | Ficha completa, V3 |
| `output/pdf/britador-30x20-orcamento-preview.pdf` | 200 | 2 | 2.621.449 | Página 1 orçamento; página 2 ficha V3 |

Content-Type `application/pdf`. O orçamento retornou `X-Quote-Document: current-preview`. A leitura dos endpoints não criou documento comercial permanente nem travou a versão.

Extração com pypdf validou os 12 textos esperados (incluindo badge V3), ordem/conteúdo técnico e ausência de especificações inventadas. Os arquivos `.txt` e `britador-validacao-pdf.json` estão ao lado dos PDFs. As especificações começam na coordenada PDF Y=610,161: o espaço da imagem foi eliminado. Existe somente o logo institucional no cabeçalho, **nenhuma fotografia do equipamento**.

Inspeção visual de todas as páginas: título, subtítulo, apresentação, duas especificações, item incluso, aplicações e observações presentes e legíveis; sem imagem quebrada, caixa vazia reservada ou página extra. A apresentação precede a imagem opcional; removido também o posicionamento absoluto desnecessário de Aplicações, que podia reutilizar coordenada de uma página anterior.

No orçamento real em rascunho, a assinatura segue no final da página comercial e o catálogo vem depois, com páginas 1/2 e 2/2. A V3 é a mesma que já estava vinculada ao item. O orçamento continua draft, com zero documentos oficiais. Não foram mudados preços, regras comerciais ou snapshots históricos. Os testes adicionais verificam que a publicação de V2 não altera V1, a referência antiga ou o hash do PDF oficial anterior.

## 34–41. Validações e arquivos

- Catalog + lifecycle + PDF + Commercial Quote/HTTP: **33 testes específicos aprovados**.
- `npm test`: **229 aprovados, zero falhas, zero ignorados**, após as últimas alterações.
- `npm run build`: aprovado; aviso de bundle acima de 500 kB, sem erro de compilação.
- `git diff --check`: aprovado.
- Smoke backend: health e endpoints PDF HTTP 200; conflitos de versões usados HTTP 409 nos testes.
- Smoke frontend real em Edge headless: criação, publicação com campos ainda não salvos, reordenação/remoção, salvar/reabrir e conservação de V1; zero erros JavaScript; quatro larguras aprovadas.
- **Nenhuma migration**: a estrutura existente já comporta todos os campos e snapshots.
- RBAC: sem alteração de permissões/grants/perfis. Os endpoints novos reutilizam `commercial.catalog.view/edit`; enviar campos junto com publicação exige também edit. Por esse uso dos guards, `npm run rbac:audit` foi executado: 116 permissões no código/banco/apresentação. Indicou permissões legadas órfãs em Vales/Compras/Fornecedores, fora do escopo; não foram alteradas.
- Fixtures do editor/ciclo: rollback. Fixture de concorrência: IDs temporários removidos ao fim. Consulta final encontrou **zero** produtos `Lifecycle`, `Smoke técnico` ou `Concurrency catalog` remanescentes.

Arquivos de implementação alterados:

1. `backend/src/controllers/productCatalogController.js`
2. `backend/src/routes/productCatalogRoutes.js`
3. `backend/src/services/productCatalogService.js`
4. `backend/src/services/catalogVersionUsageService.js` (novo)
5. `backend/src/services/technicalCatalogPdfService.js` (novo)
6. `backend/src/services/commercialQuoteDocumentService.js`
7. `backend/src/services/commercialQuoteService.js` (somente lock para uso histórico)
8. `backend/src/services/legacyCommercialQuoteDocumentService.js` (somente lock da reconstrução)
9. `backend/src/services/pdf/orcamentoPdfService.js`
10. `backend/src/services/pdf/universal/renderCatalog.js`
11. `src/pages/CommercialCatalogPage/CatalogEditorPage.jsx`
12. `src/pages/CommercialCatalogPage/CommercialCatalog.css`
13. `tests/commercialCatalog.test.js`
14. `tests/catalogVersionLifecycle.test.js` (novo)
15. `scripts/regularize-britador-30x20-catalog.js` (novo; restrito aos IDs auditados; padrão somente auditoria)
16. `scripts/smoke-catalog-editor.js` (novo)
17. `scripts/validate-britador-catalog-pdf.py` (novo)

Além deste relatório, `output/pdf/` contém os PDFs, textos extraídos, auditorias, capturas e logs de validação desta tarefa. Status final: arquivos modificados/novos no working tree, sem staging ou commit. Nenhum dos módulos operacionais excluídos do escopo foi modificado. A validação usou instâncias temporárias do código local, encerradas ao final; não houve deploy ou reinício forçado de serviços existentes.
