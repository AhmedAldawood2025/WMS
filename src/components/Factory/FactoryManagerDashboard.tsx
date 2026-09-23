import { useState } from 'react';
import { Package, ShoppingCart, Factory, TrendingDown, Layers, ClipboardList, PlusCircle } from 'lucide-react';
import { OrdersView } from '../Orders/OrdersView';
import { RawMaterialPurchaseOrders } from './RawMaterialPurchaseOrders';
import { ProductionBatches } from './ProductionBatches';
import { FactoryStockAdjustments } from './StockAdjustments';
import { CurrentStock } from './CurrentStock';
import { DailyFactoryOperation } from './DailyFactoryOperation';
import { NewOrder } from '../Customer/NewOrder';
import { useLanguage } from '../../contexts/LanguageContext';

type Tab = 'orders' | 'new_order' | 'current_stock' | 'raw_material_po' | 'production' | 'stock_adjustments' | 'daily_operation';

export function FactoryManagerDashboard() {
  const [activeTab, setActiveTab] = useState<Tab>('orders');
  const { t } = useLanguage();

  const tabs = [
    { id: 'orders' as Tab, label: t('customer_orders'), icon: Package },
    { id: 'new_order' as Tab, label: 'New Order', icon: PlusCircle },
    { id: 'daily_operation' as Tab, label: 'Daily Operation', icon: ClipboardList },
    { id: 'current_stock' as Tab, label: t('current_stock'), icon: Layers },
    { id: 'raw_material_po' as Tab, label: t('raw_material_pos'), icon: ShoppingCart },
    { id: 'production' as Tab, label: t('production_batches'), icon: Factory },
    { id: 'stock_adjustments' as Tab, label: t('stock_adjustments'), icon: TrendingDown },
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
          {activeTab === 'orders' && <OrdersView key="orders" />}
          {activeTab === 'new_order' && <NewOrder key="new_order" showAllBranches managerMode />}
          {activeTab === 'daily_operation' && <DailyFactoryOperation key="daily_operation" />}
          {activeTab === 'current_stock' && <CurrentStock key="current_stock" />}
          {activeTab === 'raw_material_po' && <RawMaterialPurchaseOrders key="raw_material_po" />}
          {activeTab === 'production' && <ProductionBatches key="production" />}
          {activeTab === 'stock_adjustments' && <FactoryStockAdjustments key="stock_adjustments" />}
        </div>
      </div>
    </div>
  );
}
