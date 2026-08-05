# Arquitetura do OliMen Gestão

## 1. Visão geral

O sistema é uma aplicação web modular mantida em um único repositório.

O frontend é uma SPA construída com React e o backend é uma API Express. Eles possuem estruturas e processos de execução separados, embora compartilhem o mesmo projeto e o mesmo conjunto de dependências do `package.json` da raiz.

O PostgreSQL concentra a persistência operacional. O backend acessa o banco com SQL direto por meio do driver `pg`, sem ORM.

As áreas visuais são Dashboard, Produção, Estoque, Compras, Expedição, Administrativo e Configurações. Comercial e Financeiro serão adicionados somente quando tiverem funcionalidades próprias.

A apresentação modular é definida centralmente em `src/config/modulePresentation.js`. Identificadores técnicos legados — inclusive rotas `/os`, endpoints, tabelas e códigos de permissões — permanecem preservados. Não há integração automática entre os módulos: Estoque ainda não movimenta saldos, Recebimentos não cria entrada de estoque e Expedição não cria saída de estoque.

## 2. Diagrama de alto nível

```text
┌──────────────────────┐
│      Navegador       │
│      React SPA       │
└──────────┬───────────┘
           │ Axios
           │ Authorization: Bearer <JWT>
           ▼
┌──────────────────────┐
│ Servidor frontend    │
│ server.js            │
│ estáticos + proxy    │
└──────────┬───────────┘
           │ /api
           ▼
┌──────────────────────┐
│     API Express      │
│ rotas e middlewares  │
│ controllers/services │
└───────┬───────┬──────┘
        │       │
        │       ├──────────────► Filesystem
        │       │                uploads de funcionários
        │       │
        │       └──────────────► PDFKit + QR Code
        │                        etiquetas em PDF
        ▼
┌──────────────────────┐
│     PostgreSQL       │
│ dados e auditoria    │
└──────────────────────┘
```

Em desenvolvimento, o Vite pode chamar a API diretamente por `VITE_API_URL`. Em produção, o `server.js` encaminha `/api` ao endereço configurado em `BACKEND_URL`.

## 3. Estrutura do repositório

```text
.
├── backend/
│   └── src/
│       ├── controllers/   # entrada HTTP e coordenação de casos de uso
│       ├── database/      # pool PostgreSQL e helper de transações
│       ├── middlewares/   # autenticação, autorização e erros
│       ├── routes/        # endpoints e permissões exigidas
│       ├── services/      # regras de domínio e integrações
│       └── utils/         # erros, formatação e QR Code
├── database/
│   ├── migrations/        # alterações SQL incrementais
│   └── schema.sql         # schema consolidado disponível
├── src/
│   ├── components/        # componentes React reutilizáveis
│   ├── config/            # navegação e apresentação visual das permissões
│   ├── hooks/             # hooks compartilhados
│   ├── pages/             # páginas e fluxos de interface
│   ├── routes/            # roteamento e proteção de páginas
│   ├── services/          # cliente HTTP
│   ├── styles/            # estilos globais e variáveis
│   └── utils/             # utilitários de permissões
├── uploads/               # runtime, ignorado pelo Git
├── server.js              # frontend estático e proxy de /api
├── package.json
└── vite.config.js
```

## 4. Arquitetura do frontend

O frontend é uma SPA React inicializada em `src/main.jsx`. O React Router organiza a navegação, e `src/routes/AppRoutes.jsx` declara as páginas públicas, protegidas e condicionadas por permissão.

Na inicialização, uma sessão armazenada é validada por `GET /api/auth/me`. O token e o usuário autenticado são mantidos no `localStorage`, e o cliente Axios adiciona o Bearer token às requisições.

O controle de acesso da interface usa as permissões retornadas pelo backend. Rotas sem autorização redirecionam para a primeira área disponível ou para a página de acesso negado.

Não há uma biblioteca global de gerenciamento de estado. As páginas mantêm estado principalmente com `useState` e executam efeitos e carregamentos com `useEffect`.

As chamadas Axios são feitas diretamente nas páginas e em componentes ligados aos fluxos. `src/services/api.js` centraliza a instância HTTP, a sessão e os interceptors.

O `ToastProvider` é o Context compartilhado para notificações. Os demais estados de domínio ficam próximos das páginas que os consomem.

O CSS é organizado por páginas e componentes, complementado por `src/styles/global.css` e `src/styles/variables.css`. A interface possui regras responsivas e variáveis para os temas visuais.

## 5. Arquitetura do backend

A API é inicializada em `backend/src/server.js`, enquanto `backend/src/app.js` configura Express, CORS, JSON, health checks, rotas e tratamento de erros.

O fluxo predominante é:

```text
rota → middleware → controlador → serviço → PostgreSQL
```

