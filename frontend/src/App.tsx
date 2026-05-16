import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { CustomersPage } from './pages/CustomersPage';
import { MethodPage } from './pages/MethodPage';
import { SearchPage } from './pages/SearchPage';

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<SearchPage />} />
        <Route path="customers" element={<CustomersPage />} />
        <Route path="method" element={<MethodPage />} />
        <Route path="*" element={<Navigate replace to="/" />} />
      </Route>
    </Routes>
  );
}
