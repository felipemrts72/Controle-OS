import { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import {
  Boxes,
  Building2,
  ChevronDown,
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
import { getStoredUser } from '../../services/api.js';
import { canAccessPermission, getDefaultRoute } from '../../utils/permissions.js';
import './Sidebar.css';

const STORAGE_KEY = 'olimen-gestao:sidebar-open-groups';

const menuGroups = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, permission: 'dashboard.view' },
    ],
  },
  {
    id: 'orders',
    label: 'Ordens de Serviço',
    icon: ClipboardList,
    items: [
      { to: '/os', label: 'Ordens', icon: ClipboardList, permission: 'orders.view', match: (path) => path === '/os' || (path.startsWith('/os/') && path !== '/os/nova') },
      { to: '/os/nova', label: 'Nova OS', icon: ClipboardList, permission: 'orders.create' },
      { to: '/historico-ordens', label: 'Histórico', icon: History, permission: 'orders.history.view' },
      { to: '/servicos', label: 'Serviços', icon: Wrench, permission: 'services.view' },
    ],
  },
  {
    id: 'purchases',
    label: 'Compras',
    icon: ShoppingCart,
    items: [
      { to: '/compras', label: 'Visão geral', icon: LayoutDashboard, permission: 'purchases.view' },
      { to: '/compras/solicitacoes', label: 'Solicitações', icon: ClipboardList, permission: 'purchases.view' },
      { to: '/compras/aprovacoes', label: 'Aprovações', icon: ClipboardCheck, permission: 'purchases.approve' },
      { to: '/compras/cotacoes', label: 'Cotações', icon: ReceiptText, permission: 'purchases.view' },
      { to: '/compras/pedidos', label: 'Pedidos', icon: ShoppingCart, permission: 'purchases.view' },
      { to: '/compras/fornecedores', label: 'Fornecedores', icon: Truck, permission: 'suppliers.view' },
      { to: '/compras/grupos', label: 'Grupos de materiais', icon: Boxes, permission: 'supplier_groups.manage' },
    ],
  },
  {
    id: 'products',
    label: 'Produtos',
    icon: Package,
    items: [
      { to: '/produtos', label: 'Produtos', icon: Package, permission: 'products.view', match: (path) => path === '/produtos' || path.startsWith('/produtos/') },
    ],
  },
  {
    id: 'people',
    label: 'Gestão de Pessoas',
    icon: Users,
    items: [
      { to: '/funcionarios', label: 'Funcionários', icon: IdCard, permission: 'employees.view', match: (path) => path === '/funcionarios' || path.startsWith('/funcionarios/') },
      { to: '/premios', label: 'Prêmios', icon: Trophy, permission: 'awards.view' },
      { to: '/vales', label: 'Vales', icon: HandCoins, permission: 'advances.view', match: (path) => path === '/vales' || (/^\/vales\/[^/]+$/.test(path) && path !== '/vales/relatorios') },
      { to: '/vales/relatorios', label: 'Relatórios de vales', icon: FileSearch, permission: 'advances.reports.view', match: (path) => path.startsWith('/vales/relatorios') },
      { to: '/setores', label: 'Setores', icon: Boxes, permission: 'sectors.view' },
    ],
  },
  {
    id: 'shipping',
    label: 'Expedição',
    icon: Truck,
    items: [
      { to: '/fila-etiquetas', label: 'Fila de etiquetas', icon: Tags, permission: 'labels.view' },
      { to: '/expedicao', label: 'Conferência e envio', icon: QrCode, permission: 'shipping.view' },
      { to: '/auditoria-expedicoes', label: 'Auditoria', icon: FileSearch, permission: 'shipping.audit.view' },
    ],
  },
  {
    id: 'tv',
    label: 'Painel de TV',
    icon: Tv,
    items: [
      { to: '/tv', label: 'Painel de TV', icon: Tv, permission: 'tv.view', match: (path) => path === '/tv' || path.startsWith('/tv/') },
    ],
  },
  {
    id: 'settings',
    label: 'Configurações',
    icon: Settings,
    items: [
      { to: '/usuarios', label: 'Usuários', icon: Users, permission: 'users.view' },
      { to: '/roles', label: 'Roles / Permissões', icon: Users, permission: 'roles.view' },
      { to: '/configuracoes/empresa', label: 'Configurações da empresa', icon: Building2, permission: 'company_settings.view' },
    ],
  },
];

function readStoredGroups() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
  } catch {
    return {};
  }
}

function isItemActive(item, pathname) {
  if (item.match) return item.match(pathname);
  return pathname === item.to;
}

export function Sidebar({ onNavigate }) {
  const user = getStoredUser();
  const { pathname } = useLocation();
  const visibleGroups = useMemo(() => menuGroups
    .map((group) => ({ ...group, items: group.items.filter((item) => canAccessPermission(user, item.permission)) }))
    .filter((group) => group.items.length > 0), [user]);
  const activeGroupId = visibleGroups.find((group) => group.items.some((item) => isItemActive(item, pathname)))?.id;
  const [openGroups, setOpenGroups] = useState(() => ({
    ...readStoredGroups(),
    ...(activeGroupId ? { [activeGroupId]: true } : {}),
  }));

  useEffect(() => {
    if (!activeGroupId) return;
    setOpenGroups((current) => current[activeGroupId] ? current : { ...current, [activeGroupId]: true });
  }, [activeGroupId]);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(openGroups)); } catch {
      // A navegação permanece funcional quando o armazenamento não está disponível.
    }
  }, [openGroups]);

  function toggleGroup(groupId) {
    setOpenGroups((current) => ({ ...current, [groupId]: !current[groupId] }));
  }

  return (
    <aside className="sidebar" id="app-sidebar">
      <Link to={getDefaultRoute(user)} className="sidebar__brand" onClick={onNavigate}>OliMen Gestão</Link>
      <nav className="sidebar__nav" aria-label="Navegação principal">
        {visibleGroups.map((group) => {
          const GroupIcon = group.icon;
          const groupIsActive = group.items.some((item) => isItemActive(item, pathname));
          const isOpen = Boolean(openGroups[group.id]);
          const contentId = `sidebar-group-${group.id}`;
          return (
            <section className={`sidebar__group ${groupIsActive ? 'sidebar__group_active' : ''}`} key={group.id}>
              <button
                className="sidebar__group-toggle"
                type="button"
                onClick={() => toggleGroup(group.id)}
                aria-expanded={isOpen}
                aria-controls={contentId}
              >
                <GroupIcon size={18} aria-hidden="true" />
                <span>{group.label}</span>
                <ChevronDown className={`sidebar__chevron ${isOpen ? 'sidebar__chevron_open' : ''}`} size={16} aria-hidden="true" />
              </button>
              <div className="sidebar__group-items" id={contentId} hidden={!isOpen}>
                {group.items.map(({ to, label, icon: ItemIcon, match }) => {
                  const active = isItemActive({ to, match }, pathname);
                  return (
                    <NavLink
                      key={to}
                      to={to}
                      end
                      onClick={onNavigate}
                      aria-current={active ? 'page' : undefined}
                      className={`sidebar__link ${active ? 'sidebar__link_active' : ''}`}
                    >
                      <ItemIcon size={15} aria-hidden="true" />
                      <span>{label}</span>
                    </NavLink>
                  );
                })}
              </div>
            </section>
          );
        })}
      </nav>
    </aside>
  );
}
