# 07 — Uploads e mídia

## Arquiteturas atuais

### ERP Universal

- Multer/disk storage;
- arquivos de Empresa em `backend/uploads/empresa`;
- arquivos técnicos em `backend/uploads/catalogo/<versaoId>`;
- URLs expostas em `/uploads` e `/api/uploads`;
- Catálogo aceita PNG, JPEG e WebP;
- limite de 8 MB por imagem e até 10 imagens por requisição/galeria;
- nomes com timestamp/UUID parcial/sanitização;
- versão clonada pode compartilhar caminho físico com outra versão;
- `UPLOAD_DIR` e caminhos públicos podem divergir entre ambientes.

### OliMen

- filesystem local protegido;
- endpoints autenticados e específicos (logo, foto de Produto, documentos de funcionário);
- corpo `express.raw`, sem Multer;
- validação por extensão, MIME e magic bytes;
- logo PNG/JPEG até 5 MB;
- `logo_path` guarda referência interna/basename;
- foto de Produto é única e não versionada;
- não existe ainda galeria técnica nem suporte confirmado a WebP.

## Contrato de destino

Todo arquivo migrado deve receber uma **nova storage key do OliMen**. O banco não armazenará:

- caminho absoluto da máquina do ERP;
- `backend/uploads/...` da origem;
- URL `/api/uploads/...` antiga;
- URL pública dependente do host legado.

Novos endpoints de Catálogo devem seguir proteção/auth do OliMen, streaming seguro, resolução dentro de raiz conhecida e RBAC. Não servir a pasta inteira estaticamente.

## Pipeline futuro de migração

1. extrair do banco todas as referências de logo, assinatura e imagens de Catálogo;
2. canonicalizar o caminho somente dentro das raízes permitidas do ERP;
3. detectar referências repetidas ao mesmo arquivo;
4. verificar existência, tamanho, magic bytes, MIME, dimensões e hash SHA-256;
5. classificar ausente, inválido, duplicado ou válido;
6. em dry run, não copiar nada; produzir inventário e conflitos;
7. na execução autorizada futura, copiar/normalizar para área temporária do OliMen;
8. gerar storage key aleatória, sem nome fornecido pelo usuário;
9. persistir DB somente após arquivo validado;
10. confirmar leitura/hash e então finalizar;
11. nunca apagar arquivo da origem;
12. registrar mapa `source_path/source_hash → destination_key/destination_hash` no lote.

DB e filesystem não compartilham transação. O importador precisa de compensação: falha de DB remove apenas o arquivo temporário recém-criado; falha depois do commit gera pendência recuperável, nunca deleção ampla.

## WebP

Como a origem aceita WebP e o destino atual não, o dry run deve contar esses arquivos. Antes da execução, escolher:

- ampliar o pipeline protegido para decodificar/reencodar WebP com biblioteca aprovada; ou
- converter no importador para PNG/JPEG, registrando hash original, formato de destino e possíveis diferenças.

Não renomear extensão sem decodificar. Para estabilidade do PDF e menor superfície de runtime, a recomendação inicial é conversão validada no processo de importação, mantendo o original apenas no backup da origem.

## Arquivos compartilhados entre versões

O mesmo arquivo fonte pode ser referenciado por várias versões clonadas. Duas opções seguras:

1. **cópia independente por versão**: mais simples, maior uso de disco, sem acoplamento de exclusão;
2. **asset imutável content-addressed**: menor duplicação, exige tabela de asset/referências e exclusão somente quando nenhuma relação existir.

Não usar uma storage key compartilhada mutável sem referência explícita. Para a primeira migração, recomenda-se cópia independente por versão; hash ainda identifica duplicidade e permite futura otimização.

## Imagens do Catálogo

Cada registro futuro deve manter:

- `product_catalog_version_id`;
- `storage_key` interna;
- `sha256`;
- MIME/tamanho/dimensões quando úteis;
- legenda;
- ordem;
- indicador de principal;
- timestamps e autoria.

Uma imagem não deve ser alterada in-place em versão publicada. Substituição em rascunho cria novo arquivo/relação e remove o anterior somente por rotina segura após commit.

## Logo e assinatura

- `company_settings.logo_path` continua oficial;
- origem só é candidata a preencher a logo se um administrador escolher;
- assinatura demanda `signature_path` opcional ou estrutura de signatários;
- ambos ficam em diretório/namespace da Empresa, privados e autenticados;
- o PDF emitido registra hash/storage key usada e preserva o binário final.

## Segurança mínima

- allowlist de MIME e extensão;
- magic bytes e decodificação real da imagem;
- limite por arquivo, por requisição e de quantidade;
- nomes aleatórios, sem `..`, separadores ou paths do cliente;
- resolução/canonicalização dentro da raiz configurada;
- RBAC no upload, leitura e exclusão;
- headers corretos e `nosniff`;
- logs sem conteúdo sensível/path absoluto;
- backup/restore de banco e storage testados em conjunto;
- limpeza de órfãos por rotina explícita e auditável, nunca durante dry run.

## Não reutilizar incorretamente

- `product_images` não substitui `product_catalog_images`;
- foto simples atual não deve virar automaticamente imagem principal de todas as versões;
- arquivos de funcionário não compartilham permissões com Catálogo;
- nenhum caminho público do ERP deve permanecer no banco final.

