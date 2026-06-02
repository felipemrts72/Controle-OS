import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from '../components/AppLayout/AppLayout.jsx';
import { getStoredUser } from '../services/api.js';
import { LoginPage } from '../pages/LoginPage/LoginPage.jsx';
import { RegisterPage } from '../pages/RegisterPage/RegisterPage.jsx';
import { DashboardPage } from '../pages/DashboardPage/DashboardPage.jsx';
import { InternalOrderCreatePage } from '../pages/InternalOrderCreatePage/InternalOrderCreatePage.jsx';
import { InternalOrderDetailPage } from '../pages/InternalOrderDetailPage/InternalOrderDetailPage.jsx';
import { ProductsPage } from '../pages/ProductsPage/ProductsPage.jsx';
import { ProductFormPage } from '../pages/ProductFormPage/ProductFormPage.jsx';
import { SectorsPage } from '../pages/SectorsPage/SectorsPage.jsx';
import { SectorTvPage } from '../pages/SectorTvPage/SectorTvPage.jsx';
import { ShippingPage } from '../pages/ShippingPage/ShippingPage.jsx';
import { LabelQueuePage } from '../pages/LabelQueuePage/LabelQueuePage.jsx';
import { UsersPage } from '../pages/UsersPage/UsersPage.jsx';

function ProtectedRoute({ children }) {
  return getStoredUser() ? children : <Navigate to="/entrar" replace />;
}

function AdminRoute({ children }) {
  const user = getStoredUser();
  if (!user) return <Navigate to="/entrar" replace />;
  return user.role === 'admin' ? children : <Navigate to="/dashboard" replace />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/entrar" element={<LoginPage />} />
      <Route path="/registrar" element={<RegisterPage />} />
      <Route path="/tv/:setorSlug" element={<SectorTvPage />} />
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route
        element={(
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        )}
      >
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/os/nova" element={<InternalOrderCreatePage />} />
        <Route path="/os/:id" element={<InternalOrderDetailPage />} />
        <Route path="/produtos" element={<ProductsPage />} />
        <Route path="/produtos/novo" element={<ProductFormPage />} />
        <Route path="/produtos/:id" element={<ProductFormPage />} />
        <Route path="/setores" element={<SectorsPage />} />
        <Route path="/expedicao" element={<ShippingPage />} />
        <Route path="/fila-etiquetas" element={<LabelQueuePage />} />
        <Route path="/usuarios" element={<AdminRoute><UsersPage /></AdminRoute>} />
      </Route>
    </Routes>
  );
}
