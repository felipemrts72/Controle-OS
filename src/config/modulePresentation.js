import {
  Boxes,
  Building2,
  ClipboardCheck,
  ClipboardList,
  FileSearch,
  HandCoins,
  History,
  IdCard,
  LayoutDashboard,
  Package,
  QrCode,
  ReceiptText,
  Settings,
  ShoppingCart,
  Tags,
  Trophy,
  Truck,
  Tv,
  Users,
  Wrench,
} from 'lucide-react';

export const NAVIGATION_ENTRIES = [
  {
    type: 'link', id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard,
    to: '/dashboard', permission: 'dashboard.view',
  },
  {
    type: 'module', id: 'production', label: 'Produção', icon: ClipboardList,
    items: [
      { to: '/os', label: 'Ordens de produção', icon: ClipboardList, permission: 'orders.view', match: (path) => path === '/os' || (path.startsWith('/os/') && path !== '/os/nova') },
      { to: '/os/nova', label: 'Nova ordem de produção', icon: ClipboardList, permission: 'orders.create' },
      { to: '/historico-ordens', label: 'Histórico de produção', icon: History, permission: 'orders.history.view' },
      { to: '/servicos', label: 'Serviços', icon: Wrench, permission: 'services.view' },
      { to: '/tv', label: 'Painel de produção', icon: Tv, permission: 'tv.view', match: (path) => path === '/tv' || path.startsWith('/tv/') },
    ],
  },
  {
    type: 'module', id: 'stock', label: 'Estoque', icon: Package,
    items: [
      { to: '/produtos', label: 'Produtos', icon: Package, permission: 'products.view', match: (path) => path === '/produtos' || path.startsWith('/produtos/') },
    ],
  },
  {
    type: 'module', id: 'purchases', label: 'Compras', icon: ShoppingCart,
    items: [
      { to: '/compras', label: 'Visão geral', icon: LayoutDashboard, permission: 'purchases.view' },
      { to: '/compras/solicitacoes', label: 'Solicitações de compra', icon: ClipboardList, permission: 'purchases.view' },
      { to: '/compras/aprovacoes', label: 'Aprovações', icon: ClipboardCheck, permission: 'purchases.approve' },
      { to: '/compras/cotacoes', label: 'Cotações', icon: ReceiptText, permission: 'purchases.view' },
      { to: '/compras/pedidos', label: 'Pedidos de compra', icon: ShoppingCart, permission: 'purchases.view' },
      { to: '/compras/recebimentos', label: 'Recebimentos', icon: ClipboardCheck, permission: 'purchases.receive' },
      { to: '/compras/fornecedores', label: 'Fornecedores', icon: Truck, permission: 'suppliers.view' },
      { to: '/compras/grupos', label: 'Grupos de materiais', icon: Boxes, permission: 'supplier_groups.manage' },
    ],
  },
  {
    type: 'module', id: 'shipping', label: 'Expedição', icon: Truck,
    items: [
      { to: '/fila-etiquetas', label: 'Fila de etiquetas', icon: Tags, permission: 'labels.view' },
      { to: '/expedicao', label: 'Conferência e envio', icon: QrCode, permission: 'shipping.view' },
      { to: '/auditoria-expedicoes', label: 'Auditoria', icon: FileSearch, permission: 'shipping.audit.view' },
    ],
  },
  {
    type: 'module', id: 'administrative', label: 'Administrativo', icon: Users,
    items: [
      { to: '/funcionarios', label: 'Funcionários', icon: IdCard, permission: 'employees.view', match: (path) => path === '/funcionarios' || path.startsWith('/funcionarios/') },
      { to: '/premios', label: 'Prêmios', icon: Trophy, permission: 'awards.view' },
      { to: '/vales', label: 'Vales', icon: HandCoins, permission: 'advances.view', match: (path) => path === '/vales' || (/^\/vales\/[^/]+$/.test(path) && path !== '/vales/relatorios') },
      { to: '/vales/relatorios', label: 'Relatórios de vales', icon: FileSearch, permission: 'advances.reports.view', match: (path) => path.startsWith('/vales/relatorios') },
    ],
  },
  {
    type: 'module', id: 'settings', label: 'Configurações', icon: Settings,
    items: [
      { to: '/usuarios', label: 'Usuários', icon: Users, permission: 'users.view' },
      { to: '/roles', label: 'Perfis e permissões', icon: Users, permission: 'roles.view' },
      { to: '/setores', label: 'Setores', icon: Boxes, permission: 'sectors.view' },
      { to: '/configuracoes/empresa', label: 'Configurações da empresa', icon: Building2, permission: 'company_settings.view' },
    ],
  },
];

