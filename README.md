# OliMen Gestão

Sistema web para controle de ordens de serviço, produção, etiquetagem, expedição, funcionários e vales.

Alguns identificadores técnicos legados ainda utilizam o nome `Controle-OS` e são preservados para evitar impactos em integrações e dados locais.

## Visão geral

A aplicação centraliza as principais áreas da operação:

- ordens de serviço e clientes;
- produtos, tipos de produto e setores;
- roteiros de fabricação, tarefas e dependências;
- etiquetas em PDF, códigos numéricos e QR Codes;
- expedição e auditoria operacional;
- usuários, funções e permissões;
- funcionários, documentos e históricos;
- ciclos, listas, vales individuais, parcelamentos e relatórios.

O frontend React e a API Express estão no mesmo repositório, mas possuem estruturas e processos de execução separados. Ambos utilizam o PostgreSQL como banco de dados da aplicação.

## Tecnologias

### Frontend

- React 18;
- React Router 6;
- Axios 1;
- Vite 6;
- CSS organizado por páginas e componentes.

### Backend

- Node.js;
- Express 4;
- autenticação com JWT;
- PDFKit e QR Code;
- upload de documentos;
- API REST.

### Banco de dados

- PostgreSQL;
- SQL direto, sem ORM;
- migrations SQL versionadas;
- constraints, índices e transações para integridade operacional.

## Arquitetura

```text
Navegador
   │
   ▼
React SPA
   │
   │ Axios + JWT
   ▼
API Express
   │
   ├── Rotas
   ├── Middlewares
   ├── Controladores
   ├── Serviços
   └── Auditoria
   │
   ▼
PostgreSQL
```

Em produção, o `server.js` da raiz serve o build do frontend e encaminha as requisições `/api` para a API. Esse servidor não inicia o backend, que deve ser executado como um processo separado.

## Estrutura do projeto

```text
.
├── backend/
│   └── src/
│       ├── controllers/
│       ├── database/
│       ├── middlewares/
│       ├── routes/
│       ├── services/
│       └── utils/
├── database/
│   ├── migrations/
│   └── schema.sql
├── src/
│   ├── components/
│   ├── hooks/
│   ├── pages/
│   ├── routes/
│   ├── services/
│   ├── styles/
│   └── utils/
├── uploads/                 # dados de runtime; ignorado pelo Git
├── server.js
├── package.json
└── vite.config.js
```

## Principais módulos

### Ordens de serviço e produção

Cada produto incluído em uma OS gera um item vendido e seus volumes de expedição. Tarefas de fabricação são geradas quando o produto possui roteiro ou quando suas regras de tipo e peça de reposição exigem produção.

Ao criar a OS, as etapas e dependências do roteiro atual são copiadas para as tarefas do item. Tarefas sem dependências são liberadas inicialmente; as demais são liberadas após a conclusão das etapas predecessoras.

Itens sem tarefas têm seus volumes liberados diretamente para a etapa de etiquetas.

### Etiquetas e expedição

O sistema gera etiquetas individuais ou em lote nos formatos suportados pela aplicação. Os PDFs podem conter cliente, telefone, produto, nota fiscal ou venda, destino, peso, identificação do volume, código numérico e QR Code.

A expedição permite consultar e confirmar volumes por leitura de QR Code ou código numérico, além de consultar e confirmar uma venda completa. As operações relevantes são registradas para auditoria.

### Usuários e permissões

O acesso é controlado por funções e permissões. Em cada requisição autenticada, o backend valida o JWT e consulta novamente o usuário no banco, fazendo com que alterações de função, permissões, aprovação ou ativação tenham efeito na requisição seguinte.

### Funcionários

O módulo oferece cadastro rápido e completo, histórico salarial, histórico de vale-alimentação, dependentes, documentos, impressão da ficha cadastral, perfil de vales e auditoria de alterações.

Os documentos são armazenados no diretório `uploads/`, ou no caminho configurado por variável de ambiente. Esse diretório contém dados de runtime e não é versionado pelo Git.

### Vales e adiantamentos

O módulo controla ciclos, listas de vales, submissão e aprovação, limites, vales individuais, parcelamentos, relatórios gerais e individuais, histórico e auditoria.

