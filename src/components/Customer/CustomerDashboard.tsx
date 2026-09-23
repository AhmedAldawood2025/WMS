import { useState } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { PlusCircle, ListOrdered } from 'lucide-react';
import { NewOrder } from './NewOrder';
import { MyOrders } from './MyOrders';

type Tab = 'new' | 'history';

export function CustomerDashboard() {
  const [activeTab, setActiveTab] = useState<Tab>('new');
  const { t } = useLanguage();

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="flex border-b border-slate-200">
          <button
            onClick={() => setActiveTab('new')}
            className={`flex items-center gap-2 px-6 py-4 font-medium transition-colors ${
              activeTab === 'new'
                ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            <PlusCircle className="w-5 h-5" />
            {t('new_order')}
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`flex items-center gap-2 px-6 py-4 font-medium transition-colors ${
              activeTab === 'history'
                ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            <ListOrdered className="w-5 h-5" />
            {t('my_orders')}
          </button>
        </div>

        <div className="p-6">
          {activeTab === 'new' && <NewOrder />}
          {activeTab === 'history' && <MyOrders />}
        </div>
      </div>
    </div>
  );
}
