import { useState } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { Users, Building2, Package, ListOrdered, Truck, Beef, Archive } from 'lucide-react';
import { UserManagement } from './UserManagement';
import { BranchManagement } from './BranchManagement';
import { ItemManagement } from './ItemManagement';
import { OrdersView } from '../Orders/OrdersView';
import { OrdersHistory } from '../Orders/OrdersHistory';
import { SupplierManagement } from './SupplierManagement';
import { RawMaterialManagement } from './RawMaterialManagement';

type Tab = 'users' | 'branches' | 'items' | 'orders' | 'orders_history' | 'suppliers' | 'raw_materials';

export function AdminDashboard() {
  const [activeTab, setActiveTab] = useState<Tab>('users');
  const { t } = useLanguage();

  const tabs = [
    { id: 'users' as Tab, label: t('users'), icon: Users },
    { id: 'branches' as Tab, label: t('branches'), icon: Building2 },
    { id: 'items' as Tab, label: t('items'), icon: Package },
    { id: 'suppliers' as Tab, label: t('suppliers'), icon: Truck },
    { id: 'raw_materials' as Tab, label: t('raw_materials'), icon: Beef },
    { id: 'orders' as Tab, label: t('orders'), icon: ListOrdered },
    { id: 'orders_history' as Tab, label: 'Orders History', icon: Archive },
  ];

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="flex border-b border-slate-200 overflow-x-auto">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex items-center gap-2 px-6 py-4 font-medium transition-colors ${
                activeTab === id
                  ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              <Icon className="w-5 h-5" />
              {label}
            </button>
          ))}
        </div>

        <div className="p-6">
          {activeTab === 'users' && <UserManagement />}
          {activeTab === 'branches' && <BranchManagement />}
          {activeTab === 'items' && <ItemManagement />}
          {activeTab === 'suppliers' && <SupplierManagement />}
          {activeTab === 'raw_materials' && <RawMaterialManagement />}
          {activeTab === 'orders' && <OrdersView />}
          {activeTab === 'orders_history' && <OrdersHistory />}
        </div>
      </div>
    </div>
  );
}
