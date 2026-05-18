import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { AuthCallbackPage } from './pages/AuthCallbackPage';
import { CustomersPage } from './pages/CustomersPage';
import { EvalPage } from './pages/EvalPage';
import { IntakePage } from './pages/IntakePage';
import { MethodPage } from './pages/MethodPage';
import { SearchPage } from './pages/SearchPage';

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<IntakePage />} />
        <Route path="auth/callback" element={<AuthCallbackPage />} />
        <Route path="customers" element={<CustomersPage />} />
        <Route path="eval" element={<EvalPage />} />
        <Route path="method" element={<MethodPage />} />
        <Route path="search" element={<SearchPage />} />
        <Route path="*" element={<Navigate replace to="/" />} />
      </Route>
    </Routes>
  );
}
