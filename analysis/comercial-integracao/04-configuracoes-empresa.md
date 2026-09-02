# 04 — Configurações da empresa

## Estrutura existente

Tabela: `company_settings`, modelada como singleton por `singleton_key BOOLEAN NOT NULL DEFAULT TRUE UNIQUE` mais check `singleton_key = TRUE`.

| Campo | Tipo | Nulo/default | Uso atual e futuro |
|---|---|---|---|
| `id` | UUID | PK, `gen_random_uuid()` | Identidade do singleton/auditoria |
| `singleton_key` | BOOLEAN | não nulo, `TRUE`, único | Garante no máximo uma linha |
| `nome_fantasia` | VARCHAR | opcional | Cabeçalho de PDF |
| `razao_social` | VARCHAR | opcional | Fallback do nome no PDF |
| `cnpj` | VARCHAR | opcional | Identificação/PDF; validado no service |
| `telefone` | VARCHAR | opcional | Cabeçalho/contato |
| `email` | VARCHAR | opcional | Cabeçalho/contato |
| `endereco` | VARCHAR | opcional | Endereço principal |
| `numero` | VARCHAR | opcional | Endereço principal |
| `complemento` | VARCHAR | opcional | Endereço principal |
| `bairro` | VARCHAR | opcional | Endereço principal |
| `cidade` | VARCHAR | opcional | Endereço principal |
| `estado` | VARCHAR(2) | opcional | Endereço principal |
| `cep` | VARCHAR | opcional | Endereço principal |
| `nome_representante` | VARCHAR | opcional | Representante/responsável |
| `cpf_representante` | VARCHAR | opcional | Documento do representante |
| `cargo_representante` | VARCHAR | opcional | Cargo do representante |
| `logo_path` | VARCHAR | opcional | Basename privado da logo |
| `delivery_address` | TEXT | opcional | Default para cotações de Compras |
| `purchase_response_email` | VARCHAR(180) | opcional | Default de retorno de Compras |
| `purchase_response_whatsapp` | VARCHAR(20) | opcional | Default de retorno de Compras |
| `purchase_responsible_name` | VARCHAR(160) | opcional | Responsável padrão de Compras |
| `created_at` | TIMESTAMP | default `NOW()` | Auditoria temporal |
| `updated_at` | TIMESTAMP | default `NOW()` | Auditoria temporal |

Todos os dados funcionais são opcionais. O service normaliza texto vazio para nulo, mantém apenas dígitos em documentos/telefone/CEP e valida CNPJ, CPF, CEP, telefone, WhatsApp, e-mails e UF.

## API e UI

- `GET /api/company-settings` — `company_settings.view`.
- `PUT /api/company-settings` — `company_settings.edit`.
- `GET /api/company-settings/logo` — `company_settings.view`.
- `PUT /api/company-settings/logo` — `company_settings.edit`.
- `DELETE /api/company-settings/logo` — `company_settings.edit`.
- Página: `/configuracoes/empresa`, em **Configurações**.
- A página possui painéis de Identificação, Endereço, Representante, Compras e cotações e Logo.
- Alterações e logo são auditadas em `audit_logs`.

## Logo

- Default: `uploads/company/`, substituível por `COMPANY_LOGO_UPLOAD_DIR` (variável consumida, mas ausente de `.env.example`).
- Limite: `COMPANY_LOGO_MAX_BYTES`, default 5 MiB; a variável de limite está no `.env.example`.
- PNG/JPEG; valida MIME, extensão e assinatura mágica.
- Nome armazenado: `logo-<uuid>.png|jpg`; `logo_path` guarda apenas basename.
- A leitura é autenticada, `private, no-store`, e não por URL pública.
- Frontend usa blob + `URL.createObjectURL` para preview de 190 × 100 px com `object-fit: contain`.
- Substituição e remoção apagam fisicamente o arquivo antigo; erro de remoção é logado.
- `getCompanyPdfData()` devolve os campos e o buffer `logo`; ausência/arquivo faltante não impede PDF.

## Assinatura e responsável

Existem nome, CPF e cargo do representante, mas **não existe**:

- imagem de assinatura;
- caminho/registro de assinatura;
- upload/preview de assinatura;
- site da empresa;
- política sobre qual usuário/responsável assina um documento comercial.

Essas são lacunas futuras. A imagem de assinatura não deve ser confundida com a logo. Antes de criar tabela nova, decidir se uma assinatura singleton simples cabe em `company_settings` (metadados + arquivo) ou se será necessário versionamento/múltiplos signatários.

## Uso em Orçamentos comerciais

Reutilizar `getCompanyPdfData()` para a versão corrente. Para documento histórico juridicamente estável, salvar no Orçamento/PDF um snapshot dos dados empresariais relevantes; caso contrário, uma reimpressão após mudança de razão social/endereço/logo poderá mudar.

Os campos `purchase_*` são específicos de Compras e não devem ser reutilizados semanticamente como configurações do Comercial. Caso o Comercial precise de defaults próprios, eles podem ser adicionados ao singleton existente, com nomes comerciais claros, em vez de criar outra tabela singleton.
