import { useState } from 'react';
import { Menu } from 'lucide-react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from '../Sidebar/Sidebar.jsx';
import { Header } from '../Header/Header.jsx';
import './AppLayout.css';

export function AppLayout() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  return (
    <div className={`app-layout ${isSidebarOpen ? 'app-layout_sidebar-open' : ''}`}>
      <button className="app-layout__sidebar-toggle" type="button" onClick={() => setIsSidebarOpen(true)} aria-label="Abrir menu">
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
