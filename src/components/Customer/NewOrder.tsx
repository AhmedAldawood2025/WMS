import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useLanguage } from '../../contexts/LanguageContext';
import { useAuth } from '../../contexts/AuthContext';
import { CheckCircle, Image, X } from 'lucide-react';

interface Branch {
  id: string;
  name: string;
  location: string;
  code?: string | null;
}

interface Item {
  id: string;
  serial: string;
  name: string;
  category: string;
  stock_level_required: boolean;
  picture_url?: string | null;
}

interface NewOrderProps {
  /** When true, loads all branches including internal-only ones */
  showAllBranches?: boolean;
  /** When true, success screen shows a reset button instead of signing out */
  managerMode?: boolean;
}

export function NewOrder({ showAllBranches = false, managerMode = false }: NewOrderProps = {}) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [selectedBranch, setSelectedBranch] = useState('');
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [stockLevels, setStockLevels] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [previewPicture, setPreviewPicture] = useState<string | null>(null);
  const { t } = useLanguage();
  const { user, signOut } = useAuth();

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [branchesRes, itemsRes] = await Promise.all([
        showAllBranches
          ? supabase.from('branches').select('*').order('name')
          : supabase.from('branches').select('*').eq('internal_only', false).order('name'),
        supabase.from('items').select('id, serial, name, category, stock_level_required, picture_url').order('category').order('order_index', { ascending: true }),
      ]);
      if (branchesRes.error) throw branchesRes.error;
      if (itemsRes.error) throw itemsRes.error;
      setBranches(branchesRes.data || []);
      setItems(itemsRes.data || []);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const warehouseItems = items.filter(item => item.category === 'warehouse');
  const factoryItems = items.filter(item => item.category === 'factory');

  const handleQuantityChange = (itemId: string, value: string) => {
    const numValue = parseInt(value) || 0;
    setQuantities(prev => ({ ...prev, [itemId]: numValue > 0 ? numValue : 0 }));
  };

  const handleStockLevelChange = (itemId: string, value: string) => {
    const numValue = parseInt(value) || 0;
    setStockLevels(prev => ({ ...prev, [itemId]: numValue >= 0 ? numValue : 0 }));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const inputs = Array.from(document.querySelectorAll('input[type="number"]'));
      const currentIndex = inputs.indexOf(e.currentTarget);
      const nextInput = inputs[currentIndex + 1] as HTMLInputElement;
      if (nextInput) { nextInput.focus(); nextInput.select(); }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBranch) return;

    const itemsMap = new Map(items.map(item => [item.id, item]));

    const orderItems = Object.entries(quantities)
      .map(([itemId, quantity]) => {
        const item = itemsMap.get(itemId);
        const stock_level = stockLevels[itemId];
        return { itemId, quantity: quantity || 0, stock_level: stock_level !== undefined ? stock_level : null, item };
      })
      .filter(orderItem => {
        if (orderItem.quantity > 0) return true;
        if (orderItem.item?.stock_level_required && orderItem.stock_level !== null && orderItem.stock_level !== undefined) return true;
        return false;
      });

    if (orderItems.length === 0) {
      alert('Please add at least one item with quantity or stock level');
      return;
    }

    setSubmitting(true);
    try {
      const warehouseOrderItems = orderItems.filter(oi => oi.item?.category === 'warehouse');
      const factoryOrderItems = orderItems.filter(oi => oi.item?.category === 'factory');

      if (warehouseOrderItems.length > 0) {
        const { data: warehouseOrder, error: warehouseOrderError } = await supabase
          .from('orders')
          .insert([{ branch_id: selectedBranch, customer_id: user?.id || '', status: 'pending', category: 'warehouse' }])
          .select()
          .single();
        if (warehouseOrderError) throw warehouseOrderError;

        const { error } = await supabase.from('order_items').insert(
          warehouseOrderItems.map(({ itemId, quantity, stock_level }) => ({
            order_id: warehouseOrder.id, item_id: itemId, quantity, stock_level,
          }))
        );
        if (error) throw error;
      }

      if (factoryOrderItems.length > 0) {
        const { data: factoryOrder, error: factoryOrderError } = await supabase
          .from('orders')
          .insert([{ branch_id: selectedBranch, customer_id: user?.id || '', status: 'pending', category: 'factory' }])
          .select()
          .single();
        if (factoryOrderError) throw factoryOrderError;

        const { error } = await supabase.from('order_items').insert(
          factoryOrderItems.map(({ itemId, quantity, stock_level }) => ({
            order_id: factoryOrder.id, item_id: itemId, quantity, stock_level,
          }))
        );
        if (error) throw error;
      }

      setSuccess(true);
      if (!managerMode) {
        setTimeout(async () => { await signOut(); }, 2500);
      }
    } catch (error) {
      console.error('Error submitting order:', error);
      alert(t('error'));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="text-center py-8">{t('loading')}</div>;

  if (success) {
    return (
      <div className="flex flex-col items-center justify-center py-16 space-y-6">
        <CheckCircle className="w-24 h-24 text-green-500" />
        <div className="text-center">
          <h2 className="text-2xl font-bold text-slate-900 mb-2">{t('order_submitted')}</h2>
          {managerMode ? (
            <button
              onClick={() => {
                setSuccess(false);
                setSelectedBranch('');
                setQuantities({});
                setStockLevels({});
              }}
              className="mt-4 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
            >
              Create Another Order
            </button>
          ) : (
            <p className="text-slate-600">{t('redirecting')}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">{t('select_branch')}</label>
          <select
            value={selectedBranch}
            onChange={(e) => setSelectedBranch(e.target.value)}
            required
            className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="">{t('select_branch')}</option>
            {branches.map(branch => (
              <option key={branch.id} value={branch.id}>
                {branch.code ? `[${branch.code}] ` : ''}{branch.name} - {branch.location}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-6">
          {/* Warehouse items */}
          <div>
            <h3 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500"></span>
              {t('warehouse_items')}
            </h3>
            <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-2 py-3 text-left text-xs font-medium text-slate-500 uppercase">{t('serial')}</th>
                    <th className="px-2 py-3 text-left text-xs font-medium text-slate-500 uppercase">{t('name')}</th>
                    <th className="px-2 py-3 text-center text-xs font-medium text-slate-500 uppercase w-16">{t('quantity')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {warehouseItems.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50">
                      <td className="px-2 py-3 text-xs font-medium text-slate-900 whitespace-nowrap font-mono">
                        {item.serial}
                      </td>
                      <td className="px-2 py-3 text-xs text-slate-900">
                        <div className="flex items-center gap-1.5">
                          <span>{item.name}</span>
                          {item.picture_url && (
                            <button
                              type="button"
                              onClick={() => setPreviewPicture(item.picture_url!)}
                              className="flex-shrink-0 p-0.5 text-slate-400 hover:text-blue-500 transition-colors"
                              title="View picture"
                            >
                              <Image className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-3 text-center">
                        <input
                          type="number"
                          min="0"
                          max="99"
                          value={quantities[item.id] || ''}
                          onChange={(e) => handleQuantityChange(item.id, e.target.value)}
                          onKeyDown={handleKeyDown}
                          className="w-14 px-2 py-2 text-center border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Factory items */}
          <div>
            <h3 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-blue-500"></span>
              {t('factory_items')}
            </h3>
            <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-2 py-3 text-left text-xs font-medium text-slate-500 uppercase">{t('serial')}</th>
                    <th className="px-2 py-3 text-left text-xs font-medium text-slate-500 uppercase">{t('name')}</th>
                    <th className="px-2 py-3 text-center text-xs font-medium text-slate-500 uppercase w-16">{t('quantity')}</th>
                    <th className="px-2 py-3 text-center text-xs font-medium text-slate-500 uppercase w-16">{t('current_stock_level')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {factoryItems.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50">
                      <td className="px-2 py-3 text-xs font-medium text-slate-900 whitespace-nowrap font-mono">
                        {item.serial}
                      </td>
                      <td className="px-2 py-3 text-xs text-slate-900">
                        <div className="flex items-center gap-1.5">
                          <span>{item.name}</span>
                          {item.stock_level_required && (
                            <span className="text-amber-600 font-medium">*</span>
                          )}
                          {item.picture_url && (
                            <button
                              type="button"
                              onClick={() => setPreviewPicture(item.picture_url!)}
                              className="flex-shrink-0 p-0.5 text-slate-400 hover:text-blue-500 transition-colors"
                              title="View picture"
                            >
                              <Image className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-3 text-center">
                        <input
                          type="number"
                          min="0"
                          max="99"
                          value={quantities[item.id] || ''}
                          onChange={(e) => handleQuantityChange(item.id, e.target.value)}
                          onKeyDown={handleKeyDown}
                          className="w-14 px-2 py-2 text-center border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      </td>
                      <td className="px-2 py-3 text-center">
                        {item.stock_level_required ? (
                          <input
                            type="number"
                            min="0"
                            max="99"
                            value={stockLevels[item.id] ?? ''}
                            onChange={(e) => handleStockLevelChange(item.id, e.target.value)}
                            onKeyDown={handleKeyDown}
                            required={item.stock_level_required && (quantities[item.id] || 0) > 0}
                            className="w-14 px-2 py-2 text-center border-2 border-amber-400 bg-amber-50 rounded focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                          />
                        ) : (
                          <span className="text-slate-400 text-xs">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={submitting || !selectedBranch}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
          >
            {submitting ? t('loading') : t('submit')}
          </button>
        </div>
      </form>

      {/* Picture popup overlay */}
      {previewPicture && (
        <div
          className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4"
          onClick={() => setPreviewPicture(null)}
        >
          <div className="relative max-w-lg w-full" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setPreviewPicture(null)}
              className="absolute -top-3 -right-3 bg-white rounded-full p-1 shadow-lg text-slate-600 hover:text-red-600 transition-colors z-10"
            >
              <X className="w-5 h-5" />
            </button>
            <img
              src={previewPicture}
              alt="Item picture"
              className="w-full rounded-xl shadow-2xl"
              onClick={() => setPreviewPicture(null)}
            />
          </div>
        </div>
      )}
    </>
  );
}
