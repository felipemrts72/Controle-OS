import { Outlet } from 'react-router-dom';
import { Sidebar } from '../Sidebar/Sidebar.jsx';
import { Header } from '../Header/Header.jsx';
import './AppLayout.css';

export function AppLayout() {
  return (
    <div className="app-layout">
      <Sidebar />
      <main className="app-layout__main">
        <Header />
        <div className="app-layout__content">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
