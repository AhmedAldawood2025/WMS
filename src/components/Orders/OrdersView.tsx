import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { useLanguage } from '../../contexts/LanguageContext';
import { useAuth } from '../../contexts/AuthContext';
import { Printer, Eye, Trash2, X, FileStack, CheckCircle, Filter, CheckSquare, Calendar, Building2, AlertTriangle } from 'lucide-react';
import { OrderDetailsModal } from './OrderDetailsModal';
import { printOrder } from '../../utils/printOrder';
import { printOrdersSummary } from '../../utils/printOrdersSummary';

interface Order {
  id: string;
  order_number: string;
  status: string;
  created_at: string;
  approved_at: string | null;
  category: string;
  branch: { name: string; location: string; code?: string } | null;
  customer: { display_name: string } | null;
}

interface Branch {
  id: string;
  name: string;
  code?: string | null;
}

interface OrdersViewProps {
  showFilters?: boolean;
}

export function OrdersView({ showFilters = false }: OrdersViewProps) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<string | null>(null);
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletingSelected, setDeletingSelected] = useState(false);

  // Filters
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'factory' | 'warehouse'>('all');
  const [branchFilter, setBranchFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const { t } = useLanguage();
  const { profile } = useAuth();

  const isAdmin = profile?.role === 'admin';
  const isAccountant = profile?.role === 'accountant';
  const isManager = profile?.role === 'warehouse_manager' || profile?.role === 'factory_manager';
  const showCategoryFilter = isAdmin || showFilters;

  const loadBranches = async () => {
    const { data } = await supabase.from('branches').select('id, name, code').order('name');
    setBranches(data || []);
  };

  const loadOrders = useCallback(async () => {
    try {
      let query = supabase
        .from('orders')
        .select(`
          id, order_number, status, created_at, approved_at, category,
          branch:branches(name, location, code),
          customer:profiles(display_name)
        `)
        .eq('archived', false)
        .order('created_at', { ascending: false });

      if (categoryFilter !== 'all') query = query.eq('category', categoryFilter);
      if (branchFilter !== 'all') query = query.eq('branch_id', branchFilter);
      if (dateFrom || dateTo) {
        // Only include orders that have an approved_at date when filtering by date
        query = query.not('approved_at', 'is', null);
        if (dateFrom) query = query.gte('approved_at', dateFrom);
        if (dateTo) {
          // Add one day and use lt to correctly include the full selected end date
          const nextDay = new Date(dateTo);
          nextDay.setDate(nextDay.getDate() + 1);
          query = query.lt('approved_at', nextDay.toISOString().split('T')[0]);
        }
      }

      const { data, error } = await query;
      if (error) throw error;
      setOrders((data as any) || []);
    } catch (error) {
      console.error('Error loading orders:', error);
    } finally {
      setLoading(false);
    }
  }, [categoryFilter, branchFilter, dateFrom, dateTo]);

  useEffect(() => {
    loadBranches();
  }, []);

  useEffect(() => {
    loadOrders();
    setSelectedOrderIds(new Set());
  }, [loadOrders]);

  const handlePrint = async (orderId: string) => {
    await printOrder(orderId, t, profile?.role);
  };

  const handleDelete = async (orderId: string) => {
    if (!confirm(t('are_you_sure'))) return;
    try {
      const { error } = await supabase.from('orders').delete().eq('id', orderId);
      if (error) throw error;
      alert(t('order_deleted'));
      await loadOrders();
    } catch (error) {
      console.error('Error deleting order:', error);
      alert(t('error'));
    }
  };

  const handleCancel = async (orderId: string) => {
    if (!confirm(t('are_you_sure'))) return;
    try {
      const { error } = await supabase.from('orders').update({ status: 'cancelled' }).eq('id', orderId);
      if (error) throw error;
      alert(t('order_cancelled'));
      await loadOrders();
    } catch (error) {
      console.error('Error cancelling order:', error);
      alert(t('error'));
    }
  };

  const handleMarkAsCompleted = async () => {
    if (selectedOrderIds.size === 0) return;
    if (!confirm(`Mark ${selectedOrderIds.size} order(s) as completed?`)) return;
    try {
      const { error } = await supabase
        .from('orders')
        .update({ status: 'completed' })
        .in('id', Array.from(selectedOrderIds));
      if (error) throw error;
      alert(`${selectedOrderIds.size} order(s) marked as completed`);
      setSelectedOrderIds(new Set());
      await loadOrders();
    } catch (error) {
      console.error('Error marking orders as completed:', error);
      alert(t('error'));
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedOrderIds.size === 0) return;
    setDeletingSelected(true);
    try {
      const ids = Array.from(selectedOrderIds);
      const chunkSize = 10;
      for (let i = 0; i < ids.length; i += chunkSize) {
        const chunk = ids.slice(i, i + chunkSize);
        const { error } = await supabase.from('orders').delete().in('id', chunk);
        if (error) throw error;
      }
      setSelectedOrderIds(new Set());
      setShowDeleteConfirm(false);
      await loadOrders();
    } catch (error) {
      console.error('Error deleting orders:', error);
    } finally {
      setDeletingSelected(false);
    }
  };

  const handleApproveAll = async () => {
    if (selectedOrderIds.size === 0) return;
    if (!confirm(`Approve ${selectedOrderIds.size} order(s)?`)) return;
    try {
      const { error } = await supabase
        .from('orders')
        .update({ status: 'approved' })
        .in('id', Array.from(selectedOrderIds));
      if (error) throw error;
      alert(`${selectedOrderIds.size} order(s) approved`);
      setSelectedOrderIds(new Set());
      await loadOrders();
    } catch (error) {
      console.error('Error approving orders:', error);
      alert(t('error'));
    }
  };

  const handlePrintSummary = async () => {
    if (selectedOrderIds.size === 0) return;
    await printOrdersSummary(Array.from(selectedOrderIds), t);
  };

  const canSelectOrders = () => isAdmin || isManager || isAccountant;

  const canCancelOrder = (order: Order) =>
    isManager && (order.status === 'pending' || order.status === 'approved');

  const handleToggleOrder = (orderId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const newSelected = new Set(selectedOrderIds);
    if (newSelected.has(orderId)) {
      newSelected.delete(orderId);
    } else {
      newSelected.add(orderId);
    }
    setSelectedOrderIds(newSelected);
  };

  const handleToggleAll = () => {
    if (selectedOrderIds.size === filteredSelectableOrders.length && filteredSelectableOrders.length > 0) {
      setSelectedOrderIds(new Set());
    } else {
      setSelectedOrderIds(new Set(filteredSelectableOrders.map(o => o.id)));
    }
  };

  const handleRowClick = (order: Order) => {
    if (!canSelectOrders()) return;
    handleToggleOrder(order.id);
  };

  // For managers: pending/approved; for accountants: approved only; for admin: all
  const filteredSelectableOrders = isManager
    ? orders.filter(o => o.status === 'pending' || o.status === 'approved')
    : isAccountant
    ? orders.filter(o => o.status === 'approved')
    : orders;

  const selectedOrders = orders.filter(o => selectedOrderIds.has(o.id));
  const allSelectedPending = selectedOrders.length > 0 && selectedOrders.every(o => o.status === 'pending');

  const statusBadge = (status: string) => {
    const classes: Record<string, string> = {
      completed: 'bg-green-100 text-green-800',
      cancelled: 'bg-red-100 text-red-800',
      approved: 'bg-blue-100 text-blue-800',
      pending: 'bg-yellow-100 text-yellow-800',
    };
    return `px-2 py-1 rounded-full text-xs font-medium ${classes[status] || 'bg-slate-100 text-slate-600'}`;
  };

  if (loading) return <div className="text-center py-8">{t('loading')}</div>;

  return (
    <div className="space-y-4">
      {/* Header + bulk actions */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <h2 className="text-2xl font-bold text-slate-900">{t('orders')}</h2>

        {canSelectOrders() && selectedOrderIds.size > 0 && (
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={handlePrintSummary}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium text-sm"
            >
              <FileStack className="w-4 h-4" />
              Print Summary ({selectedOrderIds.size})
            </button>
            {(isManager || isAdmin) && allSelectedPending && (
              <button
                onClick={handleApproveAll}
                className="flex items-center gap-2 px-4 py-2 bg-sky-600 text-white rounded-lg hover:bg-sky-700 transition-colors font-medium text-sm"
              >
                <CheckSquare className="w-4 h-4" />
                Approve All ({selectedOrderIds.size})
              </button>
            )}
            {(isAdmin || isAccountant) && (
              <button
                onClick={handleMarkAsCompleted}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium text-sm"
              >
                <CheckCircle className="w-4 h-4" />
                Mark Completed ({selectedOrderIds.size})
              </button>
            )}
            {isAdmin && (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium text-sm"
              >
                <Trash2 className="w-4 h-4" />
                Delete Selected ({selectedOrderIds.size})
              </button>
            )}
          </div>
        )}
      </div>

      {/* Filters */}
      {(showCategoryFilter || showFilters) && (
        <div className="flex items-center gap-3 flex-wrap bg-slate-50 p-3 rounded-lg border border-slate-200">
          <Filter className="w-4 h-4 text-slate-500 flex-shrink-0" />

          <div className="flex items-center gap-2">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value as any)}
              className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
            >
              <option value="all">All Categories</option>
              <option value="factory">Factory</option>
              <option value="warehouse">Warehouse</option>
            </select>
          </div>

          {(isAdmin || showFilters) && (
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-slate-400" />
              <select
                value={branchFilter}
                onChange={(e) => setBranchFilter(e.target.value)}
                className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
              >
                <option value="all">All Branches</option>
                {branches.map(b => (
                  <option key={b.id} value={b.id}>
                    {b.code ? `[${b.code}] ` : ''}{b.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {(isAdmin || showFilters) && (
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-slate-400" />
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                placeholder="From"
              />
              <span className="text-slate-400 text-sm">–</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                placeholder="To"
              />
              {(dateFrom || dateTo || branchFilter !== 'all' || categoryFilter !== 'all') && (
                <button
                  onClick={() => { setDateFrom(''); setDateTo(''); setBranchFilter('all'); setCategoryFilter('all'); }}
                  className="px-2 py-1.5 text-xs text-slate-600 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {orders.length === 0 ? (
        <div className="text-center py-12 text-slate-500">{t('no_data')}</div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {canSelectOrders() && (
                  <th className="px-4 py-3 text-left w-10">
                    <input
                      type="checkbox"
                      checked={
                        filteredSelectableOrders.length > 0 &&
                        filteredSelectableOrders.every(o => selectedOrderIds.has(o.id))
                      }
                      onChange={handleToggleAll}
                      className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500"
                    />
                  </th>
                )}
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">{t('order_number')}</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">{t('customer')}</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">{t('branch')}</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Category</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">{t('status')}</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Order Date</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">{t('actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {orders.map((order) => {
                const isSelected = selectedOrderIds.has(order.id);
                const isSelectable = canSelectOrders() && (
                  isAdmin ||
                  (isAccountant && order.status === 'approved') ||
                  (!isAccountant && (order.status === 'pending' || order.status === 'approved'))
                );
                return (
                  <tr
                    key={order.id}
                    onClick={() => isSelectable ? handleRowClick(order) : undefined}
                    className={`transition-colors ${
                      isSelectable ? 'cursor-pointer' : ''
                    } ${isSelected ? 'bg-blue-50 hover:bg-blue-100' : 'hover:bg-slate-50'}`}
                  >
                    {canSelectOrders() && (
                      <td className="px-4 py-4" onClick={(e) => e.stopPropagation()}>
                        {isSelectable && (
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(e) => handleToggleOrder(order.id, e as any)}
                            className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500"
                          />
                        )}
                      </td>
                    )}
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
                        order.category === 'factory'
                          ? 'bg-blue-100 text-blue-800'
                          : 'bg-green-100 text-green-800'
                      }`}>
                        {order.category}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <span className={statusBadge(order.status)}>{t(order.status)}</span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600">
                      {order.approved_at
                        ? new Date(order.approved_at).toLocaleDateString()
                        : <span className="text-slate-400 italic">Pending</span>}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm" onClick={(e) => e.stopPropagation()}>
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
                        {isAdmin && (
                          <button
                            onClick={() => handleDelete(order.id)}
                            className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            title={t('delete')}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                        {canCancelOrder(order) && (
                          <button
                            onClick={() => handleCancel(order.id)}
                            className="p-2 text-orange-600 hover:bg-orange-50 rounded-lg transition-colors"
                            title={t('cancel_order')}
                          >
                            <X className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selectedOrder && (
        <OrderDetailsModal
          orderId={selectedOrder}
          onClose={() => setSelectedOrder(null)}
          onSave={loadOrders}
        />
      )}

      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900">Delete Orders</h3>
                <p className="text-sm text-slate-600 mt-1">
                  Are you sure you want to permanently delete <strong>{selectedOrderIds.size} order{selectedOrderIds.size !== 1 ? 's' : ''}</strong>? This action cannot be undone.
                </p>
              </div>
            </div>
            <div className="flex gap-3 justify-end pt-2">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deletingSelected}
                className="px-4 py-2 text-sm text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteSelected}
                disabled={deletingSelected}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors font-medium"
              >
                {deletingSelected ? 'Deleting...' : `Delete ${selectedOrderIds.size} Order${selectedOrderIds.size !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
