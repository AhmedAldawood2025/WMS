import { AuthProvider, useAuth } from './contexts/AuthContext';
import { LanguageProvider } from './contexts/LanguageContext';
import { SignIn } from './components/Auth/SignIn';
import { Layout } from './components/Layout/Layout';
import { AdminDashboard } from './components/Admin/AdminDashboard';
import { CustomerDashboard } from './components/Customer/CustomerDashboard';
import { WarehouseManagerDashboard } from './components/Warehouse/WarehouseManagerDashboard';
import { FactoryManagerDashboard } from './components/Factory/FactoryManagerDashboard';
import { GeneralManagerDashboard } from './components/GeneralManager/GeneralManagerDashboard';
import { AccountantDashboardWithTabs } from './components/Accountant/AccountantDashboardWithTabs';

function AppContent() {
  const { user, profile, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-lg text-slate-600">Loading...</div>
      </div>
    );
  }

  if (!user || !profile) {
    return <SignIn />;
  }

  return (
    <Layout>
      {profile.role === 'admin' && <AdminDashboard />}
      {profile.role === 'customer' && <CustomerDashboard />}
      {profile.role === 'warehouse_manager' && <WarehouseManagerDashboard />}
      {profile.role === 'factory_manager' && <FactoryManagerDashboard />}
      {profile.role === 'general_manager' && <GeneralManagerDashboard />}
      {profile.role === 'accountant' && <AccountantDashboardWithTabs />}
    </Layout>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <LanguageProvider>
        <AppContent />
      </LanguageProvider>
    </AuthProvider>
  );
}