As rotas definem endpoints e permissões. Os controladores interpretam requisições e respostas. Os serviços concentram regras reutilizáveis, transações e operações de domínio mais extensas.

Partes mais antigas ainda executam SQL diretamente nos controladores. Por isso, a separação em camadas é predominante, mas não uniforme em todo o backend.

`backend/src/database/pool.js` fornece o pool do driver `pg`, consultas parametrizadas e um helper que executa `BEGIN`, `COMMIT` e `ROLLBACK`.

Operações críticas, como criação de ordens, atualizações financeiras e registros associados, usam transações para manter alterações relacionadas no mesmo limite atômico.

## 6. Autenticação e autorização

O login valida usuário e senha e emite um JWT com validade de oito horas.

O frontend envia o token no cabeçalho:

```text
Authorization: Bearer <token>
```

O middleware `authenticate` valida a assinatura do JWT e recarrega o usuário do PostgreSQL em cada requisição autenticada. O acesso é recusado quando o usuário não existe, está inativo ou não está aprovado.

O modelo dinâmico de autorização utiliza:

```text
roles
permissions
role_permissions
users.role_id
```

O serviço de permissões também mantém compatibilidade com os papéis legados armazenados em `users.role`: `admin`, `manager`, `shipping` e `viewer`.

Os middlewares `requirePermission`, `requireAnyPermission` e `requirePermissionOrAdmin` aplicam autorização nas rotas do backend. As verificações do frontend melhoram a navegação, mas a autorização efetiva permanece na API.

## 7. Domínios e módulos

A Sidebar deriva a visibilidade dos subitens da permissão de cada rota, oculta módulos sem itens acessíveis e mantém o Dashboard como link direto. A tela Perfis e permissões usa a mesma configuração central para os nomes e agrupamentos visuais, sem depender de `permissions.group_name`.

- **Ordens de serviço:** venda, cliente, entrega, itens, volumes e situação operacional.
- **Clientes:** cadastro e reaproveitamento durante a criação de ordens.
- **Produtos:** definição do item, tipo, setor, volumes e peso padrão.
- **Tipos de produto:** catálogo dinâmico com tipos de sistema e tipos adicionais.
- **Setores:** agrupamento e responsabilidade sobre tarefas de produção.
- **Roteiros de fabricação:** etapas ordenadas, quantidades e dependências.
- **Tarefas:** cópias operacionais das etapas associadas aos itens vendidos.
- **Volumes:** unidades de etiquetagem e expedição de cada item.
- **Etiquetas:** fila, geração de códigos, PDFs e opção sem etiqueta.
- **Expedição:** consulta e confirmação por volume ou venda completa.
- **Usuários e permissões:** cadastro, aprovação, roles e RBAC.
- **Funcionários:** perfis, salários, benefícios, dependentes e documentos.
- **Vales e adiantamentos:** ciclos, listas, limites, parcelas e relatórios.
- **Auditoria:** registro de alterações e ações operacionais relevantes.

## 8. Fluxo principal de produção

1. A API valida os dados da OS, da entrega e dos itens.
2. O cliente é localizado ou cadastrado conforme os dados informados.
3. A ordem é persistida em `internal_orders`.
4. Cada entrada da OS cria um registro em `sold_items` com snapshot do nome do produto.
5. Os volumes de expedição são calculados a partir da quantidade vendida e da configuração do produto.
6. Se o produto possui roteiro, suas etapas são copiadas para `internal_tasks`.
7. As dependências do roteiro são copiadas para `internal_task_dependencies`.
8. Sem roteiro, produtos fabricados ou peças de reposição podem usar a geração legada de tarefas.
9. Tarefas sem predecessoras são liberadas; as demais aguardam suas dependências.
10. Ao concluir uma tarefa, o sistema verifica quais tarefas dependentes podem ser liberadas.
11. Quando todas as tarefas do item estão prontas, seus volumes passam para `released_for_label`.
12. Itens sem tarefas já criam volumes em `released_for_label` e não percorrem a produção.
13. A etiqueta pode ser gerada em PDF ou o volume pode ser marcado como pronto sem etiqueta.
14. A expedição confirma um volume pelo código ou todos os volumes de uma venda.
15. Os estados da ordem e do item são recalculados, e as ações relevantes são auditadas.

## 9. Máquinas de estado

### Ordem de serviço

```text
pending
  → in_progress
  → ready_for_label
  → partially_shipped
  → shipped

deleted é o estado de exclusão lógica.
```

### Tarefa

```text
pending ↔ ready

is_released indica se a tarefa está disponível para execução.
```

### Volume

```text
waiting_tasks
  → released_for_label
  → label_generated ou ready_without_label
  → shipped
```

### Lista de vales

```text
draft
  → pending_approval
  → approved

cancelled representa o cancelamento da lista.
```

## 10. Banco de dados

O modelo disponível contém 27 tabelas, agrupadas nos seguintes contextos:

