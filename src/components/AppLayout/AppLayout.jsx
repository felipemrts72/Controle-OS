import { useEffect, useState } from 'react';
import { Menu } from 'lucide-react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from '../Sidebar/Sidebar.jsx';
import { Header } from '../Header/Header.jsx';
import { useEscapeKey } from '../../hooks/useEscapeKey.js';
import './AppLayout.css';

export function AppLayout() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  useEscapeKey(isSidebarOpen, () => setIsSidebarOpen(false));

  useEffect(() => {
    document.body.classList.toggle('body_mobile-menu-open', isSidebarOpen);
    return () => document.body.classList.remove('body_mobile-menu-open');
  }, [isSidebarOpen]);

  return (
    <div className={`app-layout ${isSidebarOpen ? 'app-layout_sidebar-open' : ''}`}>
      <button
        className="app-layout__sidebar-toggle"
        type="button"
        onClick={() => setIsSidebarOpen(true)}
        aria-label="Abrir menu"
        aria-expanded={isSidebarOpen}
        aria-controls="app-sidebar"
      >
        <Menu size={22} />
      </button>
      <button className="app-layout__backdrop" type="button" onClick={() => setIsSidebarOpen(false)} aria-label="Fechar menu" />
      <Sidebar onNavigate={() => setIsSidebarOpen(false)} />
      <main className="app-layout__main">
        <Header />
        <div className="app-layout__content">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
