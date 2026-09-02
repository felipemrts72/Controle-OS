# 07 — Menu, navegação e padrões de UI

## Navegação

A configuração central é `src/config/modulePresentation.js`:

- `NAVIGATION_ENTRIES` define links/grupos, rótulo, ícone, rota, Permissão e matching.
- `Sidebar` filtra com `getVisibleNavigation()` e persiste grupos abertos em `localStorage`.
- `AppRoutes.jsx` declara as rotas e suas Permissões.
- `src/utils/permissions.js` deriva a rota padrão da mesma ordem de navegação.
- `PERMISSION_PRESENTATION` e `PERMISSION_MODULE_ORDER` organizam a tela de Perfis e Permissões.

Para adicionar futuramente:

```text
COMERCIAL
└── Orçamentos → /comercial/orcamentos
```

serão necessários, de forma coordenada:

1. novo grupo `commercial` em `NAVIGATION_ENTRIES`, com ícone Lucide;
2. item de Orçamentos e Permissão `commercial_quotes.view`;
3. rota(s) em `AppRoutes.jsx` com `RoleRoute`;
4. apresentação das permissões no módulo “Comercial”;
5. inclusão de “Comercial” em `PERMISSION_MODULE_ORDER`.

Produtos permanecem no grupo `stock`. Não adicionar link concorrente de Produtos dentro de Comercial; se útil, Orçamento pode abrir/selecionar o Produto por link contextual.

## Rotas recomendadas

- `/comercial/orcamentos` — listagem.
- `/comercial/orcamentos/novo` — criação.
- `/comercial/orcamentos/:id` — detalhe.
- `/comercial/orcamentos/:id/editar` — edição, se o fluxo não usar o detalhe editável.
- Produto continua `/produtos/:id`; Catálogo Técnico pode ser aba nessa página ou subrota `/produtos/:id/catalogo-tecnico`.

Evitar `/cotacoes`, porque o projeto já usa “Cotações” para Compras.

## Edição atual de Produto

A edição é uma página com formulário, não modal:

- `ProductFormPage` carrega Produto, tipos, setores e unidades, chama POST/PUT e coordena upload inicial.
- `ProductForm` apresenta dados básicos, revisão, componentes, roteiro e foto.
- `ProductComponentsEditor`, `ProductManufacturingRouteEditor`, `ProductPhotoEditor` são componentes separados.
- Não existe controle de tabs reutilizável.

Ponto de encaixe preferido do Catálogo Técnico: navegação interna no detalhe de Produto. Como o formulário atual é longo, uma aba/subrota separa claramente dados mestres operacionais de conteúdo técnico versionado e permite Permissão própria. A tela de Catálogo deve aceitar Produto incompleto/sem catálogo sem bloquear a edição normal.

## Padrões visuais existentes

### Estrutura de página

- `.page`: grid principal.
- `.page__header`, `.page__title`, `.page__subtitle`, `.page__actions`.
- `.panel`: card branco/surface com borda, raio e sombra.
- Páginas tipicamente combinam cabeçalho, filtros em painel, tabela e modais de confirmação.

### Formulários

- `.form-grid` responsivo por `auto-fit`.
- `.field`, `.field__label`, `.field__input` para input/select/textarea.
- Validação HTML (`required`, `min`, `maxLength`) mais validação manual/backend.
- Botões `.button`, `.button_primary`, `.button_danger`.
- Estados de envio desabilitam o botão e mudam o rótulo.

### Tabelas

- `DataTable` recebe `columns`, `rows`, `render` e empty state.
- CSS transforma células em layout mobile usando `data-label`.
- Listagens mais novas possuem busca, filtros, paginação, loading discreto, erro e retry.

### Modais

- `ConfirmModal` suporta título, corpo, ações, cancelamento e fecha por Escape.
- É usado tanto para confirmação simples quanto fluxos complexos.
- Não há portal/focus trap explícito no componente atual; evitar colocar todo o editor principal de Orçamento em modal.

### Feedback

- `ToastProvider`: success/error/warning/info, deduplicação e duração de 7 segundos.
- Loading é local por página/componente; não há skeleton/spinner global, salvo validação de sessão.
- Erros normalmente usam `error.response?.data?.message`.

### Responsividade e tema

- Breakpoint principal global em 760 px; grids viram uma coluna, ações/botões ocupam largura completa.
- Sidebar tem drawer/backdrop mobile e fecha com Escape.
- DataTable possui apresentação mobile própria.
- Tema claro/escuro por CSS variables e `data-theme`, persistido em `localStorage`.
- Largura mínima do documento: 320 px.

## Diretrizes para aparência nativa do Comercial

- Reutilizar `page`, `panel`, `form-grid`, `field`, `button`, `DataTable`, `ConfirmModal`, Toast e ícones Lucide.
- Manter tipografia, cores e tokens de `variables.css`.
- Tratar criação/edição complexa em página.
- Incluir estados vazio, loading, erro/retry, paginação e layout mobile desde o início.
- Usar formatos `pt-BR` para data/moeda, centralizando helpers em vez de repetir expressões.
- Não copiar layout do ERP Universal; trazer apenas regras/dados depois do mapeamento de compatibilidade.

## Bibliotecas reutilizáveis de frontend

- React/React Router para páginas e rotas.
- Axios para API e blobs autenticados.
- Lucide React para ícones.
- APIs nativas: `Intl`/`toLocaleString` para moeda/data; `File.text()` para CSV; `URL.createObjectURL` para preview; Clipboard para texto.

Não existem bibliotecas de formulário/validação, date picker, máscara genérica, drag-and-drop, galeria ou preview avançado. Máscaras atuais são funções locais. Não há razão para instalar dependência antes de definir UX do Catálogo.
