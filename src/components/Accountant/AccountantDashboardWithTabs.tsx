import { useState } from 'react';
import { FileText, ShoppingCart, Package, DollarSign, Users, ListOrdered, Archive } from 'lucide-react';
import { AccountantDashboard } from './AccountantDashboard';
import { AccountantPOView } from './AccountantPOView';
import { AccountantRawMaterialPOView } from './AccountantRawMaterialPOView';
import { ItemPricing } from './ItemPricing';
import { CustomerOverview } from './CustomerOverview';
import { OrdersView } from '../Orders/OrdersView';
import { OrdersHistory } from '../Orders/OrdersHistory';

type Tab = 'monthly_summary' | 'customer_overview' | 'item_pricing' | 'warehouse_po' | 'raw_material_po' | 'orders' | 'orders_history';

export function AccountantDashboardWithTabs() {
  const [activeTab, setActiveTab] = useState<Tab>('monthly_summary');

  const tabs = [
    { id: 'monthly_summary' as Tab, label: 'Monthly Summary', icon: FileText },
    { id: 'customer_overview' as Tab, label: 'Customer Overview', icon: Users },
    { id: 'item_pricing' as Tab, label: 'Item Pricing', icon: DollarSign },
    { id: 'orders' as Tab, label: 'Orders', icon: ListOrdered },
    { id: 'orders_history' as Tab, label: 'Orders History', icon: Archive },
    { id: 'warehouse_po' as Tab, label: 'Warehouse POs', icon: ShoppingCart },
    { id: 'raw_material_po' as Tab, label: 'Raw Material POs', icon: Package },
  ];

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="flex border-b border-slate-200 overflow-x-auto">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex items-center gap-2 px-6 py-4 font-medium transition-colors whitespace-nowrap ${
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
          {activeTab === 'monthly_summary' && <AccountantDashboard />}
          {activeTab === 'customer_overview' && <CustomerOverview />}
          {activeTab === 'item_pricing' && <ItemPricing />}
          {activeTab === 'orders' && <OrdersView showFilters={true} />}
          {activeTab === 'orders_history' && <OrdersHistory />}
          {activeTab === 'warehouse_po' && <AccountantPOView type="warehouse" />}
          {activeTab === 'raw_material_po' && <AccountantRawMaterialPOView />}
        </div>
      </div>
    </div>
  );
}