export function isNavigationItemActive(item, pathname) {
  return item.match ? item.match(pathname) : pathname === item.to;
}

export function getNavigationItemsInOrder() {
  return NAVIGATION_ENTRIES.flatMap((entry) => (entry.type === 'link' ? [entry] : entry.items));
}

export function getVisibleNavigation(user, canAccess) {
  return NAVIGATION_ENTRIES.flatMap((entry) => {
    if (entry.type === 'link') return canAccess(user, entry.permission) ? [entry] : [];
    const items = entry.items.filter((item) => canAccess(user, item.permission));
    return items.length > 0 ? [{ ...entry, items }] : [];
  });
}

const permission = (module, subdivision, name) => ({ module, subdivision, name });

export const PERMISSION_PRESENTATION = {
  'dashboard.view': permission('Dashboard', null, 'Ver dashboard'),
  'orders.view': permission('Produção', null, 'Ver ordens de produção'),
  'orders.create': permission('Produção', null, 'Criar ordem de produção'),
  'orders.edit': permission('Produção', null, 'Editar ordem de produção'),
  'orders.delete': permission('Produção', null, 'Excluir ordem de produção'),
  'orders.history.view': permission('Produção', null, 'Ver histórico de produção'),
  'services.view': permission('Produção', null, 'Ver serviços'),
  'services.complete': permission('Produção', null, 'Concluir serviços'),
  'tv.view': permission('Produção', null, 'Ver painel de produção'),

  'products.view': permission('Estoque', null, 'Ver produtos'),
  'products.create': permission('Estoque', null, 'Criar produtos'),
  'products.edit': permission('Estoque', null, 'Editar produtos'),
  'products.delete': permission('Estoque', null, 'Excluir produtos'),
  'products.types.manage': permission('Estoque', null, 'Gerenciar tipos de produto'),

  'suppliers.view': permission('Compras', null, 'Ver fornecedores'),
  'suppliers.manage': permission('Compras', null, 'Gerenciar fornecedores'),
  'suppliers.create': permission('Compras', null, 'Criar fornecedores'),
  'suppliers.edit': permission('Compras', null, 'Editar fornecedores'),
  'suppliers.deactivate': permission('Compras', null, 'Desativar ou reativar fornecedores'),
  'supplier_groups.manage': permission('Compras', null, 'Gerenciar grupos de materiais'),
  'purchases.view': permission('Compras', null, 'Ver compras e solicitações'),
  'purchases.create_request': permission('Compras', null, 'Criar solicitações de compra'),
  'purchases.edit_own_request': permission('Compras', null, 'Editar solicitações próprias'),
  'purchases.approve': permission('Compras', null, 'Aprovar solicitações de compra'),
  'purchases.create_preapproved': permission('Compras', null, 'Criar solicitação pré-aprovada'),
  'purchases.create_direct': permission('Compras', null, 'Criar compras diretas'),
  'purchases.cancel': permission('Compras', null, 'Cancelar solicitações e compras'),
  'purchases.receive': permission('Compras', null, 'Registrar recebimentos'),
  'purchases.view_values': permission('Compras', null, 'Ver valores de compras'),
  'purchase_quotes.view': permission('Compras', null, 'Ver cotações'),
  'purchase_quotes.manage': permission('Compras', null, 'Gerenciar cotações'),
  'purchase_quotes.create': permission('Compras', null, 'Criar solicitações de cotação'),
  'purchase_quotes.send': permission('Compras', null, 'Registrar envio de cotações'),
  'purchase_quotes.register_response': permission('Compras', null, 'Registrar propostas de fornecedores'),
  'purchase_quotes.choose_supplier': permission('Compras', null, 'Escolher fornecedores em cotações'),
  'purchase_quotes.pdf': permission('Compras', null, 'Baixar PDFs de cotação'),
  'purchase_items.import': permission('Compras', null, 'Importar itens de compras'),
  'supplier_catalog.manage': permission('Compras', null, 'Gerenciar vínculos do catálogo de fornecedores'),
  'supplier_catalog.view': permission('Compras', null, 'Visualizar catálogo vinculado'),
  'purchase_imports.create_product': permission('Compras', null, 'Criar produto preliminar em Compras'),
  'supplier_prices.view': permission('Compras', null, 'Visualizar histórico de preços de fornecedores'),

  'labels.view': permission('Expedição', null, 'Ver fila de etiquetas'),
  'labels.print': permission('Expedição', null, 'Imprimir etiquetas'),
  'labels.reprint': permission('Expedição', null, 'Reimprimir etiquetas'),
  'labels.mark_without_label': permission('Expedição', null, 'Marcar sem etiqueta'),
  'shipping.view': permission('Expedição', null, 'Ver expedição'),
  'shipping.confirm': permission('Expedição', null, 'Confirmar expedição'),
  'shipping.ready_admin.view': permission('Expedição', null, 'Ver vendas prontas'),
  'shipping.audit.view': permission('Expedição', null, 'Ver auditoria de expedições'),

  'employees.view': permission('Administrativo', 'Funcionários', 'Ver funcionários'),
  'employees.manage': permission('Administrativo', 'Funcionários', 'Gerenciar funcionários'),
  'employees.create': permission('Administrativo', 'Funcionários', 'Criar funcionários'),
  'employees.edit': permission('Administrativo', 'Funcionários', 'Editar funcionários'),
  'employees.deactivate': permission('Administrativo', 'Funcionários', 'Desativar funcionários'),
  'employees.salary.view': permission('Administrativo', 'Funcionários', 'Ver salário de funcionários'),
  'employees.salary.manage': permission('Administrativo', 'Funcionários', 'Gerenciar salário de funcionários'),
  'employees.meal_allowance.view': permission('Administrativo', 'Funcionários', 'Ver vale-alimentação'),
  'employees.meal_allowance.manage': permission('Administrativo', 'Funcionários', 'Gerenciar vale-alimentação'),
  'employees.documents.view': permission('Administrativo', 'Funcionários', 'Ver documentos de funcionários'),
  'employees.documents.manage': permission('Administrativo', 'Funcionários', 'Gerenciar documentos de funcionários'),
  'employees.dependents.view': permission('Administrativo', 'Funcionários', 'Ver dependentes'),
  'employees.dependents.manage': permission('Administrativo', 'Funcionários', 'Gerenciar dependentes'),
  'employees.profile.print': permission('Administrativo', 'Funcionários', 'Imprimir ficha de funcionário'),
  'awards.view': permission('Administrativo', 'Prêmios', 'Ver prêmios'),
  'awards.create': permission('Administrativo', 'Prêmios', 'Criar prêmios'),
  'awards.edit': permission('Administrativo', 'Prêmios', 'Editar prêmios'),
  'awards.delete': permission('Administrativo', 'Prêmios', 'Excluir prêmios'),
  'awards.pdf': permission('Administrativo', 'Prêmios', 'Baixar termos de prêmios'),
  'advances.view': permission('Administrativo', 'Vales', 'Ver vales'),
  'advances.manage': permission('Administrativo', 'Vales', 'Gerenciar vales'),
  'advances.create': permission('Administrativo', 'Vales', 'Criar listas de vales'),
  'advances.lists.delete': permission('Administrativo', 'Vales', 'Excluir listas de vales'),
  'advances.edit_own_list': permission('Administrativo', 'Vales', 'Editar própria lista de vales'),
  'advances.review': permission('Administrativo', 'Vales', 'Revisar listas de vales'),
  'advances.approve': permission('Administrativo', 'Vales', 'Aprovar listas de vales'),
  'advances.override_limits': permission('Administrativo', 'Vales', 'Exceder limites de vales'),
  'advances.limit_lookup': permission('Administrativo', 'Vales', 'Consultar limite de vales'),
  'advances.create_individual': permission('Administrativo', 'Vales', 'Lançar vale individual'),
  'advances.installments.create': permission('Administrativo', 'Vales', 'Criar parcelamentos de vales'),
  'advances.installments.convert': permission('Administrativo', 'Vales', 'Parcelar vale existente'),
  'advances.installments.view': permission('Administrativo', 'Vales', 'Ver parcelamentos de vales'),
  'advances.reports.view': permission('Administrativo', 'Vales', 'Ver relatórios de vales'),
  'advances.reports.general': permission('Administrativo', 'Vales', 'Ver relatório geral de vales'),
  'advances.reports.individual': permission('Administrativo', 'Vales', 'Ver extrato individual de vales'),
  'advances.reports.cycles': permission('Administrativo', 'Vales', 'Ver ciclos anteriores de vales'),
  'advances.audit.view': permission('Administrativo', 'Vales', 'Ver auditoria de vales'),
  'advances.cycles.view': permission('Administrativo', 'Vales', 'Ver ciclos de vales'),
  'advances.cycles.create': permission('Administrativo', 'Vales', 'Iniciar ciclos de vales'),
  'advances.cycles.close': permission('Administrativo', 'Vales', 'Fechar ciclos de vales'),

  'company_settings.view': permission('Configurações', 'Configurações da empresa', 'Ver configurações da empresa'),
  'company_settings.edit': permission('Configurações', 'Configurações da empresa', 'Editar configurações da empresa'),
  'users.view': permission('Configurações', 'Usuários e perfis', 'Ver usuários'),
  'users.approve': permission('Configurações', 'Usuários e perfis', 'Aprovar usuários'),
  'users.manage': permission('Configurações', 'Usuários e perfis', 'Gerenciar usuários'),
  'users.change_password': permission('Configurações', 'Usuários e perfis', 'Alterar senhas'),
  'roles.view': permission('Configurações', 'Usuários e perfis', 'Ver perfis'),
  'roles.manage': permission('Configurações', 'Usuários e perfis', 'Gerenciar perfis'),
  'sectors.view': permission('Configurações', 'Setores', 'Ver setores'),
  'sectors.manage': permission('Configurações', 'Setores', 'Gerenciar setores'),
};

export const PERMISSION_MODULE_ORDER = [
  'Dashboard', 'Produção', 'Estoque', 'Compras', 'Expedição', 'Administrativo', 'Configurações',
];

export function groupPermissionsForPresentation(permissions) {
  const grouped = new Map(PERMISSION_MODULE_ORDER.map((module) => [module, new Map()]));
  permissions.forEach((item) => {
    const presentation = PERMISSION_PRESENTATION[item.code] || permission('Configurações', 'Outras', item.name);
    const moduleGroups = grouped.get(presentation.module) || new Map();
    const subdivision = presentation.subdivision || '';
    const subdivisionItems = moduleGroups.get(subdivision) || [];
    subdivisionItems.push({ ...item, visualName: presentation.name });
    moduleGroups.set(subdivision, subdivisionItems);
    grouped.set(presentation.module, moduleGroups);
  });
  return PERMISSION_MODULE_ORDER
    .filter((module) => grouped.get(module)?.size)
    .map((module) => ({
      module,
      subdivisions: Array.from(grouped.get(module), ([name, items]) => ({ name, items })),
    }));
}
