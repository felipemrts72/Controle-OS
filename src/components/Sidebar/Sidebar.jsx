import { Link, NavLink } from 'react-router-dom';
import { Boxes, ClipboardList, FileSearch, History, LayoutDashboard, Package, QrCode, Tags, Tv, Users, Wrench } from 'lucide-react';
import { getStoredUser } from '../../services/api.js';
import { canAccessPermission, getDefaultRoute } from '../../utils/permissions.js';
import './Sidebar.css';

const links = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, permission: 'dashboard.view' },
  { to: '/os', label: 'Ordens de Serviço', icon: ClipboardList, permission: 'orders.view' },
  { to: '/os/nova', label: 'Nova OS', icon: ClipboardList, permission: 'orders.create' },
  { to: '/produtos', label: 'Produtos', icon: Package, permission: 'products.view' },
  { to: '/setores', label: 'Setores', icon: Boxes, permission: 'sectors.view' },
  { to: '/servicos', label: 'Serviços', icon: Wrench, permission: 'services.view' },
  { to: '/fila-etiquetas', label: 'Fila de Etiquetas', icon: Tags, permission: 'labels.view' },
  { to: '/expedicao', label: 'Expedição', icon: QrCode, permission: 'shipping.view' },
  { to: '/auditoria-expedicoes', label: 'Auditoria de Expedições', icon: FileSearch, permission: 'shipping.audit.view' },
  { to: '/tv', label: 'Painel de TV', icon: Tv, permission: 'tv.view' },
  { to: '/historico-ordens', label: 'Histórico de Ordens', icon: History, permission: 'orders.history.view' },
  { to: '/usuarios', label: 'Usuários', icon: Users, permission: 'users.view' },
  { to: '/roles', label: 'Roles/Permissões', icon: Users, permission: 'roles.view' },
];

export function Sidebar({ onNavigate }) {
  const user = getStoredUser();
  const visibleLinks = links.filter((link) => canAccessPermission(user, link.permission));

  return (
    <aside className="sidebar" id="app-sidebar">
      <Link to={getDefaultRoute(user)} className="sidebar__brand" onClick={onNavigate}>Controle Interno</Link>
      <nav className="sidebar__nav">
        {visibleLinks.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} onClick={onNavigate} className={({ isActive }) => `sidebar__link ${isActive ? 'sidebar__link_active' : ''}`}>
            <Icon size={18} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
