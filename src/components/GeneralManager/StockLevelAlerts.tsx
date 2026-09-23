import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { AlertTriangle, Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../../contexts/LanguageContext';

interface WarehouseAlert {
  item_id: string;
  current_stock_purchase_units: number;
  item: { serial: string; name: string };
  warehouse_units: {
    purchase_unit: string;
    minimum_stock_purchase_units: number;
  };
}

interface FactoryAlert {
  item_id: string;
  current_stock: number;
  minimum_stock_level: number;
  item: { serial: string; name: string };
}

interface RawMaterialAlert {
  id: string;
  name: string;
  unit: string;
  current_stock: number;
  minimum_stock_level: number;
}

export function StockLevelAlerts() {
  const { t } = useLanguage();
  const [warehouseAlerts, setWarehouseAlerts] = useState<WarehouseAlert[]>([]);
  const [factoryAlerts, setFactoryAlerts] = useState<FactoryAlert[]>([]);
  const [rawMaterialAlerts, setRawMaterialAlerts] = useState<RawMaterialAlert[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAlerts();
  }, []);

  const loadAlerts = async () => {
    try {
      const [warehouseRes, factoryRes, rawMaterialRes] = await Promise.all([
        supabase.rpc('get_warehouse_low_stock_items'),
        supabase.rpc('get_factory_low_stock_items'),
        supabase.rpc('get_raw_material_low_stock_items')
      ]);

      if (!warehouseRes.error) setWarehouseAlerts(warehouseRes.data || []);
      if (!factoryRes.error) setFactoryAlerts(factoryRes.data || []);
      if (!rawMaterialRes.error) setRawMaterialAlerts(rawMaterialRes.data || []);
    } catch (error) {
      console.error('Error loading alerts:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="text-center py-8">Loading...</div>;
  }

  const totalAlerts = warehouseAlerts.length + factoryAlerts.length + rawMaterialAlerts.length;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-xl font-bold text-slate-900">Low Stock Level Alerts</h3>
        {totalAlerts > 0 && (
          <div className="px-3 py-1 bg-red-100 text-red-800 rounded-full text-sm font-medium">
            {totalAlerts} {totalAlerts === 1 ? 'Alert' : 'Alerts'}
          </div>
        )}
      </div>

      {totalAlerts === 0 ? (
        <div className="bg-green-50 border border-green-200 rounded-lg p-8 text-center">
          <div className="text-green-600 mb-2">
            <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-lg font-semibold text-slate-900">All Stock Levels Normal</p>
          <p className="text-sm text-slate-600 mt-1">No items are below minimum stock levels</p>
        </div>
      ) : (
        <div className="space-y-6">
          {warehouseAlerts.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-4 py-3 bg-red-50 border-b border-red-200 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-red-600" />
                <h4 className="font-semibold text-slate-900">Warehouse Items ({warehouseAlerts.length})</h4>
              </div>
              <table className="w-full">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Item</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Current Stock</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Minimum Level</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {warehouseAlerts.map((alert) => (
                    <tr key={alert.item_id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 text-sm font-medium text-slate-900">
                        {alert.item.serial} - {alert.item.name}
                      </td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-1 text-xs font-medium rounded bg-red-100 text-red-800">
                          {Math.round(alert.current_stock_purchase_units)} {alert.warehouse_units.purchase_unit}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">
                        {Math.round(alert.warehouse_units.minimum_stock_purchase_units)} {alert.warehouse_units.purchase_unit}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => window.location.hash = '#/warehouse?tab=purchase_orders&create=true&item=' + alert.item_id}
                          className="px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 transition-colors inline-flex items-center gap-1"
                        >
                          <Plus className="w-3 h-3" />
                          Create PO
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {factoryAlerts.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-4 py-3 bg-red-50 border-b border-red-200 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-red-600" />
                <h4 className="font-semibold text-slate-900">Factory Items ({factoryAlerts.length})</h4>
              </div>
              <table className="w-full">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Item</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Current Stock</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Minimum Level</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {factoryAlerts.map((alert) => (
                    <tr key={alert.item_id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 text-sm font-medium text-slate-900">
                        {alert.item.serial} - {alert.item.name}
                      </td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-1 text-xs font-medium rounded bg-red-100 text-red-800">
                          {Math.round(alert.current_stock)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">
                        {Math.round(alert.minimum_stock_level)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => window.location.hash = '#/factory?tab=production'}
                          className="px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 transition-colors"
                        >
                          Production
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {rawMaterialAlerts.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-4 py-3 bg-red-50 border-b border-red-200 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-red-600" />
                <h4 className="font-semibold text-slate-900">Raw Materials ({rawMaterialAlerts.length})</h4>
              </div>
              <table className="w-full">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Material</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Current Stock</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Minimum Level</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {rawMaterialAlerts.map((alert) => (
                    <tr key={alert.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 text-sm font-medium text-slate-900">
                        {alert.name}
                      </td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-1 text-xs font-medium rounded bg-red-100 text-red-800">
                          {Math.round(alert.current_stock)} {alert.unit}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">
                        {Math.round(alert.minimum_stock_level)} {alert.unit}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => window.location.hash = '#/factory?tab=raw_material_po&create=true&material=' + alert.id}
                          className="px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 transition-colors inline-flex items-center gap-1"
                        >
                          <Plus className="w-3 h-3" />
                          Create PO
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
