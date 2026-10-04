import { useState } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { AdminDashboard } from './AdminDashboard';
import { WarehouseManagerDashboard } from '../Warehouse/WarehouseManagerDashboard';
import { FactoryManagerDashboard } from '../Factory/FactoryManagerDashboard';
import { GeneralManagerDashboard } from '../GeneralManager/GeneralManagerDashboard';
import { AccountantDashboardWithTabs } from '../Accountant/AccountantDashboardWithTabs';

type View = 'admin' | 'warehouse_manager' | 'factory_manager' | 'general_manager' | 'accountant';

// Admins are the top-level role: besides their own screens they can open every
// other role's dashboard. The database lets them through via the
// "Admins have full access" policies.
export function AdminWorkspace() {
  const [view, setView] = useState<View>('admin');
  const { t } = useLanguage();

  const views: View[] = ['admin', 'warehouse_manager', 'factory_manager', 'general_manager', 'accountant'];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {views.map((id) => (
          <button
            key={id}
            onClick={() => setView(id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              view === id
                ? 'bg-blue-600 text-white'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            {t(id)}
          </button>
        ))}
      </div>

      {view === 'admin' && <AdminDashboard />}
      {view === 'warehouse_manager' && <WarehouseManagerDashboard />}
      {view === 'factory_manager' && <FactoryManagerDashboard />}
      {view === 'general_manager' && <GeneralManagerDashboard />}
      {view === 'accountant' && <AccountantDashboardWithTabs />}
    </div>
  );
}
