import { Link, NavLink } from 'react-router-dom';
import { Boxes, ClipboardList, FileSearch, History, LayoutDashboard, Package, QrCode, Tags, Tv, Users, Wrench } from 'lucide-react';
import { getStoredUser } from '../../services/api.js';
import { canAccessPermission, getDefaultRoute } from '../../utils/permissions.js';
import './Sidebar.css';

const links = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, permission: 'dashboard' },
  { to: '/os', label: 'Ordens de Serviço', icon: ClipboardList, permission: 'orders' },
  { to: '/os/nova', label: 'Nova OS', icon: ClipboardList, permission: 'order-create' },
  { to: '/produtos', label: 'Produtos', icon: Package, permission: 'products' },
  { to: '/setores', label: 'Setores', icon: Boxes, permission: 'sectors' },
  { to: '/servicos', label: 'Serviços', icon: Wrench, permission: 'services' },
  { to: '/fila-etiquetas', label: 'Fila de Etiquetas', icon: Tags, permission: 'labels' },
  { to: '/expedicao', label: 'Expedição', icon: QrCode, permission: 'shipping' },
  { to: '/auditoria-expedicoes', label: 'Auditoria de Expedições', icon: FileSearch, permission: 'shipping-audit' },
  { to: '/tv', label: 'Painel de TV', icon: Tv, permission: 'tv' },
  { to: '/historico-ordens', label: 'Histórico de Ordens', icon: History, permission: 'order-history' },
  { to: '/usuarios', label: 'Usuários', icon: Users, permission: 'users' },
];

export function Sidebar() {
  const user = getStoredUser();
  const visibleLinks = links.filter((link) => canAccessPermission(user, link.permission));

  return (
    <aside className="sidebar">
      <Link to={getDefaultRoute(user)} className="sidebar__brand">Controle Interno</Link>
      <nav className="sidebar__nav">
        {visibleLinks.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} className={({ isActive }) => `sidebar__link ${isActive ? 'sidebar__link_active' : ''}`}>
            <Icon size={18} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
