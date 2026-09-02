# 06 — Configurações da Empresa, assinatura e documentos

## Fonte oficial

`company_settings` do OliMen será a fonte oficial. `configuracoes_empresa` do ERP não será copiada cegamente. O contrato permite comparação assistida e preenchimento de lacunas aprovado por administrador, sem overwrite automático.

## Matriz

| ERP `configuracoes_empresa` | OliMen `company_settings` | Compatibilidade | Regra |
|---|---|---|---|
| `id=1` | singleton UUID/`singleton_key` | Conceitual | Reutilizar singleton OliMen |
| `nome_exibido` | `nome_fantasia` | Aproximada | OliMen prevalece |
| `razao_social` | `razao_social` | Exata | OliMen prevalece/validar |
| `cnpj` | `cnpj` | Exata | OliMen prevalece/normalizar |
| `endereco` | `endereco`, `numero`, `complemento` | Origem menos estruturada | Revisão humana, não partir texto automaticamente sem confirmação |
| `cidade` | `cidade` | Exata | Reutilizar |
| `estado` | `estado` | Exata | Reutilizar |
| `cep` | `cep` | Exata | Reutilizar |
| `telefone` | `telefone` | Exata | Reutilizar |
| `email` | `email` | Exata | Reutilizar |
| `logo_url` | `logo_path` | Referência incompatível | Selecionar arquivo oficial no storage OliMen |
| `responsavel_nome` | `nome_representante` | Aproximada | Confirmar identidade/cargo |
| ausência | `cpf_representante` | Destino exclusivo | Manter OliMen |
| ausência | `cargo_representante` | Destino exclusivo | Manter OliMen |
| ausência | `delivery_address` | Destino exclusivo | Manter configuração de Compras/entrega |
| ausência | `purchase_response_email` | Destino exclusivo | Manter; não usar no PDF comercial sem decisão |
| ausência | `purchase_response_whatsapp` | Destino exclusivo | Manter; não usar no PDF comercial sem decisão |
| ausência | `purchase_responsible_name` | Destino exclusivo | Não confundir com representante legal/comercial |
| `assinatura_url` | ausente | Lacuna | `signature_path` opcional no singleton, se um representante |
| `documentos_exibicao JSONB` | ausente | Lacuna opcional | Defaults do renderer ou configuração geral aprovada |
| `logo_documento_largura` 80..300 | ausente | Lacuna opcional | Só adicionar se personalização for requisito |
| ausência nos dois | site | Lacuna não bloqueante | Só adicionar se o documento exigir |

## Assinatura

O OliMen possui nome/CPF/cargo do representante, mas não imagem de assinatura. Para o requisito atual, um `signature_path` opcional em `company_settings` é a alternativa mais simples e coerente, usando o mesmo padrão protegido da logo.

Criar tabela separada apenas se surgirem:

- vários representantes/assinantes;
- vigência de assinaturas;
- assinatura por unidade/filial;
- certificados/assinatura digital;
- delegação por usuário.

A assinatura usada em revisão emitida deve ser congelada pelo snapshot da Empresa e pelo arquivo/hash do documento. Trocar a configuração oficial não muda Orçamento antigo.

## Snapshot da Empresa

Na emissão, `commercial_quotes.company_snapshot` deve conter schema versionado com:

- nome fantasia/nome exibido;
- razão social;
- CNPJ;
- telefone e e-mail;
- endereço, número, complemento, bairro, cidade, estado e CEP;
- representante, CPF e cargo quando exibidos;
- identificador/hash da logo usada;
- identificador/hash da assinatura usada;
- opções de exibição efetivamente aplicadas;
- versão do schema/renderer.

JSONB é adequado porque o conjunto de apresentação muda mais que os campos consultáveis do Orçamento. Valores essenciais de busca (número, Cliente, data, status) permanecem em colunas.

## PDF: decisão de arquitetura

Os dois sistemas usam PDFKit. O OliMen já tem uma base comum em `backend/src/services/pdf/pdfDocument.js`, com A4, cabeçalho/logo, tabelas, paginação, filename e envio. O ERP possui renderer específico de Orçamento e Catálogo, helpers e tratamento de imagens com Sharp.

Contrato:

1. manter um único motor PDFKit no backend OliMen;
2. criar futuramente builders do Comercial sobre os helpers OliMen;
3. transportar regras boas do layout ERP, não copiar a árvore/arquivos literalmente;
4. ler exclusivamente snapshots e versão técnica vinculada para documento emitido;
5. usar o mesmo PDF backend para download e impressão;
6. persistir o binário oficial emitido, hash e versão do renderer.

Estrutura futura compatível com o projeto:

```text
backend/src/services/pdf/
├── pdfDocument.js
├── commercialQuotePdfService.js
├── commercial/
│   ├── quoteRenderer.js
│   ├── commercialPages.js
│   └── catalogPages.js
└── helpers/ (somente se os helpers comuns crescerem)
```

Não é necessário reproduzir literalmente `backend/src/pdf/` do ERP.

## Regras documentais a preservar

- A4 e paginação determinística;
- cabeçalho com Empresa/logo conforme configuração oficial da emissão;
- Cliente e itens a partir de snapshots;
- tabela com código, descrição, quantidade, unidade, preço, desconto e total;
- condições/formas/parcelas de pagamento;
- páginas comerciais com rodapé, assinatura do proprietário e linha do Cliente;
- páginas de Catálogo sem assinaturas;
- ausência controlada de logo/assinatura/imagem, sem quebrar o PDF;
- Catálogo deduplicado por Produto + versão;
- filename seguro e `Content-Disposition`;
- autorização `commercial_quotes.pdf` e auditoria.

## Download e impressão

O frontend baixa `blob` autenticado. A impressão deve abrir/imprimir exatamente o mesmo binário armazenado/servido; não deve existir renderer HTML paralelo. Prévia de rascunho pode ser gerada dinamicamente e marcada como não oficial.

## Preservação histórica do layout

Snapshots garantem dados, mas não garantem reprodução byte a byte se o código do renderer mudar. Por isso, ao emitir:

- armazenar PDF em storage protegido;
- gravar `sha256`, tamanho, MIME, `renderer_version`, data e usuário;
- download/impressão posterior usa esse arquivo;
- regeneração, se permitida, é uma nova representação auditada e não substitui o original.
