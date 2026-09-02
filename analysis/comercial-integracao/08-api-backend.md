# 08 — Padrão de API e backend

## Organização

`backend/src/app.js` monta routers sob `/api`. O padrão desejável dos módulos mais novos é:

```text
route
└── autenticação + permissão + parsing HTTP específico
    └── controller fino
        └── service com validação, transação, SQL e auditoria
            └── PostgreSQL/filesystem/PDF
```

Não existe camada formal de repository. `basicControllers.js` contém SQL direto para Produtos; services novos contêm o SQL. Para Comercial, usar controller fino + service mantém coerência com Compras, Empresa, Funcionários e PDF. Criar repositories só deve ocorrer por refatoração/padrão deliberado do projeto, não apenas no novo módulo.

## Exemplos reais

### Produto

- Route: `GET /api/products`, `POST /api/products`, `GET/PUT/DELETE /api/products/:id`.
- Permissões distintas: `products.view/create/edit/delete`.
- Controller/regra: `basicControllers.js`.
- Validação manual: tipo ativo, setor ativo, unidade válida, componentes, ciclos e regras de Revenda.
- Persistência: SQL parametrizado em transação.
- Resposta: objeto direto; criação `201`; delete `204`.
- Erros: `httpError`, com `code`/`field` em vários casos.

### Configurações da empresa

- Route/controller/service separados.
- `GET` retorna singleton público, mesmo que ainda não exista linha.
- `PUT` faz insert/update e retorna objeto.
- Upload usa `express.raw`, service e auditoria.

### Compras

- `purchaseController.js` usa wrapper `handler()` e delega a services.
- Listas paginadas frequentemente retornam `{ data, pagination }`.
- Lista paginada de Produtos retorna outro formato: `{ items, page, limit, total, total_pages }`.
- PDFs fogem do wrapper, coordenam service de dados, company settings, builder e resposta binária.

## Request/response

- JSON padrão via `express.json()`.
- Query params para filtros/paginação.
- Rotas REST pragmáticas, com ações como `/active`, `/select`, `/dispatches` e `/pdf`.
- Respostas de erro:

```json
{
  "message": "Mensagem legível",
  "code": "CODIGO_OPCIONAL",
  "field": "campo_opcional",
  "details": {}
}
```

- `23505` vira 409; `23503` vira 400; 500 não expõe erro interno e registra método/path/stack.
- CORS expõe `Content-Disposition` e `Content-Length` para downloads.

## Validação

Não há Joi/Zod/Yup/express-validator. A validação é manual nos services/controllers e por constraints no PostgreSQL. Há helpers de normalização para unidade, documentos, texto, moeda e HTTP errors.

Para Orçamentos:

- validar payload no service;
- usar códigos/fields estáveis nos erros;
- validar status/transições no backend;
- validar Produto/Cliente mesmo que o frontend já tenha selecionado;
- usar NUMERIC no banco e conversão consciente, evitando ponto flutuante para totais;
- snapshots devem ser montados no backend, não aceitos cegamente do cliente.

## Transações, concorrência e auditoria

- `transaction(callback)` faz BEGIN/COMMIT/ROLLBACK e libera conexão.
- Produtos usam advisory lock transacional para o grafo de componentes.
- Migrations usam advisory lock de sessão.
- Operações relevantes escrevem `audit_logs` na mesma transação.

Orçamento deve transacionar cabeçalho, itens, snapshots, número e histórico. Geração de PDF pode ser somente leitura + evento de auditoria. Se houver numeração sequencial, adotar contador bloqueado/atômico, não `MAX + 1`.

## Busca a reutilizar/adaptar

- Produtos: `/api/products/search` retorna até 40 ativos e filtra matéria-prima por padrão; isso é inadequado sem revisão para Orçamentos, pois a política comercial pode ser diferente. Criar contexto/filtros claros ou endpoint comercial que reutilize a consulta do cadastro mestre.
- Clientes: `/api/internal-orders/customers` é acoplado a `orders.view` e retorna só 8 campos/resultados; precisa ser generalizado.
- Unidades: `/api/measurement-units` já é compartilhado por múltiplas Permissões e pode ser consumido quando o item comercial precisar de unidade.

## Nomes e conflitos de domínio

Compras já possui:

- `purchase_quote_requests` e `purchase_quote_items`;
- rotas `/api/purchases/quotes`;
- Permissões `purchase_quotes.*`;
- PDF `purchaseQuotePdfService.js`.

Um Orçamento de venda não deve reutilizar essas tabelas/rotas. Recomendações técnicas:

- tabelas `commercial_quotes` / `commercial_quote_items`;
- API `/api/commercial-quotes` ou `/api/commercial/quotes`;
- Permissões `commercial_quotes.*`;
- UI em `/comercial/orcamentos`.

## Estrutura sugerida, sem implementação

```text
backend/src/routes/commercialQuoteRoutes.js
backend/src/controllers/commercialQuoteController.js
backend/src/services/commercialQuoteService.js
backend/src/services/pdf/orcamento/...
```

Caso Catálogo Técnico cresça, um `technicalCatalogService.js` dedicado é preferível a ampliar `basicControllers.js`.
