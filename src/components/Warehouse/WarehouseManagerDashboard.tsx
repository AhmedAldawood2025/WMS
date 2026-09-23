import { useState } from 'react';
import { Package, ShoppingCart, TrendingDown, Layers, PlusCircle } from 'lucide-react';
import { OrdersView } from '../Orders/OrdersView';
import { WarehousePurchaseOrders } from './WarehousePurchaseOrders';
import { StockAdjustments } from './StockAdjustments';
import { CurrentStock } from './CurrentStock';
import { NewOrder } from '../Customer/NewOrder';
import { useLanguage } from '../../contexts/LanguageContext';

type Tab = 'orders' | 'new_order' | 'current_stock' | 'purchase_orders' | 'stock_adjustments';

export function WarehouseManagerDashboard() {
  const [activeTab, setActiveTab] = useState<Tab>('orders');
  const { t } = useLanguage();

  const tabs = [
    { id: 'orders' as Tab, label: t('customer_orders'), icon: Package },
    { id: 'new_order' as Tab, label: 'New Order', icon: PlusCircle },
    { id: 'current_stock' as Tab, label: t('current_stock'), icon: Layers },
    { id: 'purchase_orders' as Tab, label: t('purchase_orders'), icon: ShoppingCart },
    { id: 'stock_adjustments' as Tab, label: t('stock_adjustments'), icon: TrendingDown },
  ];

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="flex border-b border-slate-200">
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
          {activeTab === 'orders' && <OrdersView />}
          {activeTab === 'new_order' && <NewOrder showAllBranches managerMode />}
          {activeTab === 'current_stock' && <CurrentStock />}
          {activeTab === 'purchase_orders' && <WarehousePurchaseOrders />}
          {activeTab === 'stock_adjustments' && <StockAdjustments />}
        </div>
      </div>
    </div>
  );
}
