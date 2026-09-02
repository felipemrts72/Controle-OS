# 01 — Arquitetura do OliMen Gestão

## Mapa textual

```text
Navegador
└── React 18 SPA (`src/`)
    ├── React Router (`src/routes/AppRoutes.jsx`)
    ├── navegação/RBAC visual (`src/config/modulePresentation.js`)
    ├── componentes e páginas com estado local
    ├── CSS global + CSS por componente/página
    └── Axios (`src/services/api.js`)
        └── Authorization: Bearer <JWT>
            └── `/api`
                ├── desenvolvimento: VITE_API_URL
                └── produção: proxy do `server.js` da raiz
                    └── API Express 4 (`backend/src/`)
                        ├── app.js: montagem das rotas
                        ├── routes/: autenticação e permissão por endpoint
                        ├── controllers/: adaptação HTTP/caso de uso
                        ├── services/: regras, SQL e integrações
                        ├── middlewares/: autenticação e erros
                        ├── database/pool.js: pg + transações
                        ├── services/pdf/: PDFKit
                        └── filesystem privado (`uploads/`)
                            ├── company/
                            ├── products/
                            └── employees/<employee_id>/
                                └── PostgreSQL
                                    ├── tabelas de domínio
                                    ├── RBAC
                                    ├── auditoria
                                    └── schema_migrations
```

O repositório é um monólito de código, mas frontend e backend são processos separados. `server.js` na raiz serve `dist/` e faz proxy de `/api`; `backend/src/server.js` inicia a API. Não há ORM, injeção de dependência, gerenciador global de estado ou camada genérica de repository.

## Frontend

- Entrada: `src/main.jsx`, com `BrowserRouter` e `ToastProvider`.
- Rotas: `src/routes/AppRoutes.jsx`.
- Layout autenticado: `AppLayout`, `Sidebar` e `Header`.
- API: instância Axios com `baseURL`, interceptor Bearer e limpeza automática da sessão em 401.
- Estado: `useState`/`useEffect` por página/componente; não há Redux, Zustand ou React Query.
- Estilos: variáveis em `src/styles/variables.css`, classes globais em `global.css` e CSS local importado por componente/página.
- Ícones: `lucide-react`.
- Download protegido: `src/utils/downloadAuthenticatedFile.js`, usando blob e `Content-Disposition`.

## Backend

- Entrada: `backend/src/app.js` e `backend/src/server.js`.
- JSON: `express.json()` global; uploads usam `express.raw()` apenas nas rotas específicas.
- Rotas: montadas sob `/api` e protegidas com `authenticate` e middlewares de permissão.
- Controllers: dois estilos coexistem. Alguns controllers fazem SQL/regras diretamente (`basicControllers.js`); módulos mais novos mantêm controller fino e serviço (`purchaseController.js`).
- Services: SQL parametrizado com `pg`, validação, transações, filesystem, PDF e auditoria.
- Repositories: **não existe diretório/camada de repositories**. SQL vive em services e em alguns controllers. Um novo módulo deve seguir o estilo mais recente (controller fino + service), sem inventar abstração isolada sem decisão global.
- Erros: `httpError(status, message, {code, field, details})` e `errorMiddleware`; resposta JSON inclui `message` e, quando presentes, `code`, `field`, `details`.
- Auditoria: `audit_logs`, chamada por `logAudit()` dentro de transações em operações relevantes.

## Banco

- PostgreSQL via `pg`.
- UUID com `gen_random_uuid()`/`pgcrypto`.
- SQL direto e transações explícitas.
- `database/schema.sql` é um consolidado imperfeito; migrations incrementais são parte indispensável do modelo.
- Datas misturam `TIMESTAMP` e `TIMESTAMPTZ`; isso exige padronização consciente em novas tabelas.

## Autenticação e autorização

- Login retorna JWT de 8 horas.
- Token e usuário ficam em `localStorage` (`token`, `user`).
- Cada requisição autenticada verifica o JWT e recarrega usuário/perfil/permissões do banco.
- Perfis dinâmicos: `roles`; permissões: `permissions`; associação N:N: `role_permissions`.
- Há fallback de roles legadas e superadmin por username `admin`.
- O backend é a barreira de segurança. O frontend repete a checagem para UX em rota, menu e ação.

## Uploads e arquivos

- Storage local fora de `dist`, ignorado pelo Git.
- Não há `express.static` para uploads; leitura é feita por endpoints autenticados.
- Não há Multer. O conteúdo binário é `req.body`, com metadados em headers.
- Logo e foto de Produto verificam MIME, extensão, assinatura mágica, limite e path.
- Documentos de Funcionário aceitam PDF/JPEG/PNG e fazem soft delete dos metadados, mantendo o arquivo físico.

## Estrutura modular atual

```text
Dashboard
Produção
├── Ordens de produção
├── Nova ordem de produção
├── Histórico de produção
├── Serviços
└── Painel de produção
Estoque
└── Produtos
Compras
├── Visão geral
├── Solicitações
├── Aprovações
├── Cotações de fornecedor
├── Pedidos
├── Recebimentos
├── Fornecedores
└── Grupos de materiais
Expedição
Administrativo
Configurações
```

“Comercial” não existe na navegação nem na ordem de apresentação de permissões. A futura entrada correta é um novo grupo entre Estoque e Compras, ou conforme decisão de produto, contendo inicialmente `/comercial/orcamentos`.

## Encaixe futuro recomendado

```text
Frontend
├── src/pages/CommercialQuotesPage/...
├── componentes reutilizáveis ou específicos do Comercial
├── AppRoutes.jsx: rotas protegidas
└── modulePresentation.js: grupo Comercial + permissões

Backend
├── routes/commercialQuoteRoutes.js
├── controllers/commercialQuoteController.js
├── services/commercialQuoteService.js
└── services/pdf/orcamento/ (quando houver mais de um arquivo relevante)

Banco
├── orçamentos e itens (novos)
├── catálogo técnico e versões (novos)
├── equivalência externa de Produto (nova)
└── FKs para products, customers e users (reuso)
```

O termo `quote` já é usado em Compras para **cotação a fornecedor** (`purchase_quote_*`). O Comercial deve adotar nomes técnicos não ambíguos, como `commercial_quotes`, ainda que a interface mostre “Orçamentos”.
