import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { Plus, AlertTriangle } from 'lucide-react';

interface Item {
  id: string;
  serial: string;
  name: string;
}

interface WarehouseStock {
  item_id: string;
  current_stock_purchase_units: number;
  current_stock_sale_units: number;
  item: Item;
  warehouse_units: {
    purchase_unit: string;
    sale_unit: string;
    purchase_to_sale_ratio: number;
  };
}

interface StockAdjustment {
  id: string;
  item_id: string;
  adjustment_type: string;
  old_purchase_units: number;
  new_purchase_units: number;
  difference_purchase_units: number;
  reason: string;
  created_at: string;
  created_by_profile: {
    display_name: string;
  };
}

export function StockAdjustments() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [warehouseStock, setWarehouseStock] = useState<WarehouseStock[]>([]);
  const [adjustments, setAdjustments] = useState<StockAdjustment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState('');
  const [newStockLevel, setNewStockLevel] = useState(0);
  const [reason, setReason] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [stockRes, adjustmentsRes] = await Promise.all([
        supabase
          .from('warehouse_stock')
          .select(`
            *,
            item:items(id, serial, name),
            warehouse_units:warehouse_units(purchase_unit, sale_unit, purchase_to_sale_ratio)
          `)
          .order('item(serial)'),

        supabase
          .from('stock_adjustments')
          .select(`
            *,
            created_by_profile:profiles(display_name)
          `)
          .eq('adjustment_type', 'warehouse')
          .order('created_at', { ascending: false })
          .limit(50)
      ]);

      if (stockRes.error) throw stockRes.error;
      if (adjustmentsRes.error) throw adjustmentsRes.error;

      setWarehouseStock(stockRes.data as any || []);
      setAdjustments(adjustmentsRes.data as any || []);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedItemId || !reason.trim()) {
      alert('Please select an item and provide a reason');
      return;
    }

    try {
      const stockItem = warehouseStock.find(s => s.item_id === selectedItemId);
      if (!stockItem) {
        alert('Invalid item selected');
        return;
      }

      const { error } = await supabase
        .from('stock_adjustments')
        .insert([{
          item_id: selectedItemId,
          adjustment_type: 'warehouse',
          old_purchase_units: stockItem.current_stock_purchase_units,
          new_purchase_units: newStockLevel,
          difference_purchase_units: newStockLevel - stockItem.current_stock_purchase_units,
          reason,
          created_by: user?.id,
        }]);

      if (error) throw error;

      alert('Stock adjustment recorded successfully');
      setShowForm(false);
      setSelectedItemId('');
      setNewStockLevel(0);
      setReason('');
      loadData();
    } catch (error) {
      console.error('Error creating adjustment:', error);
      alert('Error recording stock adjustment');
    }
  };

  if (loading) {
    return <div className="text-center py-8">Loading...</div>;
  }

  const selectedStock = selectedItemId ? warehouseStock.find(s => s.item_id === selectedItemId) : null;
  const difference = selectedStock ? newStockLevel - selectedStock.current_stock_purchase_units : 0;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-slate-900">{t('stock_adjustments')}</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          {t('new_adjustment')}
        </button>
      </div>

      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-yellow-800">
          <p className="font-semibold mb-1">{t('important')}:</p>
          <p>{t('adjustment_warning_full')}</p>
        </div>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
          <h3 className="text-lg font-semibold text-slate-900">Record Stock Adjustment</h3>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Item *
              </label>
              <select
                value={selectedItemId}
                onChange={(e) => {
                  setSelectedItemId(e.target.value);
                  const stock = warehouseStock.find(s => s.item_id === e.target.value);
                  if (stock) {
                    setNewStockLevel(stock.current_stock_purchase_units);
                  }
                }}
                required
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
              >
                <option value="">Select item...</option>
                {warehouseStock.map(stock => (
                  <option key={stock.item_id} value={stock.item_id}>
                    {stock.item.serial} - {stock.item.name} (Current: {Math.round(stock.current_stock_purchase_units)} {stock.warehouse_units.purchase_unit})
                  </option>
                ))}
              </select>
            </div>

            {selectedStock && (
              <div className="bg-slate-50 p-4 rounded-lg space-y-2">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-slate-600">Current Stock:</span>
                    <p className="font-medium text-lg">
                      {Math.round(selectedStock.current_stock_purchase_units)} {selectedStock.warehouse_units.purchase_unit}
                    </p>
                    <p className="text-xs text-slate-500">
                      ({Math.round(selectedStock.current_stock_sale_units)} {selectedStock.warehouse_units.sale_unit})
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-600">New Stock Level:</span>
                    <input
                      type="number"
                      step="1"
                      value={newStockLevel}
                      onChange={(e) => setNewStockLevel(parseFloat(e.target.value) || 0)}
                      required
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent mt-1"
                    />
                  </div>
                </div>

                <div className={`p-3 rounded ${difference >= 0 ? 'bg-green-50' : 'bg-red-50'}`}>
                  <span className="text-sm font-medium">
                    Difference: {difference >= 0 ? '+' : ''}{Math.round(difference)} {selectedStock.warehouse_units.purchase_unit}
                  </span>
                  <p className="text-xs text-slate-600 mt-1">
                    {difference >= 0 ? 'Stock will increase' : 'Stock will decrease'}
                  </p>
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Reason for Adjustment *
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                required
                rows={3}
                placeholder="Explain why this adjustment is needed (e.g., physical count discrepancy, damaged goods, etc.)"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t pt-4">
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setSelectedItemId('');
                setNewStockLevel(0);
                setReason('');
              }}
              className="px-4 py-2 text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors"
            >
              Record Adjustment
            </button>
          </div>
        </form>
      )}

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
          <h3 className="text-lg font-semibold text-slate-900">{t('adjustment_history')}</h3>
        </div>
        <table className="w-full">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                {t('date')}
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                {t('item')}
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                {t('old_stock')}
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                {t('new_stock')}
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                {t('difference')}
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                {t('reason')}
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                {t('by')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {adjustments.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                  {t('no_adjustments_recorded')}
                </td>
              </tr>
            ) : (
              adjustments.map((adj) => (
                <tr key={adj.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-sm text-slate-600">
                    {new Date(adj.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-900">
                    Item {adj.item_id.substring(0, 8)}...
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">
                    {Math.round(adj.old_purchase_units)}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">
                    {Math.round(adj.new_purchase_units)}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 text-xs font-medium rounded ${
                      adj.difference_purchase_units >= 0
                        ? 'bg-green-100 text-green-800'
                        : 'bg-red-100 text-red-800'
                    }`}>
                      {adj.difference_purchase_units >= 0 ? '+' : ''}{Math.round(adj.difference_purchase_units)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600 max-w-xs truncate">
                    {adj.reason}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">
                    {adj.created_by_profile?.display_name || 'Unknown'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
