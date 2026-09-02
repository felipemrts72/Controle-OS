# 10 — PDF, documentos e impressão

## Infraestrutura existente

Dependência: `pdfkit` 0.15.x, no backend.

Estrutura comum:

```text
backend/src/services/pdf/
├── pdfDocument.js
├── purchaseQuotePdfService.js
├── employeePdfService.js
├── employeePendingPdfService.js
├── awardPdfService.js
└── advancePdfService.js
```

`pdfDocument.js` oferece:

- documento A4 portrait/landscape e margens;
- cabeçalho com logo/dados da empresa;
- sanitização de texto;
- data, data/hora, moeda, CPF, CNPJ, telefone e endereço em pt-BR;
- títulos, parágrafos, grids chave/valor, tabelas, checklist e total;
- quebra de página e repetição de cabeçalho;
- rodapé/paginação;
- buffer final;
- nome de arquivo sanitizado e resposta `application/pdf` com attachment.

Há builders para ficha/pendências de Funcionário, Prêmios, Vales e cotação de fornecedor. `labelService.js` também usa PDFKit, mas mantém implementação própria adequada a etiquetas.

## Dados da empresa

`getCompanyPdfData()` lê `company_settings` e a logo em buffer. `addDocumentHeader()` mostra nome, CNPJ, telefone, e-mail e endereço; logo inválida/ausente não impede a geração.

Prêmios demonstram snapshots empresariais e pessoais, e assinatura por linhas/nome/cargo — não imagem de assinatura. Isso é referência útil para histórico.

## Download e impressão

- Endpoints retornam PDFs protegidos por Permissão.
- Frontend usa `downloadAuthenticatedFile()` com Axios `responseType: blob`.
- O filename vem de `Content-Disposition` ou fallback seguro.
- PDFs são baixados; impressão é feita pelo visualizador/navegador.
- Não existe serviço genérico de impressão, fila de impressão comercial ou preview embutido de PDF.
- Etiquetas têm fluxo específico de geração/reimpressão e não devem ser acopladas ao Comercial.

## Cotação de Compras versus Orçamento comercial

`purchaseQuotePdfService.js` gera solicitação de preço a fornecedor, com Produto/código, descrição snapshot, quantidade, unidade e especificação. É outro domínio. Pode fornecer padrões técnicos, mas não deve ser adaptado in-place para Orçamento de venda.

## Encaixe recomendado

Usar a estrutura existente:

```text
backend/src/services/pdf/
├── pdfDocument.js                 # helpers comuns existentes
├── orcamento/
│   ├── orcamentoPdfService.js
│   └── ...                        # somente se complexidade justificar
└── catalogo/
    ├── catalogoPdfService.js
    └── ...
```

Se houver apenas um builder de cada tipo, mantê-los diretamente em `services/pdf/` é ainda mais coerente. Não criar `backend/src/pdf/` paralelo.

Ao integrar conceitos de um renderer externo no futuro, transportar regras de layout de forma seletiva para os helpers OliMen, sem copiar árvore/código incompatível.

## Histórico e determinismo

Para um PDF histórico permanecer igual:

- ler snapshots de Cliente, itens, preços, condições e empresa do Orçamento;
- vincular uma versão publicada específica do Catálogo, nunca “a versão atual”;
- definir se logo e assinatura também são snapshot/binário versionado;
- registrar data/hora, autor e revisão emitida;
- decidir se o binário final será persistido com hash ou regenerado deterministicamente.

Somente salvar `customer_id`/`product_id` e consultar cadastros vivos repetiria o risco identificado no ERP Universal.

## Assinatura

Não há upload/imagem de assinatura. `nome_representante` e `cargo_representante` permitem bloco textual. Uma imagem futura deve ter allowlist, armazenamento protegido, auditoria e política de snapshot/versionamento.

## Dependências reutilizáveis

- PDF: PDFKit.
- Logo/imagens: buffers do filesystem + PDFKit.
- Datas/moeda: `Intl`/`toLocaleString` e helpers de `pdfDocument.js`; não há biblioteca externa de datas/moeda.
- Upload: Express raw + `fs/path/crypto`; não há Multer.
- Validação: funções manuais/constraints; não há biblioteca de schema.
- Preview de imagens: blob + `URL.createObjectURL`.
- Drag-and-drop: não há biblioteca/implementação dedicada.

Nenhuma nova dependência é necessária para uma primeira versão, salvo requisito de layout/renderização que PDFKit não atenda após prova técnica.
