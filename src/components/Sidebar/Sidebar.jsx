import { Link, NavLink } from 'react-router-dom';
import { Boxes, ClipboardList, LayoutDashboard, Package, QrCode, Tags, Tv, Users } from 'lucide-react';
import { getStoredUser } from '../../services/api.js';
import './Sidebar.css';

const links = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/os/nova', label: 'Nova OS', icon: ClipboardList },
  { to: '/produtos', label: 'Produtos', icon: Package },
  { to: '/setores', label: 'Setores', icon: Boxes },
  { to: '/fila-etiquetas', label: 'Fila de Etiquetas', icon: Tags },
  { to: '/expedicao', label: 'Expedição', icon: QrCode },
  { to: '/tv/torno', label: 'TV Torno', icon: Tv },
  { to: '/usuarios', label: 'Usuários', icon: Users, adminOnly: true },
];

export function Sidebar() {
  const user = getStoredUser();
  const visibleLinks = links.filter((link) => !link.adminOnly || user?.role === 'admin');

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
