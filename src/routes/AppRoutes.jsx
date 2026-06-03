import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from '../components/AppLayout/AppLayout.jsx';
import { getStoredUser } from '../services/api.js';
import { LoginPage } from '../pages/LoginPage/LoginPage.jsx';
import { RegisterPage } from '../pages/RegisterPage/RegisterPage.jsx';
import { DashboardPage } from '../pages/DashboardPage/DashboardPage.jsx';
import { InternalOrdersPage } from '../pages/InternalOrdersPage/InternalOrdersPage.jsx';
import { InternalOrderCreatePage } from '../pages/InternalOrderCreatePage/InternalOrderCreatePage.jsx';
import { InternalOrderDetailPage } from '../pages/InternalOrderDetailPage/InternalOrderDetailPage.jsx';
import { ProductsPage } from '../pages/ProductsPage/ProductsPage.jsx';
import { ProductFormPage } from '../pages/ProductFormPage/ProductFormPage.jsx';
import { SectorsPage } from '../pages/SectorsPage/SectorsPage.jsx';
import { SectorTvPage } from '../pages/SectorTvPage/SectorTvPage.jsx';
import { ServicesPage } from '../pages/ServicesPage/ServicesPage.jsx';
import { ShippingPage } from '../pages/ShippingPage/ShippingPage.jsx';
import { LabelQueuePage } from '../pages/LabelQueuePage/LabelQueuePage.jsx';
import { ShippingAuditPage } from '../pages/ShippingAuditPage/ShippingAuditPage.jsx';
import { UsersPage } from '../pages/UsersPage/UsersPage.jsx';
import { canAccess, getDefaultRoute } from '../utils/permissions.js';

function ProtectedRoute({ children }) {
  return getStoredUser() ? children : <Navigate to="/entrar" replace />;
}

function AdminRoute({ children }) {
  const user = getStoredUser();
  if (!user) return <Navigate to="/entrar" replace />;
  return user.role === 'admin' ? children : <Navigate to={getDefaultRoute(user)} replace />;
}

function RoleRoute({ roles, children }) {
  const user = getStoredUser();
  if (!user) return <Navigate to="/entrar" replace />;
  return canAccess(user, roles) ? children : <Navigate to={getDefaultRoute(user)} replace />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/entrar" element={<LoginPage />} />
      <Route path="/registrar" element={<RegisterPage />} />
      <Route path="/tv" element={<RoleRoute roles={['admin', 'manager', 'viewer']}><SectorTvPage /></RoleRoute>} />
      <Route path="/painel-tv" element={<Navigate to="/tv" replace />} />
      <Route path="/tv/:setorSlug" element={<RoleRoute roles={['admin', 'manager', 'viewer']}><SectorTvPage /></RoleRoute>} />
      <Route path="/" element={<ProtectedRoute><Navigate to={getDefaultRoute(getStoredUser())} replace /></ProtectedRoute>} />
      <Route
        element={(
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        )}
      >
        <Route path="/dashboard" element={<RoleRoute roles={['admin', 'manager']}><DashboardPage /></RoleRoute>} />
        <Route path="/os" element={<RoleRoute roles={['admin', 'manager']}><InternalOrdersPage /></RoleRoute>} />
        <Route path="/os/nova" element={<RoleRoute roles={['admin', 'manager']}><InternalOrderCreatePage /></RoleRoute>} />
        <Route path="/os/:id" element={<RoleRoute roles={['admin', 'manager']}><InternalOrderDetailPage /></RoleRoute>} />
        <Route path="/produtos" element={<RoleRoute roles={['admin', 'manager']}><ProductsPage /></RoleRoute>} />
        <Route path="/produtos/novo" element={<RoleRoute roles={['admin', 'manager']}><ProductFormPage /></RoleRoute>} />
        <Route path="/produtos/:id" element={<RoleRoute roles={['admin', 'manager']}><ProductFormPage /></RoleRoute>} />
        <Route path="/setores" element={<RoleRoute roles={['admin']}><SectorsPage /></RoleRoute>} />
        <Route path="/servicos" element={<RoleRoute roles={['admin', 'manager']}><ServicesPage /></RoleRoute>} />
        <Route path="/expedicao" element={<RoleRoute roles={['admin', 'manager', 'shipping']}><ShippingPage /></RoleRoute>} />
        <Route path="/fila-etiquetas" element={<RoleRoute roles={['admin', 'manager', 'shipping']}><LabelQueuePage /></RoleRoute>} />
        <Route path="/auditoria-expedicoes" element={<RoleRoute roles={['admin', 'manager']}><ShippingAuditPage /></RoleRoute>} />
        <Route path="/usuarios" element={<AdminRoute><UsersPage /></AdminRoute>} />
      </Route>
    </Routes>
  );
}
