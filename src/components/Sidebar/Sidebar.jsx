import { Link, NavLink } from 'react-router-dom';
import { Boxes, ClipboardList, FileSearch, LayoutDashboard, Package, QrCode, Tags, Tv, Users, Wrench } from 'lucide-react';
import { getStoredUser } from '../../services/api.js';
import { canAccess } from '../../utils/permissions.js';
import './Sidebar.css';

const links = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['admin', 'manager'] },
  { to: '/os', label: 'Ordens de Serviço', icon: ClipboardList, roles: ['admin', 'manager'] },
  { to: '/os/nova', label: 'Nova OS', icon: ClipboardList, roles: ['admin', 'manager'] },
  { to: '/produtos', label: 'Produtos', icon: Package, roles: ['admin', 'manager'] },
  { to: '/setores', label: 'Setores', icon: Boxes, roles: ['admin'] },
  { to: '/servicos', label: 'Serviços', icon: Wrench, roles: ['admin', 'manager'] },
  { to: '/fila-etiquetas', label: 'Fila de Etiquetas', icon: Tags, roles: ['admin', 'manager', 'shipping'] },
  { to: '/expedicao', label: 'Expedição', icon: QrCode, roles: ['admin', 'manager', 'shipping'] },
  { to: '/auditoria-expedicoes', label: 'Auditoria de Expedições', icon: FileSearch, roles: ['admin', 'manager'] },
  { to: '/tv', label: 'Painel de TV', icon: Tv, roles: ['admin', 'manager', 'viewer'] },
  { to: '/usuarios', label: 'Usuários', icon: Users, roles: ['admin'] },
];

export function Sidebar() {
  const user = getStoredUser();
  const visibleLinks = links.filter((link) => canAccess(user, link.roles));

  return (
    <aside className="sidebar">
      <Link to="/dashboard" className="sidebar__brand">Controle Interno</Link>
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
