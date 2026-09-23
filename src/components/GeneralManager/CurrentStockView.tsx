import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { Package, Layers, Beef } from 'lucide-react';

interface WarehouseStockItem {
  item_id: string;
  current_stock_purchase_units: number;
  current_stock_sale_units: number;
  item: { serial: string; name: string };
  warehouse_units: {
    purchase_unit: string;
    sale_unit: string;
    minimum_stock_purchase_units: number;
  };
}

interface FactoryStockItem {
  item_id: string;
  current_stock: number;
  minimum_stock_level: number;
  item: { serial: string; name: string };
}

interface RawMaterial {
  id: string;
  name: string;
  unit: string;
  current_stock: number;
  minimum_stock_level: number;
}

export function CurrentStockView() {
  const [warehouseStock, setWarehouseStock] = useState<WarehouseStockItem[]>([]);
  const [factoryStock, setFactoryStock] = useState<FactoryStockItem[]>([]);
  const [rawMaterials, setRawMaterials] = useState<RawMaterial[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStock();
  }, []);

  const loadStock = async () => {
    try {
      const [warehouseRes, factoryRes, rawMaterialsRes] = await Promise.all([
        supabase
          .from('warehouse_stock')
          .select(`
            *,
            item:items(serial, name),
            warehouse_units:warehouse_units(purchase_unit, sale_unit, minimum_stock_purchase_units)
          `)
          .order('item(serial)'),

        supabase
          .from('factory_stock')
          .select(`
            *,
            item:items(serial, name)
          `)
          .order('item(serial)'),

        supabase
          .from('raw_materials')
          .select('*')
          .order('name')
      ]);

      if (warehouseRes.error) throw warehouseRes.error;
      if (factoryRes.error) throw factoryRes.error;
      if (rawMaterialsRes.error) throw rawMaterialsRes.error;

      setWarehouseStock(warehouseRes.data as any || []);
      setFactoryStock(factoryRes.data as any || []);
      setRawMaterials(rawMaterialsRes.data || []);
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
    <div className="space-y-8">
      {/* Warehouse Stock */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Package className="w-6 h-6 text-green-600" />
          <h3 className="text-xl font-bold text-slate-900">Warehouse Items</h3>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Item</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Purchase Units</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Sale Units</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Min Level</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {warehouseStock.map((item) => {
                const isLow = item.current_stock_purchase_units <= item.warehouse_units.minimum_stock_purchase_units;
                return (
                  <tr key={item.item_id} className={`hover:bg-slate-50 ${isLow ? 'bg-red-50' : ''}`}>
                    <td className="px-4 py-3 text-sm font-medium text-slate-900">
                      {item.item.serial} - {item.item.name}
                    </td>
                    <td className="px-4 py-3 text-sm font-semibold text-slate-900">
                      {Math.round(item.current_stock_purchase_units)} {item.warehouse_units.purchase_unit}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">
                      {Math.round(item.current_stock_sale_units)} {item.warehouse_units.sale_unit}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">
                      {Math.round(item.warehouse_units.minimum_stock_purchase_units)} {item.warehouse_units.purchase_unit}
                    </td>
                    <td className="px-4 py-3">
                      {isLow ? (
                        <span className="px-2 py-1 text-xs font-medium rounded bg-red-100 text-red-800">Low</span>
                      ) : (
                        <span className="px-2 py-1 text-xs font-medium rounded bg-green-100 text-green-800">Normal</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Factory Stock */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Layers className="w-6 h-6 text-blue-600" />
          <h3 className="text-xl font-bold text-slate-900">Factory Items</h3>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Item</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Current Stock</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Min Level</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {factoryStock.map((item) => {
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
                      {isLow ? (
                        <span className="px-2 py-1 text-xs font-medium rounded bg-red-100 text-red-800">Low</span>
                      ) : (
                        <span className="px-2 py-1 text-xs font-medium rounded bg-green-100 text-green-800">Normal</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Raw Materials */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Beef className="w-6 h-6 text-purple-600" />
          <h3 className="text-xl font-bold text-slate-900">Raw Materials</h3>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Material</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Current Stock</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Min Level</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {rawMaterials.map((rm) => {
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
                      {isLow ? (
                        <span className="px-2 py-1 text-xs font-medium rounded bg-red-100 text-red-800">Low</span>
                      ) : (
                        <span className="px-2 py-1 text-xs font-medium rounded bg-green-100 text-green-800">Normal</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
