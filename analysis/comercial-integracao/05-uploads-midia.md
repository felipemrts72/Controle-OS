# 05 — Uploads e mídia

## Visão geral

Não há serviço genérico de storage nem Multer. Cada domínio implementa upload com `express.raw()`, validação própria e filesystem local. A raiz `uploads/` é ignorada pelo Git e não é exposta com `express.static`.

| Domínio | Diretório padrão | Metadados | Formatos | Limite | Exclusão |
|---|---|---|---|---|---|
| Logo | `uploads/company` | `company_settings.logo_path` | PNG/JPEG | 5 MiB | física ao trocar/remover + nulo no DB |
| Foto de Produto | `uploads/products` | `product_images` | PNG/JPEG | 5 MiB | física + delete da linha |
| Documento de Funcionário | `uploads/employees/<employee_id>` | `employee_documents` | PDF/PNG/JPEG | 10 MiB | soft delete da linha; arquivo permanece |

Diretórios e limites podem ser configurados por `COMPANY_LOGO_UPLOAD_DIR`, `COMPANY_LOGO_MAX_BYTES`, `PRODUCT_IMAGE_UPLOAD_DIR`, `PRODUCT_IMAGE_MAX_BYTES`, `EMPLOYEE_UPLOAD_DIR` e `EMPLOYEE_DOCUMENT_MAX_BYTES`. Só `COMPANY_LOGO_MAX_BYTES` aparece hoje em `.env.example`.

## Transporte e URLs

- O arquivo inteiro é carregado em memória por `express.raw()`.
- Nome original e metadados vêm por headers (`X-File-Name` ou `X-Original-Name`, além de headers de domínio).
- Leitura usa endpoints autenticados e envia buffer/stream.
- Logo e foto retornam `Cache-Control: private, no-store`.
- Frontend solicita blob e cria URL temporária local para preview/download.
- Não há URL pública persistente, CDN, S3 ou object storage.

## Segurança observada

Logo e Produto:

- allowlist de MIME;
- correspondência MIME/extensão;
- magic bytes PNG/JPEG;
- nome original rejeita path separators e `..`;
- nome armazenado gerado por UUID;
- resolução com `path.resolve` + `path.relative` para impedir saída da raiz;
- modo de arquivo `0600`;
- endpoints e ações protegidos por permissão.

Documentos de Funcionário:

- allowlist PDF/JPEG/PNG, tamanho e magic bytes;
- arquivo armazenado sob UUID do documento e timestamp, não sob nome original;
- metadados têm soft delete e auditoria;
- leitura resolve `file_path` salvo e verifica `fullPath.startsWith(uploadRoot)`.

Pontos de atenção:

- `startsWith(uploadRoot)` é uma verificação menos robusta que `path.relative`; um prefixo irmão pode passar em determinadas construções. Para novos uploads, usar o padrão robusto de Logo/Produto.
- Upload em memória limita escalabilidade e deve ter limites conservadores.
- Não há antivírus, image re-encoding, remoção de metadados EXIF, quota, hash de conteúdo ou deduplicação.
- Filesystem local exige volume persistente e afinidade/compartilhamento em múltiplas instâncias.
- Escrita no filesystem e transação PostgreSQL não são atomicamente coordenadas; os services implementam compensação parcial, mas falhas de processo podem deixar órfãos.
- Documentos soft-deletados mantêm arquivo físico indefinidamente; não há rotina de retenção/garbage collection.

## Foto de Produto versus Catálogo Técnico

`product_images` tem `product_id UNIQUE`: uma única foto cadastral mutável. Campos: `id`, `product_id`, `original_name`, `stored_name` único, `mime_type` com check, `size_bytes > 0`, `uploaded_by`, timestamps.

Ela não atende a:

- múltiplas imagens;
- ordem/legenda/tipo de imagem;
- associação a versão;
- imagem de capa por versão;
- imutabilidade de versão publicada.

O futuro Catálogo Técnico deve usar sua própria tabela de imagens vinculada à versão, mas reaproveitar o mecanismo de segurança/storage. A foto cadastral pode continuar sendo um resumo independente ou, por decisão futura, apontar para uma imagem publicada sem fundir as semânticas.

## Abstração futura recomendada

Extrair um helper interno de storage somente quando o módulo técnico for implementado, com:

- raízes por domínio resolvidas de forma segura;
- validação MIME/extensão/magic bytes;
- geração de nomes;
- gravação atômica/temporária;
- leitura protegida;
- deleção/retention explícita;
- metadados padronizados (`original_name`, `stored_name`, MIME, bytes, hash, usuário, timestamps).

Não mover arquivos existentes nem mudar a arquitetura nesta fase.
