import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { useLanguage } from '../../contexts/LanguageContext';
import { Eye, Printer, Filter, Building2, Calendar } from 'lucide-react';
import { OrderDetailsModal } from './OrderDetailsModal';
import { printOrder } from '../../utils/printOrder';
import { useAuth } from '../../contexts/AuthContext';

interface ArchivedOrder {
  id: string;
  order_number: string;
  status: string;
  created_at: string;
  approved_at: string | null;
  completed_at: string | null;
  category: string;
  branch: { name: string; location: string; code?: string } | null;
  customer: { display_name: string } | null;
}

interface Branch {
  id: string;
  name: string;
  code?: string | null;
}

export function OrdersHistory() {
  const [orders, setOrders] = useState<ArchivedOrder[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<string | null>(null);

  const [categoryFilter, setCategoryFilter] = useState<'all' | 'factory' | 'warehouse'>('all');
  const [branchFilter, setBranchFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const { t } = useLanguage();
  const { profile } = useAuth();

  useEffect(() => {
    supabase.from('branches').select('id, name, code').order('name').then(({ data }) => {
      setBranches(data || []);
    });
  }, []);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('orders')
        .select(`
          id, order_number, status, created_at, approved_at, completed_at, category,
          branch:branches(name, location, code),
          customer:profiles(display_name)
        `)
        .eq('archived', true)
        .order('completed_at', { ascending: false });

      if (categoryFilter !== 'all') query = query.eq('category', categoryFilter);
      if (branchFilter !== 'all') query = query.eq('branch_id', branchFilter);
      if (dateFrom) query = query.gte('approved_at', dateFrom);
      if (dateTo) query = query.lte('approved_at', dateTo + 'T23:59:59');

      const { data, error } = await query;
      if (error) throw error;
      setOrders((data as any) || []);
    } catch (error) {
      console.error('Error loading order history:', error);
    } finally {
      setLoading(false);
    }
  }, [categoryFilter, branchFilter, dateFrom, dateTo]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  const handlePrint = async (orderId: string) => {
    await printOrder(orderId, t, profile?.role);
  };

  const statusBadge = (status: string) => {
    const classes: Record<string, string> = {
      completed: 'bg-green-100 text-green-800',
      cancelled: 'bg-red-100 text-red-800',
      approved: 'bg-blue-100 text-blue-800',
      pending: 'bg-yellow-100 text-yellow-800',
    };
    return `px-2 py-1 rounded-full text-xs font-medium ${classes[status] || 'bg-slate-100 text-slate-600'}`;
  };

  const hasFilters = dateFrom || dateTo || branchFilter !== 'all' || categoryFilter !== 'all';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Orders History</h2>
          <p className="text-sm text-slate-500 mt-0.5">Completed orders archived after 24 hours</p>
        </div>
        <span className="px-3 py-1 bg-slate-100 text-slate-600 text-sm rounded-full font-medium">
          {orders.length} order{orders.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap bg-slate-50 p-3 rounded-lg border border-slate-200">
        <Filter className="w-4 h-4 text-slate-500 flex-shrink-0" />

        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value as any)}
          className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white"
        >
          <option value="all">All Categories</option>
          <option value="factory">Factory</option>
          <option value="warehouse">Warehouse</option>
        </select>

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

        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-slate-400" />
          <span className="text-xs text-slate-500">Order date:</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white"
          />
          <span className="text-slate-400 text-sm">–</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white"
          />
        </div>

        {hasFilters && (
          <button
            onClick={() => { setDateFrom(''); setDateTo(''); setBranchFilter('all'); setCategoryFilter('all'); }}
            className="px-2 py-1.5 text-xs text-slate-600 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-center py-8 text-slate-500">{t('loading')}</div>
      ) : orders.length === 0 ? (
        <div className="text-center py-12 text-slate-500">No archived orders found</div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">{t('order_number')}</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">{t('customer')}</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">{t('branch')}</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Category</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">{t('status')}</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Order Date</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Completed</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">{t('actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {orders.map((order) => (
                <tr key={order.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-900">
                    {order.order_number}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600">
                    {order.customer?.display_name || 'N/A'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600">
                    {(order.branch as any)?.code && (
                      <span className="text-xs font-semibold text-blue-600 mr-1">[{(order.branch as any).code}]</span>
                    )}
                    {order.branch?.name || 'N/A'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      order.category === 'factory' ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800'
                    }`}>
                      {order.category}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    <span className={statusBadge(order.status)}>{t(order.status)}</span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600">
                    {order.approved_at ? new Date(order.approved_at).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600">
                    {order.completed_at ? new Date(order.completed_at).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    <div className="flex gap-2">
                      <button
                        onClick={() => setSelectedOrder(order.id)}
                        className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        title={t('view_details')}
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handlePrint(order.id)}
                        className="p-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                        title={t('print')}
                      >
                        <Printer className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedOrder && (
        <OrderDetailsModal
          orderId={selectedOrder}
          onClose={() => setSelectedOrder(null)}
        />
      )}
    </div>
  );
}
