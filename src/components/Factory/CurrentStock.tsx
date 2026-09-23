import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useLanguage } from '../../contexts/LanguageContext';
import { Package, Beef, RefreshCw, Clock } from 'lucide-react';

interface FactoryStockItem {
  item_id: string;
  current_stock: number;
  minimum_stock_level: number;
  item: {
    serial: string;
    name: string;
  };
}

interface RawMaterial {
  id: string;
  name: string;
  unit: string;
  current_stock: number;
  minimum_stock_level: number;
}

export function CurrentStock() {
  const { t } = useLanguage();
  const [factoryStock, setFactoryStock] = useState<FactoryStockItem[]>([]);
  const [rawMaterials, setRawMaterials] = useState<RawMaterial[]>([]);
  const [lastOperation, setLastOperation] = useState<{ operation_date: string; status: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStock();
  }, []);

  const loadStock = async () => {
    try {
      const [factoryRes, rawMaterialsRes, lastOpRes] = await Promise.all([
        supabase
          .from('factory_stock')
          .select('*, item:items(serial, name)')
          .order('item(serial)'),
        supabase
          .from('raw_materials')
          .select('*')
          .order('name'),
        supabase
          .from('daily_factory_operations')
          .select('operation_date, status')
          .eq('status', 'submitted')
          .order('operation_date', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      if (factoryRes.error) throw factoryRes.error;
      if (rawMaterialsRes.error) throw rawMaterialsRes.error;

      setFactoryStock(factoryRes.data as unknown as FactoryStockItem[] || []);
      setRawMaterials(rawMaterialsRes.data || []);
      setLastOperation(lastOpRes.data || null);
    } catch (error) {
      console.error('Error loading stock:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <RefreshCw className="w-5 h-5 text-blue-600 animate-spin mr-2" />
        <span className="text-slate-600">Loading...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Last update banner */}
      <div className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm ${
        lastOperation
          ? 'bg-green-50 border-green-200 text-green-800'
          : 'bg-amber-50 border-amber-200 text-amber-800'
      }`}>
        <Clock className="w-4 h-4 flex-shrink-0" />
        {lastOperation
          ? <>Stock reflects submitted daily operation for <strong>{lastOperation.operation_date}</strong>. Values update each time a daily operation is submitted.</>
          : <>No daily operation has been submitted yet. Stock shown is from manual records.</>
        }
      </div>

      {/* Factory Items */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Package className="w-6 h-6 text-blue-600" />
          <h3 className="text-xl font-bold text-slate-900">{t('factory_items_stock')}</h3>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">{t('item')}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">{t('current_stock')}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">{t('minimum_level')}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">{t('status')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {factoryStock.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-slate-500">{t('no_factory_items_found')}</td>
                </tr>
              ) : (
                factoryStock.map((item) => {
                  const isLow = item.current_stock <= item.minimum_stock_level;
                  return (
                    <tr key={item.item_id} className={`hover:bg-slate-50 ${isLow ? 'bg-red-50' : ''}`}>
                      <td className="px-4 py-3 text-sm font-medium text-slate-900">
                        {item.item.serial} - {item.item.name}
                      </td>
                      <td className="px-4 py-3 text-sm font-semibold text-slate-900">
                        {Math.round(item.current_stock)}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">
                        {Math.round(item.minimum_stock_level)}
                      </td>
                      <td className="px-4 py-3">
                        {isLow
                          ? <span className="px-2 py-1 text-xs font-medium rounded bg-red-100 text-red-800">{t('low_stock')}</span>
                          : <span className="px-2 py-1 text-xs font-medium rounded bg-green-100 text-green-800">Normal</span>
                        }
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Raw Materials */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Beef className="w-6 h-6 text-blue-600" />
          <h3 className="text-xl font-bold text-slate-900">{t('raw_materials_stock')}</h3>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">{t('material')}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">{t('current_stock')}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">{t('minimum_level')}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">{t('status')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {rawMaterials.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-slate-500">No raw materials found</td>
                </tr>
              ) : (
                rawMaterials.map((rm) => {
                  const isLow = rm.current_stock <= rm.minimum_stock_level;
                  return (
                    <tr key={rm.id} className={`hover:bg-slate-50 ${isLow ? 'bg-red-50' : ''}`}>
                      <td className="px-4 py-3 text-sm font-medium text-slate-900">{rm.name}</td>
                      <td className="px-4 py-3 text-sm font-semibold text-slate-900">
                        {Math.round(rm.current_stock)} {rm.unit}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">
                        {Math.round(rm.minimum_stock_level)} {rm.unit}
                      </td>
                      <td className="px-4 py-3">
                        {isLow
                          ? <span className="px-2 py-1 text-xs font-medium rounded bg-red-100 text-red-800">{t('low_stock')}</span>
                          : <span className="px-2 py-1 text-xs font-medium rounded bg-green-100 text-green-800">Normal</span>
                        }
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
