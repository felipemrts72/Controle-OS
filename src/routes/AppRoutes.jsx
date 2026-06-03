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
import { OrderHistoryPage } from '../pages/OrderHistoryPage/OrderHistoryPage.jsx';
import { UsersPage } from '../pages/UsersPage/UsersPage.jsx';
import { canAccessPermission, getDefaultRoute } from '../utils/permissions.js';

function ProtectedRoute({ children }) {
  return getStoredUser() ? children : <Navigate to="/entrar" replace />;
}

function RoleRoute({ permission, children }) {
  const user = getStoredUser();
  if (!user) return <Navigate to="/entrar" replace />;
  return canAccessPermission(user, permission) ? children : <Navigate to={getDefaultRoute(user)} replace />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/entrar" element={<LoginPage />} />
      <Route path="/registrar" element={<RegisterPage />} />
      <Route path="/tv" element={<RoleRoute permission="tv"><SectorTvPage /></RoleRoute>} />
      <Route path="/painel-tv" element={<Navigate to="/tv" replace />} />
      <Route path="/tv/:setorSlug" element={<RoleRoute permission="tv"><SectorTvPage /></RoleRoute>} />
      <Route path="/" element={<ProtectedRoute><Navigate to={getDefaultRoute(getStoredUser())} replace /></ProtectedRoute>} />
      <Route
        element={(
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        )}
      >
        <Route path="/dashboard" element={<RoleRoute permission="dashboard"><DashboardPage /></RoleRoute>} />
        <Route path="/os" element={<RoleRoute permission="orders"><InternalOrdersPage /></RoleRoute>} />
        <Route path="/os/nova" element={<RoleRoute permission="order-create"><InternalOrderCreatePage /></RoleRoute>} />
        <Route path="/os/:id" element={<RoleRoute permission="orders"><InternalOrderDetailPage /></RoleRoute>} />
        <Route path="/produtos" element={<RoleRoute permission="products"><ProductsPage /></RoleRoute>} />
        <Route path="/produtos/novo" element={<RoleRoute permission="products"><ProductFormPage /></RoleRoute>} />
        <Route path="/produtos/:id" element={<RoleRoute permission="products"><ProductFormPage /></RoleRoute>} />
        <Route path="/setores" element={<RoleRoute permission="sectors"><SectorsPage /></RoleRoute>} />
        <Route path="/servicos" element={<RoleRoute permission="services"><ServicesPage /></RoleRoute>} />
        <Route path="/expedicao" element={<RoleRoute permission="shipping"><ShippingPage /></RoleRoute>} />
        <Route path="/fila-etiquetas" element={<RoleRoute permission="labels"><LabelQueuePage /></RoleRoute>} />
        <Route path="/auditoria-expedicoes" element={<RoleRoute permission="shipping-audit"><ShippingAuditPage /></RoleRoute>} />
        <Route path="/historico-ordens" element={<RoleRoute permission="order-history"><OrderHistoryPage /></RoleRoute>} />
        <Route path="/usuarios" element={<RoleRoute permission="users"><UsersPage /></RoleRoute>} />
      </Route>
    </Routes>
  );
}
