import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { DollarSign, Save } from 'lucide-react';

interface Item {
  id: string;
  serial: string;
  name: string;
  category: string;
  unit_price: number;
}

export function ItemPricing() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [prices, setPrices] = useState<Record<string, number>>({});

  useEffect(() => {
    loadItems();
  }, []);

  const loadItems = async () => {
    try {
      const { data, error } = await supabase
        .from('items')
        .select('id, serial, name, category, unit_price')
        .order('category, serial');

      if (error) throw error;

      setItems(data || []);
      const priceMap: Record<string, number> = {};
      (data || []).forEach(item => {
        priceMap[item.id] = item.unit_price;
      });
      setPrices(priceMap);
    } catch (error) {
      console.error('Error loading items:', error);
    } finally {
      setLoading(false);
    }
  };

  const handlePriceChange = (itemId: string, value: string) => {
    const numValue = parseFloat(value) || 0;
    setPrices(prev => ({ ...prev, [itemId]: numValue }));
  };

  const handleSave = async (itemId: string) => {
    setSaving(itemId);
    try {
      const { error } = await supabase
        .from('items')
        .update({ unit_price: prices[itemId] })
        .eq('id', itemId);

      if (error) throw error;

      alert('Price updated successfully');
      await loadItems();
    } catch (error) {
      console.error('Error updating price:', error);
      alert('Error updating price');
    } finally {
      setSaving(null);
    }
  };

  const warehouseItems = items.filter(i => i.category === 'warehouse');
  const factoryItems = items.filter(i => i.category === 'factory');

  if (loading) {
    return <div className="text-center py-8">Loading...</div>;
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-2">
        <DollarSign className="w-6 h-6 text-green-600" />
        <h2 className="text-2xl font-bold text-slate-900">Item Pricing Management</h2>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <p className="text-sm text-blue-900">
          <strong>Note:</strong> Set unit prices for items to calculate costs in monthly reports.
          For warehouse items, price is per <strong>sale unit</strong>.
          For factory items, price is per <strong>unit</strong>.
        </p>
      </div>

      {/* Warehouse Items */}
      <div>
        <h3 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-green-500"></span>
          Warehouse Items
        </h3>
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Serial</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Unit Price</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {warehouseItems.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                    No warehouse items found
                  </td>
                </tr>
              ) : (
                warehouseItems.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-sm font-medium text-slate-900">{item.serial}</td>
                    <td className="px-4 py-3 text-sm text-slate-900">{item.name}</td>
                    <td className="px-4 py-3">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={prices[item.id] || ''}
                        onChange={(e) => handlePriceChange(item.id, e.target.value)}
                        className="w-32 px-3 py-1 text-sm border border-slate-300 rounded focus:ring-2 focus:ring-green-500 focus:border-transparent"
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleSave(item.id)}
                        disabled={saving === item.id || prices[item.id] === item.unit_price}
                        className="inline-flex items-center gap-1 px-3 py-1 bg-green-600 text-white text-sm rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        <Save className="w-3 h-3" />
                        {saving === item.id ? 'Saving...' : 'Save'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Factory Items */}
      <div>
        <h3 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-blue-500"></span>
          Factory Items
        </h3>
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Serial</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Unit Price</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {factoryItems.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                    No factory items found
                  </td>
                </tr>
              ) : (
                factoryItems.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-sm font-medium text-slate-900">{item.serial}</td>
                    <td className="px-4 py-3 text-sm text-slate-900">{item.name}</td>
                    <td className="px-4 py-3">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={prices[item.id] || ''}
                        onChange={(e) => handlePriceChange(item.id, e.target.value)}
                        className="w-32 px-3 py-1 text-sm border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleSave(item.id)}
                        disabled={saving === item.id || prices[item.id] === item.unit_price}
                        className="inline-flex items-center gap-1 px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        <Save className="w-3 h-3" />
                        {saving === item.id ? 'Saving...' : 'Save'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
