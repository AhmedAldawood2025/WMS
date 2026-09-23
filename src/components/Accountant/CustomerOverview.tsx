import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useLanguage } from '../../contexts/LanguageContext';
import { Download, AlertTriangle } from 'lucide-react';

interface BranchTotal {
  branch_name: string;
  order_count: number;
  total_cost: number;
}

export function CustomerOverview() {
  const [branchTotals, setBranchTotals] = useState<BranchTotal[]>([]);
  const [allPricesZero, setAllPricesZero] = useState(false);
  const [loading, setLoading] = useState(false);
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const { t } = useLanguage();

  useEffect(() => {
    loadOverview();
  }, [month, year]);

  const loadOverview = async () => {
    setLoading(true);
    try {
      const startDate = new Date(Date.UTC(year, month - 1, 1)).toISOString();
      const endDate = new Date(Date.UTC(year, month, 1)).toISOString();

      const { data: orders, error: ordersError } = await supabase
        .from('orders')
        .select(`
          id,
          branch:branches(name),
          order_items(
            quantity,
            item:items(unit_price)
          )
        `)
        .eq('status', 'completed')
        .gte('approved_at', startDate)
        .lt('approved_at', endDate);

      if (ordersError) throw ordersError;

      const branchMap: Record<string, { order_count: number; total_cost: number }> = {};
      let anyPriceSet = false;

      (orders as any[]).forEach(order => {
        const branchName = order.branch?.name || 'Unknown';
        if (!branchMap[branchName]) {
          branchMap[branchName] = { order_count: 0, total_cost: 0 };
        }
        branchMap[branchName].order_count += 1;

        order.order_items?.forEach((oi: any) => {
          const price = oi.item?.unit_price || 0;
          if (price > 0) anyPriceSet = true;
          branchMap[branchName].total_cost += oi.quantity * price;
        });
      });

      const totals = Object.entries(branchMap)
        .map(([branch_name, data]) => ({ branch_name, ...data }))
        .sort((a, b) => a.branch_name.localeCompare(b.branch_name));

      setBranchTotals(totals);
      setAllPricesZero(totals.length > 0 && !anyPriceSet);
    } catch (error) {
      console.error('Error loading overview:', error);
    } finally {
      setLoading(false);
    }
  };

  const downloadCSV = () => {
    const headers = ['Branch', 'Completed Orders', 'Total Cost'];
    const rows = branchTotals.map(bt => [
      bt.branch_name,
      bt.order_count.toString(),
      bt.total_cost.toFixed(2),
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(',')),
    ].join('\n');

    const BOM = '\uFEFF';
    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `customer_overview_${year}_${month.toString().padStart(2, '0')}.csv`;
    link.click();
  };

  const grandTotal = branchTotals.reduce((sum, bt) => sum + bt.total_cost, 0);
  const grandOrders = branchTotals.reduce((sum, bt) => sum + bt.order_count, 0);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-slate-900">Customer Overview by Branch</h2>
        <div className="flex items-center gap-4">
          <select
            value={month}
            onChange={(e) => setMonth(parseInt(e.target.value))}
            className="px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
            className="px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            {Array.from({ length: 5 }, (_, i) => {
              const y = new Date().getFullYear() - i;
              return <option key={y} value={y}>{y}</option>;
            })}
          </select>
          <button
            onClick={downloadCSV}
            disabled={branchTotals.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Download className="w-4 h-4" />
            Download CSV
          </button>
        </div>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <p className="text-sm text-blue-900">
          This report shows completed orders per branch for the selected month (based on completion date).
          Make sure item prices are set in the <strong>Item Pricing</strong> tab for accurate cost calculations.
        </p>
      </div>

      {allPricesZero && (
        <div className="bg-amber-50 border border-amber-300 rounded-lg p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-800">Item prices are not set</p>
            <p className="text-sm text-amber-700 mt-0.5">
              Orders are being recorded correctly but all item prices are SR 0.00. Go to the <strong>Item Pricing</strong> tab to set prices — costs will then calculate automatically.
            </p>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-8">{t('loading')}</div>
      ) : branchTotals.length === 0 ? (
        <div className="text-center py-12 text-slate-500">
          No completed orders found for the selected period
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Branch
                </th>
                <th className="px-6 py-3 text-center text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Completed Orders
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Total Cost
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {branchTotals.map((bt, idx) => (
                <tr key={idx} className="hover:bg-slate-50">
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-900">
                    {bt.branch_name}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-700 text-center">
                    {bt.order_count}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-slate-900 text-right">
                    SR {bt.total_cost.toFixed(2)}
                  </td>
                </tr>
              ))}
              <tr className="bg-slate-50 font-bold">
                <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-900">
                  GRAND TOTAL
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-700 text-center">
                  {grandOrders}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-lg text-blue-600 text-right">
                  SR {grandTotal.toFixed(2)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
