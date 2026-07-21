import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SocketProvider } from './context/SocketContext';
import { PlantProvider } from './context/PlantContext';
import { ThemeProvider } from './context/ThemeContext';
import Layout from './components/layout/Layout';
import LoginPage from './pages/LoginPage';
import VerifyEmailPage from './pages/VerifyEmailPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import DashboardPage from './pages/DashboardPage';
import AlertsPage from './pages/AlertsPage';
import PlantOverviewPage from './pages/PlantOverviewPage';
import ReportsPage from './pages/ReportsPage';
import TariffReportPage from './pages/TariffReportPage';
import GeneratorAnalysisPage from './pages/GeneratorAnalysisPage';
import SetpointsPage from './pages/SetpointsPage';
import DeviceSettingsPage from './pages/DeviceSettingsPage';
import UsersPage from './pages/UsersPage';
import { ReactNode } from 'react';

function Private({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  return token ? <>{children}</> : <Navigate to="/login" replace />;
}

function Public({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  return token ? <Navigate to="/" replace /> : <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Public><LoginPage /></Public>} />
      <Route path="/verify-email/:token" element={<VerifyEmailPage />} />
      <Route path="/forgot-password" element={<Public><ForgotPasswordPage /></Public>} />
      <Route path="/reset-password/:token" element={<Public><ResetPasswordPage /></Public>} />
      <Route path="/" element={
        <Private>
          <SocketProvider>
            <PlantProvider>
              <Layout />
            </PlantProvider>
          </SocketProvider>
        </Private>
      }>
        <Route index element={<DashboardPage />} />
        <Route path="alerts" element={<AlertsPage />} />
        <Route path="overview" element={<PlantOverviewPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="reports/tariff" element={<TariffReportPage />} />
        <Route path="reports/generator-analysis" element={<GeneratorAnalysisPage />} />
        <Route path="setpoints" element={<SetpointsPage />} />
        <Route path="device-settings" element={<DeviceSettingsPage />} />
        <Route path="users" element={<UsersPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
          <Toaster
            position="top-right"
            toastOptions={{ style: { background: '#1f2937', color: '#f9fafb', border: '1px solid #374151' } }}
          />
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
}
