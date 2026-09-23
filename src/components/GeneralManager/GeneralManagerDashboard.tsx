import { useState } from 'react';
import { CheckCircle, AlertTriangle, Layers, FileText } from 'lucide-react';
import { PurchaseOrderApprovals } from './PurchaseOrderApprovals';
import { StockLevelAlerts } from './StockLevelAlerts';
import { CurrentStockView } from './CurrentStockView';
import { AccountantDashboard } from '../Accountant/AccountantDashboard';
import { useLanguage } from '../../contexts/LanguageContext';

type Tab = 'po_approvals' | 'stock_alerts' | 'current_stock' | 'monthly_reports';

export function GeneralManagerDashboard() {
  const [activeTab, setActiveTab] = useState<Tab>('po_approvals');
  const { t } = useLanguage();

  const tabs = [
    { id: 'po_approvals' as Tab, label: t('po_approvals'), icon: CheckCircle },
    { id: 'stock_alerts' as Tab, label: t('stock_alerts'), icon: AlertTriangle },
    { id: 'current_stock' as Tab, label: t('current_stock'), icon: Layers },
    { id: 'monthly_reports' as Tab, label: t('monthly_reports'), icon: FileText },
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
          {activeTab === 'po_approvals' && <PurchaseOrderApprovals />}
          {activeTab === 'stock_alerts' && <StockLevelAlerts />}
          {activeTab === 'current_stock' && <CurrentStockView />}
          {activeTab === 'monthly_reports' && <AccountantDashboard />}
        </div>
      </div>
    </div>
  );
}