- segurança: roles, permissões e usuários;
- ordens e produção: setores, produtos, clientes, itens, tarefas e volumes;
- auditoria: histórico genérico de ações;
- funcionários: perfis, salários, benefícios, dependentes e documentos;
- vales: ciclos, listas, itens, planos e parcelas.

As entidades usam UUIDs como chaves primárias. Foreign keys, constraints e índices sustentam relacionamentos, estados válidos, unicidade e consultas operacionais.

Há soft delete em áreas como ordens, funcionários, documentos e listas de vales. Tabelas de histórico preservam alterações salariais e de vale-alimentação.

Snapshots, como o nome do produto em `sold_items` e o nome da etapa em `internal_tasks`, preservam dados operacionais usados pela ordem.

Transações e locks de linha são empregados em fluxos concorrentes, especialmente no domínio de vales. Algumas consultas usam `FOR UPDATE` e `SKIP LOCKED`.

As migrations são arquivos SQL ordenados em `database/migrations/`. O runner `scripts/migrate.js` carrega o `.env` da raiz, conecta diretamente com `pg`, registra checksum e data de aplicação em `schema_migrations` e executa cada arquivo pendente em uma transação.

`database/schema.sql` e `database/migrations/` ainda apresentam divergências e não devem ser considerados equivalentes sem validação.

## 11. Serviços principais

| Serviço | Responsabilidade principal |
|---|---|
| `orderService` | Validação, criação da OS, itens, tarefas, volumes e liberação manual. |
| `manufacturingRouteService` | Roteiros, dependências, detecção de ciclos e cópia para tarefas. |
| `statusService` | Recalcula estados de itens, ordens e volumes liberados. |
| `labelService` | Gera códigos, QR Codes e PDFs nos modelos suportados. |
| `permissionService` | Catálogo de permissões, RBAC dinâmico e compatibilidade legada. |
| `auditService` | Persiste eventos na tabela genérica de auditoria. |
| `employeeService` | Perfis, históricos, dependentes, documentos e ficha do funcionário. |
| `advanceService` | Ciclos, listas, limites, vales individuais, parcelas e relatórios. |

## 12. Produção e execução

O frontend é compilado para `dist/` por `npm run build`.

`npm run frontend:prod` inicia o `server.js` da raiz. Ele serve os arquivos estáticos, entrega `index.html` como fallback da SPA e encaminha `/api` para `BACKEND_URL`.

O backend é iniciado separadamente por `npm run server` ou `npm run server:dev`. A API acessa o PostgreSQL por `DATABASE_URL`.

Portas padrão:

```text
5173  frontend Vite em desenvolvimento
4173  preview e servidor frontend de produção
3333  API Express
```

O diretório `uploads/` é usado em runtime e ignorado pelo Git. Seu local pode ser alterado por `EMPLOYEE_UPLOAD_DIR`.

## 13. Princípios arquiteturais observados

- abordagem pragmática orientada aos fluxos operacionais;
- PostgreSQL como persistência central e fonte de verdade dos estados;
- regras críticas próximas das transações que alteram os dados;
- preservação de histórico por snapshots, auditoria e tabelas temporais;
- autorização efetiva aplicada no backend;
- evolução incremental dos módulos;
- coexistência de implementações legadas e serviços mais recentes;
- reutilização de estados e entidades entre produção, etiquetas e expedição.

Esses princípios descrevem o estado observado do repositório, não uma política formal de evolução.

## 14. Limitações e dívidas técnicas conhecidas

- não há testes automatizados no repositório;
- o runner de migrations depende de SQL incremental idempotente para instalações que já aplicaram arquivos antigos manualmente;
- `schema.sql` e migrations possuem divergências;
- alguns serviços e páginas concentram muitas responsabilidades;
- o SQL está distribuído entre controladores e serviços;
- não há especificação OpenAPI;
- algumas listagens não possuem paginação;
- permissões e invariantes de domínio ainda precisam de consolidação.

## 15. Diretrizes para evolução

As recomendações abaixo não representam mecanismos já implantados:

- preservar o comportamento dos módulos estáveis ao evoluir o sistema;
- preferir alterações de impacto mínimo e escopo claramente delimitado;
- reutilizar serviços, componentes e padrões existentes quando adequados;
- evitar acoplamento desnecessário entre domínios;
- organizar novas funcionalidades por módulos e responsabilidades;
- manter a autorização efetiva nas rotas e serviços do backend;
- manter operações críticas dentro de transações;
- documentar a finalidade e a ordem das migrations;
- adicionar testes automatizados progressivamente.

## 16. Relação com outros documentos

`README.md` apresenta a visão inicial, os módulos, a configuração e a execução do sistema.

Os documentos abaixo ainda são planejados e não existem no estado atual do repositório:

```text
CHANGELOG.md
ROADMAP.md
docs/
```
