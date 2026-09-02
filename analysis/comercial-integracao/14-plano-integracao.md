# 14 — Plano futuro de integração

Este plano é somente recomendação. Nenhuma fase foi executada.

## Fase 0 — Decisões e contratos

- Fechar identidade externa e política de códigos.
- Definir cadastro oficial completo de Cliente e deduplicação.
- Definir preço comercial, estados de Orçamento, numeração, snapshots e regras de exclusão.
- Definir modelo/versionamento/publicação do Catálogo.
- Definir requisitos de assinatura, PDF persistido e autorização por vendedor/equipe.
- Confirmar o estado real do banco versus migrations em ambiente seguro.

Critério de saída: decisões registradas e matriz conjunta OliMen × ERP Universal pronta, sem ambiguidades de identidade.

## Fase 1 — Preparar cadastros mestres

- Evoluir `customers` sem duplicar a tabela e criar APIs/UX próprias.
- Tornar política de `internal_code` explícita e editável de forma controlada.
- Introduzir identificadores externos/equivalência de Produto.
- Formalizar cadastro parcial e indicadores de pendência sem quebrar Produtos atuais.
- Manter Produto em Estoque e revisar buscas compartilhadas.

Critério: Produtos/Clientes legados continuam operacionais; nenhuma integração movimenta estoque/produção.

## Fase 2 — Catálogo Técnico

- Criar Catálogo relacionado a Produto, versões, imagens, especificações e itens inclusos.
- Criar aba/subrota no Produto e Permissões próprias.
- Reutilizar storage protegido com suporte a coleção/versionamento.
- Definir rascunho/publicação/imutabilidade.

Critério: Produto sem Catálogo continua válido; versão publicada é recuperável e imutável.

## Fase 3 — Orçamentos comerciais

- Adicionar **Comercial > Orçamentos**.
- Criar cabeçalho, itens, numeração, estados/histórico e RBAC.
- Consumir `products` e `customers` por FK.
- Preservar snapshots de Cliente, Produto/item, preço, condições e versão técnica.
- Não criar OS, reserva, baixa, compra ou expedição automática.

Critério: ciclo comercial funciona isolado dos fluxos operacionais e mantém história após edição dos mestres.

## Fase 4 — PDF e impressão

- Criar builder sobre `backend/src/services/pdf/pdfDocument.js`.
- Reutilizar Empresa/logo; implementar assinatura apenas se decidida.
- Gerar PDF do snapshot do Orçamento e versão de Catálogo vinculada.
- Adicionar Permissão de PDF, download e auditoria.
- Validar paginação, imagens, documentos longos, caracteres e impressão.

Critério: PDF reemitido não muda por alteração de Cliente/Produto/Empresa segundo a política escolhida.

## Fase 5 — Importação de Produtos do ERP Universal

- Somente depois de combinar os dois mapeamentos.
- Implementar preview → candidatos → decisão humana → confirmação.
- Priorizar equivalência explícita; tratar códigos externos em namespace próprio.
- Criar Produtos exclusivos como pendentes quando incompletos.
- Nunca sobrescrever automaticamente.
- Registrar lote, resultado, usuário, origem, erros e reversibilidade.

Critério: import repetível/idempotente por chave externa, sem duplicar nem alterar Produto indevidamente.

## Fase 6 — Homologação

- Massa com Produtos completos, legados, inativos, sem preço, sem Catálogo e códigos conflitantes.
- Clientes homônimos/alterados e documentos históricos.
- Tipos/unidades diferentes.
- Uploads, versões, PDFs longos e permissões negativas.
- Regressão de Produção, Compras, Estoque visual e Expedição.
- Backup/restore dos arquivos e banco.

Critério: aceite funcional, histórico, segurança e regressão.

## Fase 7 — Transição gradual

- Operação paralela controlada.
- Monitorar divergências e corrigir equivalências.
- Congelar importações/edições na origem por etapas.
- Preservar acesso histórico/auditoria.
- Desativar gradualmente o ERP Universal somente após critérios de saída e plano de rollback.

## Ordem de dependência

```text
Decisões/contratos
        ↓
Produto + Cliente preparados
        ↓
Catálogo Técnico versionado
        ↓
Orçamentos com snapshots
        ↓
PDF determinístico
        ↓
Importação externa
        ↓
Homologação e transição
```

## Próximo passo imediato recomendado

Juntar este retrato do OliMen ao mapeamento já existente do ERP Universal e produzir um contrato de compatibilidade campo a campo, com foco inicial em:

1. identidade/código/unidade/tipo de Produto;
2. campos mínimos aceitos para Produto legado;
3. modelo de Catálogo/versão/imagens;
4. modelo e snapshots de Orçamento/itens/Cliente/Empresa;
5. layout e dados do PDF;
6. estratégia de importação idempotente e revisada.

Somente após esse contrato deve ser escrita a primeira migration ou linha de implementação.
