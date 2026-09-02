# 06 — Autenticação, Perfis e Permissões

## Autenticação

- Endpoints públicos: `POST /api/auth/login` e `POST /api/auth/register`.
- Sessão atual: JWT assinado com `JWT_SECRET`, expiração de 8 horas.
- Login aceita hashes bcrypt da aplicação e hashes `crypt` legados do PostgreSQL.
- JWT é enviado como `Authorization: Bearer <token>`.
- Frontend persiste token e usuário em `localStorage`.
- Ao iniciar, o frontend valida com `GET /api/auth/me`.
- Em cada requisição, `authenticate` verifica JWT, recarrega usuário e Perfil do banco e recalcula Permissões. Desativação, rejeição ou mudança de Perfil tem efeito na requisição seguinte.
- Usuário precisa estar ativo e com `approval_status = approved`.
- Não há refresh token, cookie HttpOnly, revogação individual de token ou sessão server-side.

O fallback `JWT_SECRET || 'dev-secret'` é risco de configuração; produção deve sempre definir segredo forte.

## Modelo de usuários e RBAC

### `users`

`id`, nome, username único, hash, role legada com check (`admin`, `manager`, `shipping`, `viewer`), `role_id`, ativo, status de aprovação (`pending`, `approved`, `rejected`), aprovador/data e timestamps.

### `roles` — Perfis

UUID, nome, slug único, descrição, sistema, ativo e timestamps. A interface usa corretamente “Perfis e permissões”, embora nomes técnicos/legados ainda usem `role`/`roles`.

### `permissions`

UUID, `code` único, nome, descrição, grupo e data de criação.

### `role_permissions`

N:N, PK composta, cascade ao excluir Perfil/Permissão.

Não existem permissões por usuário. O superadmin é reconhecido pelo username literal `admin`; Perfis legados ainda têm fallback no backend e frontend.

## Checagem no backend

- `authenticate`: identidade/sessão.
- `requirePermission(code)`: uma Permissão.
- `requireAnyPermission(...codes)`: qualquer Permissão.
- `requirePermissionOrAdmin(code)`: Permissão ou admin.
- `authorize(...roles)`: middleware legado por role; novos módulos devem preferir Permissões.
- `hasPermission()` também é usado em regras de serviço, como autorização contextual da foto preliminar.

Rotas de Produto já exemplificam ações separadas: visualizar, criar, editar, excluir e gerenciar tipos. Toda nova rota comercial precisa de proteção no backend; ocultar botão no frontend não é segurança.

## Checagem no frontend

- `RoleRoute permission="..."` protege páginas.
- `getVisibleNavigation()` oculta itens sem Permissão.
- `canAccessPermission()` controla ações dentro das páginas.
- `getDefaultRoute()` escolhe a primeira rota permitida.
- `RolesPage` agrupa permissões via `PERMISSION_PRESENTATION` e `PERMISSION_MODULE_ORDER`.

Uma nova Permissão precisa ser incluída tanto nos registros de banco/backend quanto na apresentação frontend; caso contrário, ela cai em “Configurações > Outras”.

## Permissões futuras sugeridas

Usar códigos estáveis e ação explícita, por exemplo:

- `commercial_quotes.view` — visualizar Orçamentos;
- `commercial_quotes.create` — criar;
- `commercial_quotes.edit` — editar;
- `commercial_quotes.delete` — excluir/inativar/cancelar, conforme regra definida;
- `commercial_quotes.pdf` — gerar/baixar PDF;
- `technical_catalog.view` — visualizar catálogo;
- `technical_catalog.edit` — editar rascunho;
- `technical_catalog.publish` — publicar versão, se publicação for distinta;
- `customers.view` e `customers.manage` — caso seja criado fluxo autônomo de Cliente.

Evitar o código genérico `quotes.*`, porque `purchase_quotes.*` já representa cotação de fornecedor. A interface pode exibir “visualizar orçamento”, mas o código deve deixar o domínio claro.

## Como adicionar futuramente

1. Migration insere permissões com `ON CONFLICT` e concede apenas aos Perfis aprovados (admin por padrão, demais por decisão).
2. `permissionService.js` reconhece o catálogo/fallback, se o projeto ainda mantiver a lista em código.
3. Rotas Express exigem permissão específica.
4. Services reforçam regras contextuais/ownership quando necessário.
5. `modulePresentation.js` apresenta o módulo Comercial e nomes amigáveis.
6. `AppRoutes.jsx` usa `RoleRoute`.
7. Páginas verificam cada ação.
8. Testes cobrem backend e frontend.

## Lacunas/riscos

- A lista de permissões existe no banco, migrations e constante `PERMISSIONS`; há risco de deriva.
- `admin` por username/role é bypass intencional e deve ser considerado nos testes.
- `localStorage` expõe o token a XSS; não é uma mudança necessária para Comercial, mas é risco transversal.
- Cadastro público permite solicitar usuário; aprovação e Perfil precisam continuar separados.
- Não há escopo por vendedor, equipe, filial ou propriedade de Orçamento. Se for necessário, Permissão simples não basta e a regra deve residir no service/backend.