## Fluxo operacional principal

```text
Criação da OS e dos itens vendidos
               │
               ▼
       Criação dos volumes
               │
       ┌───────┴────────┐
       │                │
Item com produção   Item sem produção
       │                │
       ▼                │
Geração e execução      │
das tarefas             │
       │                │
       └───────┬────────┘
               ▼
Liberação dos volumes para etiqueta
               │
               ▼
Geração das etiquetas ou marcação sem etiqueta
               │
               ▼
Expedição e auditoria
```

## Estados principais

### Ordem de serviço

```text
pending
in_progress
ready_for_label
partially_shipped
shipped
deleted
```

### Tarefa

```text
pending
ready
```

A disponibilidade operacional da tarefa também é controlada pelo campo `is_released`.

### Volume

```text
waiting_tasks
released_for_label
label_generated
ready_without_label
shipped
```

## Configuração

Use `.env.example` como referência e defina valores próprios para o ambiente. Não reutilize o valor ilustrativo de `JWT_SECRET` em produção.

| Variável | Finalidade | Padrão no código |
|---|---|---|
| `PORT` | Porta da API | `3333` |
| `DATABASE_URL` | Conexão com o PostgreSQL | sem padrão funcional |
| `JWT_SECRET` | Assinatura dos tokens JWT | deve ser definido com valor seguro |
| `VITE_API_URL` | URL-base da API no frontend | `/api` |
| `FRONTEND_PORT` | Porta do servidor frontend de produção | `4173` |
| `BACKEND_URL` | Destino do proxy `/api` | `http://127.0.0.1:3333` |
| `EMPLOYEE_UPLOAD_DIR` | Diretório dos documentos de funcionários | `uploads/employees` |
| `EMPLOYEE_DOCUMENT_MAX_BYTES` | Limite dos documentos | 10 MiB |

As quatro primeiras variáveis estão em `.env.example`. As demais são consumidas pelo código, mas ainda não aparecem nesse arquivo de exemplo.

## Desenvolvimento e scripts

Instale as dependências:

```bash
npm install
```

Execute frontend e backend em terminais separados:

```bash
npm run dev
npm run server:dev
```

Scripts disponíveis:

| Script | Finalidade | Porta padrão |
|---|---|---:|
| `npm run dev` | Frontend Vite em desenvolvimento | `5173` |
| `npm run build` | Gera o frontend em `dist/` | — |
| `npm run preview` | Pré-visualiza o build | `4173` |
| `npm run frontend:prod` | Serve `dist/` e encaminha `/api` | `4173` |
| `npm run server` | Inicia a API Express | `3333` |
| `npm run server:dev` | Inicia a API com Nodemon | `3333` |

O projeto ainda não declara uma versão oficial de Node.js em `package.json`.

## Banco de dados

O repositório contém `database/schema.sql` e migrations SQL em `database/migrations/`. Não existe atualmente um executor automatizado de migrations no `package.json`.

O `schema.sql` e o conjunto de migrations ainda possuem divergências e não devem ser tratados como equivalentes sem validação. Entre as diferenças conhecidas estão a restrição dos tipos de produto e o conjunto consolidado de permissões de funcionários. O procedimento oficial de criação e atualização do banco ainda precisa ser definido.

## Produção

O frontend e o backend devem ser executados separadamente:

1. `npm run build` gera o frontend em `dist/`;
2. `npm run frontend:prod` inicia o `server.js` da raiz;
3. o servidor publica `dist/` e encaminha `/api` para `BACKEND_URL`;
4. `npm run server` inicia a API em outro processo;
5. a API acessa o PostgreSQL por meio de `DATABASE_URL`.

O `server.js` não executa o build e não inicia o backend automaticamente.

## Versão

Versão Git correspondente ao estado atual documentado:

```text
v2.3.2
```

O campo `version` do `package.json` permanece em `1.0.0` e não representa a tag Git acima.

## Licença

O repositório ainda não contém um arquivo de licença nem uma política formal de uso e distribuição. Essas condições devem ser definidas pelos responsáveis pelo projeto.
