import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { useLanguage } from '../../contexts/LanguageContext';
import { Download, Building2, Calendar, Filter } from 'lucide-react';

interface MonthlySummary {
  branch_name: string;
  branch_code?: string;
  item_serial: string;
  item_name: string;
  item_category: string;
  total_quantity: number;
  unit_price: number;
  total_cost: number;
}

interface Branch { id: string; name: string; code?: string | null; }

type CategoryTab = 'warehouse' | 'factory';

export function AccountantDashboard() {
  const [summaries, setSummaries] = useState<MonthlySummary[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<CategoryTab>('warehouse');

  // Filters
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const [branchFilter, setBranchFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [useMonthPicker, setUseMonthPicker] = useState(true);

  const { t } = useLanguage();

  useEffect(() => {
    supabase.from('branches').select('id, name, code').order('name').then(({ data }) => {
      setBranches(data || []);
    });
  }, []);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('orders')
        .select(`
          id,
          created_at,
          branch:branches(id, name, code),
          order_items(
            quantity,
            item:items(serial, name, category, unit_price)
          )
        `)
        .eq('status', 'completed');

      if (useMonthPicker) {
        const startDate = new Date(Date.UTC(year, month - 1, 1)).toISOString();
        const endDate = new Date(Date.UTC(year, month, 1)).toISOString();
        query = query.gte('approved_at', startDate).lt('approved_at', endDate);
      } else {
        if (dateFrom) query = query.gte('approved_at', dateFrom);
        if (dateTo) query = query.lt('approved_at', dateTo + 'T23:59:59');
      }

      if (branchFilter !== 'all') query = query.eq('branch_id', branchFilter);

      const { data: orders, error } = await query;
      if (error) throw error;

      const summaryMap: Record<string, MonthlySummary> = {};
      (orders as any[]).forEach(order => {
        const branchName = order.branch?.name || 'Unknown';
        const branchCode = order.branch?.code || '';
        order.order_items?.forEach((oi: any) => {
          if (!oi.item) return;
          const key = `${branchName}-${oi.item.serial}`;
          if (!summaryMap[key]) {
            summaryMap[key] = {
              branch_name: branchName,
              branch_code: branchCode,
              item_serial: oi.item.serial,
              item_name: oi.item.name,
              item_category: oi.item.category,
              total_quantity: 0,
              unit_price: oi.item.unit_price || 0,
              total_cost: 0,
            };
          }
          summaryMap[key].total_quantity += oi.quantity;
          summaryMap[key].total_cost += oi.quantity * (oi.item.unit_price || 0);
        });
      });

      setSummaries(
        Object.values(summaryMap).sort((a, b) =>
          a.branch_name.localeCompare(b.branch_name) || a.item_serial.localeCompare(b.item_serial)
        )
      );
    } catch (error) {
      console.error('Error loading summary:', error);
    } finally {
      setLoading(false);
    }
  }, [month, year, branchFilter, dateFrom, dateTo, useMonthPicker]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  const downloadCSV = (category: CategoryTab) => {
    const filtered = summaries.filter(s => s.item_category === category);
    const headers = ['Branch Code', 'Branch', 'Item Code', 'Item Name', 'Total Quantity', 'Unit Price', 'Total Cost'];
    const rows = filtered.map(s => [
      s.branch_code || '',
      s.branch_name,
      s.item_serial,
      s.item_name,
      s.total_quantity.toString(),
      s.unit_price.toFixed(2),
      s.total_cost.toFixed(2),
    ]);
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(',')),
    ].join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `monthly_summary_${category}_${year}_${month.toString().padStart(2, '0')}.csv`;
    link.click();
  };

  const warehouseSummaries = summaries.filter(s => s.item_category === 'warehouse');
  const factorySummaries = summaries.filter(s => s.item_category === 'factory');
  const activeSummaries = activeTab === 'warehouse' ? warehouseSummaries : factorySummaries;

  const SummaryTable = ({ rows }: { rows: MonthlySummary[] }) => (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <table className="w-full">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Branch</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">{t('serial')}</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">{t('name')}</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">{t('total')}</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Unit Price</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Total Cost</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {rows.map((s, idx) => (
            <tr key={idx} className="hover:bg-slate-50">
              <td className="px-4 py-4 whitespace-nowrap text-sm text-slate-900">
                {s.branch_code && (
                  <span className="text-xs font-semibold text-blue-600 mr-1">[{s.branch_code}]</span>
                )}
                {s.branch_name}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm font-mono font-medium text-slate-900">{s.item_serial}</td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-900">{s.item_name}</td>
              <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-slate-900">{s.total_quantity}</td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600">SR {s.unit_price.toFixed(2)}</td>
              <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-green-600">SR {s.total_cost.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex justify-between items-center flex-wrap gap-3">
        <h2 className="text-2xl font-bold text-slate-900">{t('monthly_summary')}</h2>
        <button
          onClick={() => downloadCSV(activeTab)}
          disabled={activeSummaries.length === 0}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm"
        >
          <Download className="w-4 h-4" />
          Download {activeTab === 'warehouse' ? 'Warehouse' : 'Factory'} CSV
        </button>
      </div>

      {/* Filters */}
      <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-600">
          <Filter className="w-4 h-4" />
          Filters
          <label className="ml-auto flex items-center gap-2 text-xs font-normal text-slate-500 cursor-pointer">
            <input
              type="checkbox"
              checked={!useMonthPicker}
              onChange={(e) => setUseMonthPicker(!e.target.checked)}
              className="w-3.5 h-3.5"
            />
            Use custom date range
          </label>
        </div>

        <div className="flex flex-wrap gap-3 items-center">
          {useMonthPicker ? (
            <>
              <select
                value={month}
                onChange={(e) => setMonth(parseInt(e.target.value))}
                className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white"
              >
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {new Date(2000, i, 1).toLocaleString('default', { month: 'long' })}
                  </option>
                ))}
              </select>
              <select
                value={year}
                onChange={(e) => setYear(parseInt(e.target.value))}
                className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white"
              >
                {Array.from({ length: 5 }, (_, i) => {
                  const y = new Date().getFullYear() - i;
                  return <option key={y} value={y}>{y}</option>;
                })}
              </select>
            </>
          ) : (
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-slate-400" />
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white"
              />
              <span className="text-slate-400">–</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white"
              />
            </div>
          )}

          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-slate-400" />
            <select
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="all">All Branches</option>
              {branches.map(b => (
                <option key={b.id} value={b.id}>
                  {b.code ? `[${b.code}] ` : ''}{b.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Category tabs */}
      <div className="flex border-b border-slate-200">
        <button
          onClick={() => setActiveTab('warehouse')}
          className={`flex items-center gap-2 px-6 py-3 font-medium text-sm transition-colors border-b-2 -mb-px ${
            activeTab === 'warehouse'
              ? 'border-green-500 text-green-700 bg-green-50'
              : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          <span className="w-2 h-2 rounded-full bg-green-500"></span>
          Warehouse Items
          <span className="ml-1 px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-600 text-xs">
            {warehouseSummaries.length}
          </span>
        </button>
        <button
          onClick={() => setActiveTab('factory')}
          className={`flex items-center gap-2 px-6 py-3 font-medium text-sm transition-colors border-b-2 -mb-px ${
            activeTab === 'factory'
              ? 'border-blue-500 text-blue-700 bg-blue-50'
              : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          <span className="w-2 h-2 rounded-full bg-blue-500"></span>
          Factory Items
          <span className="ml-1 px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-600 text-xs">
            {factorySummaries.length}
          </span>
        </button>
      </div>

      {loading ? (
        <div className="text-center py-8">{t('loading')}</div>
      ) : activeSummaries.length === 0 ? (
        <div className="text-center py-12 text-slate-500">{t('no_data')}</div>
      ) : (
        <SummaryTable rows={activeSummaries} />
      )}
    </div>
  );
}
