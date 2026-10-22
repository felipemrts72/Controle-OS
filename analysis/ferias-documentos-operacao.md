# Documentos de férias: armazenamento e recuperação

## Armazenamento

Os metadados ficam em `vacation_documents`; o arquivo original fica fora do PostgreSQL, em `VACATION_DOCUMENT_DIR`. Em produção, esta variável deve ser um caminho absoluto para um volume privado e persistente, externo ao checkout. A aplicação recusa iniciar as rotas documentais em produção se o caminho não estiver configurado dessa forma. O diretório precisa ser gravável pelo usuário do backend e inacessível ao servidor estático. Não use `public/`, `dist/`, armazenamento temporário ou o diretório substituído por deploy. O padrão `uploads/vacations` é apenas para desenvolvimento.

Arquivos recebem UUID interno e permissão de arquivo `0600`. O banco guarda tipo, nome original, tamanho, hash SHA-256, usuário, instante, funcionário, período e lançamento. Downloads e ZIP passam por autenticação e permissão `vacations.documents.view`; upload e arquivamento exigem `vacations.documents.manage`. O vínculo triplo é protegido por chave estrangeira. O arquivamento é lógico; não há remoção automática de documentos trabalhistas.

## Backup e restauração

1. Coloque os uploads documentais em janela de manutenção ou obtenha snapshot consistente do volume.
2. Faça `pg_dump` do banco e snapshot/cópia integral de `VACATION_DOCUMENT_DIR` na mesma janela; registre os instantes e versões da aplicação. Criptografe os backups e restrinja o acesso.
3. Preserve os dois artefatos juntos. A restauração requer banco e arquivos da mesma janela; teste em ambiente isolado antes de liberar usuários.
4. Após restaurar, compare cada `stored_name` ativo e arquivado com o arquivo correspondente e recalcule SHA-256 contra `vacation_documents.sha256`. Arquivos ausentes ou divergentes exigem investigação; não invente recibos substitutos.
5. Verifique periodicamente arquivos sem metadados para identificar falhas interrompidas após gravação. Mantenha-os em quarentena até revisão; a limpeza de exceções tratadas no processo é automática.

Defina política de retenção e descarte com a área jurídica e de privacidade antes de qualquer remoção física. Os arquivos podem conter dados pessoais; use acesso mínimo, trilha de auditoria e finalidade trabalhista. Não há antivírus integrado no projeto: PDF e imagens são validados por MIME, extensão e assinatura, armazenados como dados e nunca executados pelo backend.
