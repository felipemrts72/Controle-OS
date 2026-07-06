import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from '../components/AppLayout/AppLayout.jsx';
import { getStoredUser } from '../services/api.js';
import { LoginPage } from '../pages/LoginPage/LoginPage.jsx';
import { RegisterPage } from '../pages/RegisterPage/RegisterPage.jsx';
import { DashboardPage } from '../pages/DashboardPage/DashboardPage.jsx';
import { InternalOrdersPage } from '../pages/InternalOrdersPage/InternalOrdersPage.jsx';
import { InternalOrderCreatePage } from '../pages/InternalOrderCreatePage/InternalOrderCreatePage.jsx';
import { InternalOrderEditPage } from '../pages/InternalOrderEditPage/InternalOrderEditPage.jsx';
import { InternalOrderDetailPage } from '../pages/InternalOrderDetailPage/InternalOrderDetailPage.jsx';
import { ProductsPage } from '../pages/ProductsPage/ProductsPage.jsx';
import { ProductTypesPage } from '../pages/ProductTypesPage/ProductTypesPage.jsx';
import { ProductFormPage } from '../pages/ProductFormPage/ProductFormPage.jsx';
import { SectorsPage } from '../pages/SectorsPage/SectorsPage.jsx';
import { SectorTvPage } from '../pages/SectorTvPage/SectorTvPage.jsx';
import { ServicesPage } from '../pages/ServicesPage/ServicesPage.jsx';
import { ShippingPage } from '../pages/ShippingPage/ShippingPage.jsx';
import { LabelQueuePage } from '../pages/LabelQueuePage/LabelQueuePage.jsx';
import { ShippingAuditPage } from '../pages/ShippingAuditPage/ShippingAuditPage.jsx';
import { OrderHistoryPage } from '../pages/OrderHistoryPage/OrderHistoryPage.jsx';
import { UsersPage } from '../pages/UsersPage/UsersPage.jsx';
import { RolesPage } from '../pages/RolesPage/RolesPage.jsx';
import { EmployeesPage } from '../pages/EmployeesPage/EmployeesPage.jsx';
import { EmployeeQuickCreatePage } from '../pages/EmployeesPage/EmployeeQuickCreatePage.jsx';
import { EmployeeDetailPage } from '../pages/EmployeesPage/EmployeeDetailPage.jsx';
import { canAccessPermission, getDefaultRoute } from '../utils/permissions.js';

function ProtectedRoute({ children }) {
  return getStoredUser() ? children : <Navigate to="/entrar" replace />;
}

function RoleRoute({ permission, children }) {
  const user = getStoredUser();
  if (!user) return <Navigate to="/entrar" replace />;
  const defaultRoute = getDefaultRoute(user);
  if (canAccessPermission(user, permission)) return children;
  return defaultRoute === '/acesso-negado' ? <AccessDenied /> : <Navigate to={defaultRoute} replace />;
}

function AccessDenied() {
  return (
    <section className="page">
      <div className="panel">
        <h1 className="page__title">Acesso não permitido</h1>
      </div>
    </section>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/entrar" element={<LoginPage />} />
      <Route path="/registrar" element={<RegisterPage />} />
      <Route path="/tv" element={<RoleRoute permission="tv.view"><SectorTvPage /></RoleRoute>} />
      <Route path="/painel-tv" element={<Navigate to="/tv" replace />} />
      <Route path="/tv/:setorSlug" element={<RoleRoute permission="tv.view"><SectorTvPage /></RoleRoute>} />
      <Route path="/" element={<ProtectedRoute><Navigate to={getDefaultRoute(getStoredUser())} replace /></ProtectedRoute>} />
      <Route
        element={(
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        )}
      >
        <Route path="/dashboard" element={<RoleRoute permission="dashboard.view"><DashboardPage /></RoleRoute>} />
        <Route path="/os" element={<RoleRoute permission="orders.view"><InternalOrdersPage /></RoleRoute>} />
        <Route path="/os/nova" element={<RoleRoute permission="orders.create"><InternalOrderCreatePage /></RoleRoute>} />
        <Route path="/os/:id/editar" element={<RoleRoute permission="orders.edit"><InternalOrderEditPage /></RoleRoute>} />
        <Route path="/os/:id" element={<RoleRoute permission="orders.view"><InternalOrderDetailPage /></RoleRoute>} />
        <Route path="/produtos" element={<RoleRoute permission="products.view"><ProductsPage /></RoleRoute>} />
        <Route path="/produtos/tipos" element={<RoleRoute permission="products.types.manage"><ProductTypesPage /></RoleRoute>} />
        <Route path="/produtos/novo" element={<RoleRoute permission="products.create"><ProductFormPage /></RoleRoute>} />
        <Route path="/produtos/:id" element={<RoleRoute permission="products.edit"><ProductFormPage /></RoleRoute>} />
        <Route path="/setores" element={<RoleRoute permission="sectors.view"><SectorsPage /></RoleRoute>} />
        <Route path="/servicos" element={<RoleRoute permission="services.view"><ServicesPage /></RoleRoute>} />
        <Route path="/expedicao" element={<RoleRoute permission="shipping.view"><ShippingPage /></RoleRoute>} />
        <Route path="/fila-etiquetas" element={<RoleRoute permission="labels.view"><LabelQueuePage /></RoleRoute>} />
        <Route path="/auditoria-expedicoes" element={<RoleRoute permission="shipping.audit.view"><ShippingAuditPage /></RoleRoute>} />
        <Route path="/historico-ordens" element={<RoleRoute permission="orders.history.view"><OrderHistoryPage /></RoleRoute>} />
        <Route path="/usuarios" element={<RoleRoute permission="users.view"><UsersPage /></RoleRoute>} />
        <Route path="/roles" element={<RoleRoute permission="roles.view"><RolesPage /></RoleRoute>} />
        <Route path="/funcionarios" element={<RoleRoute permission="employees.view"><EmployeesPage /></RoleRoute>} />
        <Route path="/funcionarios/cadastro-rapido" element={<RoleRoute permission="employees.view"><EmployeeQuickCreatePage /></RoleRoute>} />
        <Route path="/funcionarios/:id" element={<RoleRoute permission="employees.view"><EmployeeDetailPage /></RoleRoute>} />
        <Route path="/acesso-negado" element={<AccessDenied />} />
      </Route>
    </Routes>
  );
}
