import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useLanguage } from '../../contexts/LanguageContext';
import { Package } from 'lucide-react';

interface StockItem {
  item_id: string;
  current_stock_purchase_units: number;
  current_stock_sale_units: number;
  item: {
    serial: string;
    name: string;
  };
  warehouse_units: {
    purchase_unit: string;
    sale_unit: string;
    minimum_stock_purchase_units: number;
  };
}

export function CurrentStock() {
  const { t } = useLanguage();
  const [stock, setStock] = useState<StockItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStock();
  }, []);

  const loadStock = async () => {
    try {
      const { data, error } = await supabase
        .from('warehouse_stock')
        .select(`
          *,
          item:items(serial, name),
          warehouse_units:warehouse_units(purchase_unit, sale_unit, minimum_stock_purchase_units)
        `)
        .order('item(serial)');

      if (error) throw error;
      setStock(data as any || []);
    } catch (error) {
      console.error('Error loading stock:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="text-center py-8">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Package className="w-6 h-6 text-blue-600" />
        <h2 className="text-2xl font-bold text-slate-900">{t('current_warehouse_stock')}</h2>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                {t('item')}
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                {t('purchase_units')}
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                {t('sale_units')}
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                {t('minimum_level')}
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                {t('status')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {stock.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  {t('no_stock_records_found')}
                </td>
              </tr>
            ) : (
              stock.map((item) => {
                const isLow = item.current_stock_purchase_units <= item.warehouse_units.minimum_stock_purchase_units;
                return (
                  <tr key={item.item_id} className={`hover:bg-slate-50 ${isLow ? 'bg-red-50' : ''}`}>
                    <td className="px-4 py-3 text-sm font-medium text-slate-900">
                      {item.item.serial} - {item.item.name}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-900">
                      <span className="font-semibold">{Math.round(item.current_stock_purchase_units)}</span> {item.warehouse_units.purchase_unit}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">
                      {Math.round(item.current_stock_sale_units)} {item.warehouse_units.sale_unit}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">
                      {Math.round(item.warehouse_units.minimum_stock_purchase_units)} {item.warehouse_units.purchase_unit}
                    </td>
                    <td className="px-4 py-3">
                      {isLow ? (
                        <span className="px-2 py-1 text-xs font-medium rounded bg-red-100 text-red-800">
                          Low Stock
                        </span>
                      ) : (
                        <span className="px-2 py-1 text-xs font-medium rounded bg-green-100 text-green-800">
                          Normal
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
