import { Link, NavLink } from 'react-router-dom';
import { Boxes, ClipboardList, LayoutDashboard, Package, QrCode, Tags, Tv } from 'lucide-react';
import './Sidebar.css';

const links = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/os/nova', label: 'Nova OS', icon: ClipboardList },
  { to: '/produtos', label: 'Produtos', icon: Package },
  { to: '/setores', label: 'Setores', icon: Boxes },
  { to: '/fila-etiquetas', label: 'Fila de Etiquetas', icon: Tags },
  { to: '/expedicao', label: 'Expedição', icon: QrCode },
  { to: '/tv/torno', label: 'TV Torno', icon: Tv },
];

export function Sidebar() {
  return (
    <aside className="sidebar">
      <Link to="/dashboard" className="sidebar__brand">Controle Interno</Link>
      <nav className="sidebar__nav">
        {links.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} className={({ isActive }) => `sidebar__link ${isActive ? 'sidebar__link_active' : ''}`}>
            <Icon size={18} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
