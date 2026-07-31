import { useEffect, useRef, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from '../components/AppLayout/AppLayout.jsx';
import { api, clearSession, getStoredToken, getStoredUser, onSessionCleared, setSession } from '../services/api.js';
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
import { EmployeeCreatePage } from '../pages/EmployeesPage/EmployeeCreatePage.jsx';
import { EmployeeDetailPage } from '../pages/EmployeesPage/EmployeeDetailPage.jsx';
import { AdvancesPage } from '../pages/AdvancesPage/AdvancesPage.jsx';
import { AdvanceSummaryPage } from '../pages/AdvancesPage/AdvanceSummaryPage.jsx';
import { AdvancesReportsPage } from '../pages/AdvancesPage/AdvancesReportsPage.jsx';
import { AdvanceGeneralReportPage } from '../pages/AdvancesPage/AdvanceGeneralReportPage.jsx';
import { AdvanceIndividualReportPage } from '../pages/AdvancesPage/AdvanceIndividualReportPage.jsx';
import { CompanySettingsPage } from '../pages/CompanySettingsPage/CompanySettingsPage.jsx';
import { AwardsPage } from '../pages/AwardsPage/AwardsPage.jsx';
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

function SessionLoading() {
  return (
    <main className="session-loading" aria-live="polite" aria-busy="true">
      <div className="session-loading__card">
        <div className="session-loading__mark" aria-hidden="true">OS</div>
        <div>
          <strong className="session-loading__brand">OliMen Gestão</strong>
          <p className="session-loading__text">Validando sessao...</p>
        </div>
        <span className="session-loading__spinner" aria-hidden="true" />
      </div>
    </main>
  );
}

export function AppRoutes() {
  const [isCheckingSession, setIsCheckingSession] = useState(() => Boolean(getStoredToken()));
  const didCheckSession = useRef(false);

  useEffect(() => {
    const removeSessionListener = onSessionCleared(() => {
      setIsCheckingSession(false);
    });

    if (didCheckSession.current) return removeSessionListener;
    didCheckSession.current = true;

    async function validateStoredSession() {
      const token = getStoredToken();
      if (!token) {
        clearSession();
        setIsCheckingSession(false);
        return;
      }

      try {
        const response = await api.get('/auth/me');
        setSession(token, response.data.user);
      } catch {
        clearSession();
      } finally {
        setIsCheckingSession(false);
      }
    }

    validateStoredSession();
    return removeSessionListener;
  }, []);

  if (isCheckingSession) return <SessionLoading />;

  return (
    <Routes>
      <Route path="/entrar" element={<LoginPage />} />
      <Route path="/registrar" element={<RegisterPage />} />
      <Route path="/tv" element={<RoleRoute permission="tv.view"><SectorTvPage /></RoleRoute>} />
      <Route path="/painel-tv" element={<Navigate to="/tv" replace />} />
      <Route path="/tv/:setorSlug" element={<RoleRoute permission="tv.view"><SectorTvPage /></RoleRoute>} />
      <Route path="/vales/:id/resumo" element={<RoleRoute permission="advances.view"><AdvanceSummaryPage /></RoleRoute>} />
      <Route path="/vales/relatorios/geral" element={<RoleRoute permission="advances.reports.general"><AdvanceGeneralReportPage /></RoleRoute>} />
      <Route path="/vales/relatorios/individual/:employeeId" element={<RoleRoute permission="advances.reports.individual"><AdvanceIndividualReportPage /></RoleRoute>} />
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
        <Route path="/configuracoes/empresa" element={<RoleRoute permission="company_settings.view"><CompanySettingsPage /></RoleRoute>} />
        <Route path="/premios" element={<RoleRoute permission="awards.view"><AwardsPage /></RoleRoute>} />
        <Route path="/funcionarios" element={<RoleRoute permission="employees.view"><EmployeesPage /></RoleRoute>} />
        <Route path="/funcionarios/novo" element={<RoleRoute permission="employees.create"><EmployeeCreatePage /></RoleRoute>} />
        <Route path="/funcionarios/cadastro-rapido" element={<RoleRoute permission="employees.create"><EmployeeQuickCreatePage /></RoleRoute>} />
        <Route path="/funcionarios/:id" element={<RoleRoute permission="employees.view"><EmployeeDetailPage /></RoleRoute>} />
        <Route path="/vales" element={<RoleRoute permission="advances.view"><AdvancesPage /></RoleRoute>} />
        <Route path="/vales/relatorios" element={<RoleRoute permission="advances.reports.view"><AdvancesReportsPage /></RoleRoute>} />
        <Route path="/vales/:id" element={<RoleRoute permission="advances.view"><AdvancesPage /></RoleRoute>} />
        <Route path="/acesso-negado" element={<AccessDenied />} />
      </Route>
    </Routes>
  );
}
