import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { Plus, Eye, Check, X } from 'lucide-react';

interface Supplier {
  id: string;
  name: string;
}

interface Item {
  id: string;
  serial: string;
  name: string;
  category: string;
}

interface WarehouseUnit {
  purchase_unit: string;
  sale_unit: string;
  purchase_to_sale_ratio: number;
}

interface POItem {
  item_id: string;
  quantity: number;
  unit_price: number;
  item?: Item;
  unit?: WarehouseUnit;
}

interface PurchaseOrder {
  id: string;
  po_number: string;
  status: string;
  subtotal: number;
  vat_rate: number;
  vat_amount: number;
  total: number;
  created_at: string;
  supplier: Supplier;
  warehouse_po_items: any[];
}

export function WarehousePurchaseOrders() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [warehouseUnits, setWarehouseUnits] = useState<Record<string, WarehouseUnit>>({});
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [selectedPO, setSelectedPO] = useState<PurchaseOrder | null>(null);

  const [formData, setFormData] = useState({
    supplier_id: '',
    vat_rate: 15,
    notes: '',
  });

  const [poItems, setPOItems] = useState<POItem[]>([]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [posRes, suppliersRes, itemsRes, unitsRes] = await Promise.all([
        supabase
          .from('warehouse_purchase_orders')
          .select(`
            *,
            supplier:suppliers(id, name),
            warehouse_po_items(*)
          `)
          .order('created_at', { ascending: false }),

        supabase
          .from('suppliers')
          .select('id, name')
          .in('type', ['warehouse', 'both'])
          .order('name'),

        supabase
          .from('items')
          .select('*')
          .eq('category', 'warehouse')
          .order('serial'),

        supabase
          .from('warehouse_units')
          .select('item_id, purchase_unit, sale_unit, purchase_to_sale_ratio')
      ]);

      if (posRes.error) throw posRes.error;
      if (suppliersRes.error) throw suppliersRes.error;
      if (itemsRes.error) throw itemsRes.error;

      setPurchaseOrders(posRes.data || []);
      setSuppliers(suppliersRes.data || []);
      setItems(itemsRes.data || []);

      const unitsMap: Record<string, WarehouseUnit> = {};
      (unitsRes.data || []).forEach((unit: any) => {
        unitsMap[unit.item_id] = {
          purchase_unit: unit.purchase_unit,
          sale_unit: unit.sale_unit,
          purchase_to_sale_ratio: unit.purchase_to_sale_ratio,
        };
      });
      setWarehouseUnits(unitsMap);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddItem = () => {
    setPOItems([...poItems, { item_id: '', quantity: 0, unit_price: 0 }]);
  };

  const handleRemoveItem = (index: number) => {
    setPOItems(poItems.filter((_, i) => i !== index));
  };

  const handleItemChange = (index: number, field: keyof POItem, value: any) => {
    const updated = [...poItems];
    updated[index] = { ...updated[index], [field]: value };
    setPOItems(updated);
  };

  const calculateTotals = () => {
    const subtotal = poItems.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0);
    const vat_amount = subtotal * (formData.vat_rate / 100);
    const total = subtotal + vat_amount;
    return { subtotal, vat_amount, total };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (poItems.length === 0) {
      alert('Please add at least one item');
      return;
    }

    try {
      const { subtotal, vat_amount, total } = calculateTotals();

      const { data: po, error: poError } = await supabase
        .from('warehouse_purchase_orders')
        .insert([{
          supplier_id: formData.supplier_id,
          created_by: user?.id,
          status: 'pending',
          subtotal,
          vat_rate: formData.vat_rate,
          vat_amount,
          total,
          notes: formData.notes,
        }])
        .select()
        .single();

      if (poError) throw poError;

      const items = poItems.map(item => ({
        po_id: po.id,
        item_id: item.item_id,
        quantity: item.quantity,
        unit_price: item.unit_price,
        total: item.quantity * item.unit_price,
      }));

      const { error: itemsError } = await supabase
        .from('warehouse_po_items')
        .insert(items);

      if (itemsError) throw itemsError;

      alert('Purchase order created successfully');
      setShowForm(false);
      resetForm();
      loadData();
    } catch (error) {
      console.error('Error creating PO:', error);
      alert('Error creating purchase order');
    }
  };

  const handleMarkAsReceived = async (poId: string) => {
    if (!confirm('Mark this purchase order as received? This will update stock levels.')) return;

    try {
      const { error } = await supabase
        .from('warehouse_purchase_orders')
        .update({ status: 'received' })
        .eq('id', poId);

      if (error) throw error;

      alert('Purchase order marked as received');
      loadData();
    } catch (error) {
      console.error('Error updating PO:', error);
      alert('Error updating purchase order');
    }
  };

  const resetForm = () => {
    setFormData({ supplier_id: '', vat_rate: 0, notes: '' });
    setPOItems([]);
  };

  const getStatusBadge = (status: string) => {
    const styles = {
      pending: 'bg-yellow-100 text-yellow-800',
      approved: 'bg-blue-100 text-blue-800',
      rejected: 'bg-red-100 text-red-800',
      received: 'bg-green-100 text-green-800',
    };
    return styles[status as keyof typeof styles] || 'bg-slate-100 text-slate-800';
  };

  if (loading) {
    return <div className="text-center py-8">Loading...</div>;
  }

  const { subtotal, vat_amount, total } = calculateTotals();

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-slate-900">{t('warehouse_purchase_orders')}</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          {t('new_purchase_order')}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
          <h3 className="text-lg font-semibold text-slate-900">{t('create_purchase_order')}</h3>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Supplier *
              </label>
              <select
                value={formData.supplier_id}
                onChange={(e) => setFormData({ ...formData, supplier_id: e.target.value })}
                required
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">{t('select_supplier')}...</option>
                {suppliers.map(supplier => (
                  <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                {t('vat_rate')} (%)
              </label>
              <input
                type="number"
                value={15}
                disabled
                className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-slate-100 cursor-not-allowed"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Notes
              </label>
              <textarea
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                rows={2}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          <div className="border-t pt-4">
            <div className="flex justify-between items-center mb-3">
              <h4 className="text-md font-semibold text-slate-900">Items</h4>
              <button
                type="button"
                onClick={handleAddItem}
                className="text-sm px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700"
              >
                {t('add_item')}
              </button>
            </div>

            {poItems.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-4">{t('no_items_added_yet')}</p>
            ) : (
              <div className="space-y-3">
                {poItems.map((item, index) => {
                  const selectedUnit = item.item_id ? warehouseUnits[item.item_id] : null;
                  return (
                    <div key={index} className="grid grid-cols-12 gap-2 items-start bg-slate-50 p-3 rounded">
                      <div className="col-span-5">
                        <select
                          value={item.item_id}
                          onChange={(e) => handleItemChange(index, 'item_id', e.target.value)}
                          required
                          className="w-full px-2 py-1 text-sm border border-slate-300 rounded focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="">Select item...</option>
                          {items.map(itm => (
                            <option key={itm.id} value={itm.id}>
                              {itm.serial} - {itm.name}
                            </option>
                          ))}
                        </select>
                        {selectedUnit && (
                          <p className="text-xs text-slate-500 mt-1">
                            Unit: {selectedUnit.purchase_unit}
                          </p>
                        )}
                      </div>
                      <div className="col-span-2">
                        <input
                          type="number"
                          step="0.01"
                          value={item.quantity || ''}
                          onChange={(e) => handleItemChange(index, 'quantity', parseFloat(e.target.value) || 0)}
                          placeholder="Qty"
                          required
                          className="w-full px-2 py-1 text-sm border border-slate-300 rounded focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div className="col-span-2">
                        <input
                          type="number"
                          step="0.01"
                          value={item.unit_price || ''}
                          onChange={(e) => handleItemChange(index, 'unit_price', parseFloat(e.target.value) || 0)}
                          placeholder="Price"
                          required
                          className="w-full px-2 py-1 text-sm border border-slate-300 rounded focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div className="col-span-2 text-sm font-medium text-slate-900 py-1">
                        SR {(item.quantity * item.unit_price).toFixed(2)}
                      </div>
                      <div className="col-span-1">
                        <button
                          type="button"
                          onClick={() => handleRemoveItem(index)}
                          className="p-1 text-red-600 hover:bg-red-50 rounded"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {poItems.length > 0 && (
            <div className="border-t pt-4">
              <div className="flex justify-end">
                <div className="w-64 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-600">Subtotal:</span>
                    <span className="font-medium">SR {subtotal.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-600">VAT ({formData.vat_rate}%):</span>
                    <span className="font-medium">SR {vat_amount.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-lg font-bold border-t pt-2">
                    <span>Total:</span>
                    <span>SR {total.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 border-t pt-4">
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                resetForm();
              }}
              className="px-4 py-2 text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              {t('create_purchase_order')}
            </button>
          </div>
        </form>
      )}

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                {t('po_number')}
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                {t('supplier')}
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                {t('status')}
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                {t('total')}
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                {t('date')}
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">
                {t('actions')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {purchaseOrders.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  {t('no_purchase_orders_found')}
                </td>
              </tr>
            ) : (
              purchaseOrders.map((po) => (
                <tr key={po.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-sm font-medium text-slate-900">
                    {po.po_number}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">
                    {po.supplier.name}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 text-xs font-medium rounded ${getStatusBadge(po.status)}`}>
                      {po.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm font-medium text-slate-900">
                    SR {po.total.toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">
                    {new Date(po.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => setSelectedPO(po)}
                        className="p-1 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                        title="View Details"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      {po.status === 'approved' && (
                        <button
                          onClick={() => handleMarkAsReceived(po.id)}
                          className="p-1 text-green-600 hover:bg-green-50 rounded transition-colors"
                          title="Mark as Received"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {selectedPO && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center">
              <h3 className="text-xl font-bold text-slate-900">{selectedPO.po_number}</h3>
              <button
                onClick={() => setSelectedPO(null)}
                className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-slate-600">Supplier:</span>
                  <p className="font-medium">{selectedPO.supplier.name}</p>
                </div>
                <div>
                  <span className="text-slate-600">Status:</span>
                  <p>
                    <span className={`px-2 py-1 text-xs font-medium rounded ${getStatusBadge(selectedPO.status)}`}>
                      {selectedPO.status}
                    </span>
                  </p>
                </div>
                <div>
                  <span className="text-slate-600">Date:</span>
                  <p className="font-medium">{new Date(selectedPO.created_at).toLocaleString()}</p>
                </div>
              </div>

              <div className="border-t pt-4">
                <h4 className="font-semibold text-slate-900 mb-3">Items</h4>
                <table className="w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">Item</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-slate-500">Qty</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-slate-500">Price</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-slate-500">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {selectedPO.warehouse_po_items.map((item: any) => (
                      <tr key={item.id}>
                        <td className="px-3 py-2">Item {item.item_id}</td>
                        <td className="px-3 py-2 text-right">{item.quantity}</td>
                        <td className="px-3 py-2 text-right">SR {item.unit_price.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right font-medium">SR {item.total.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="border-t pt-4 flex justify-end">
                <div className="w-64 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-600">Subtotal:</span>
                    <span className="font-medium">SR {selectedPO.subtotal.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">VAT ({selectedPO.vat_rate}%):</span>
                    <span className="font-medium">SR {selectedPO.vat_amount.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-lg font-bold border-t pt-2">
                    <span>Total:</span>
                    <span>SR {selectedPO.total.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
