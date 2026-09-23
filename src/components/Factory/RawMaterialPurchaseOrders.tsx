import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { Plus, Eye, X, Lock } from 'lucide-react';

interface Supplier {
  id: string;
  name: string;
}

interface RawMaterial {
  id: string;
  name: string;
  unit: string;
  current_stock: number;
}

interface POItem {
  raw_material_id: string;
  quantity: number;
  unit_price: number;
  raw_material?: RawMaterial;
}

interface PurchaseOrder {
  id: string;
  po_number: string;
  status: string;
  subtotal: number;
  vat_rate: number;
  vat_amount: number;
  total: number;
  notes: string | null;
  created_at: string;
  supplier: Supplier;
  raw_material_po_items: RawMaterialPOItem[];
  // joined from daily_supply_entries
  is_daily_op: boolean;
}

interface RawMaterialPOItem {
  id: string;
  raw_material_id: string;
  quantity: number;
  unit_price: number;
  total: number;
  raw_material?: { name: string; unit: string };
}

export function RawMaterialPurchaseOrders() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [rawMaterials, setRawMaterials] = useState<RawMaterial[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [selectedPO, setSelectedPO] = useState<PurchaseOrder | null>(null);
  const [activeTab, setActiveTab] = useState<'daily_op' | 'manual'>('daily_op');

  const [formData, setFormData] = useState({ supplier_id: '', vat_rate: 15, notes: '' });
  const [poItems, setPOItems] = useState<POItem[]>([]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [posRes, suppliersRes, rawMaterialsRes] = await Promise.all([
        supabase
          .from('raw_material_purchase_orders')
          .select(`
            *,
            supplier:suppliers(id, name),
            raw_material_po_items(*, raw_material:raw_materials(name, unit))
          `)
          .order('created_at', { ascending: false }),

        supabase.from('suppliers').select('id, name').in('type', ['raw_material', 'both']).order('name'),
        supabase.from('raw_materials').select('*').order('name'),
      ]);

      if (posRes.error) throw posRes.error;
      if (suppliersRes.error) throw suppliersRes.error;
      if (rawMaterialsRes.error) throw rawMaterialsRes.error;

      // Determine which POs are linked to daily operations
      const allPoIds = (posRes.data || []).map((p: { id: string }) => p.id);
      let dailyOpPoIds = new Set<string>();
      if (allPoIds.length > 0) {
        const { data: dailyLinks } = await supabase
          .from('daily_supply_entries')
          .select('po_id')
          .in('po_id', allPoIds);
        const mealLinks = await supabase
          .from('daily_employee_meal_entries')
          .select('id') // meals create POs indirectly via supply — not direct link here
          .limit(1);
        void mealLinks;
        (dailyLinks || []).forEach((l: { po_id: string | null }) => { if (l.po_id) dailyOpPoIds.add(l.po_id); });
      }

      const orders = (posRes.data || []).map((po: PurchaseOrder & { notes: string | null }) => ({
        ...po,
        is_daily_op: dailyOpPoIds.has(po.id) || (po.notes?.startsWith('Daily operation') ?? false),
      }));

      setPurchaseOrders(orders);
      setSuppliers(suppliersRes.data || []);
      setRawMaterials(rawMaterialsRes.data || []);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const calculateTotals = () => {
    const subtotal = poItems.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
    const vat_amount = subtotal * (formData.vat_rate / 100);
    return { subtotal, vat_amount, total: subtotal + vat_amount };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (poItems.length === 0) { alert('Please add at least one item'); return; }

    try {
      const { subtotal, vat_amount, total } = calculateTotals();
      const { data: po, error: poError } = await supabase
        .from('raw_material_purchase_orders')
        .insert([{ supplier_id: formData.supplier_id, created_by: user?.id, status: 'pending', subtotal, vat_rate: formData.vat_rate, vat_amount, total, notes: formData.notes }])
        .select().single();
      if (poError) throw poError;

      const { error: itemsError } = await supabase.from('raw_material_po_items').insert(
        poItems.map(item => ({ po_id: po.id, raw_material_id: item.raw_material_id, quantity: item.quantity, unit_price: item.unit_price, total: item.quantity * item.unit_price }))
      );
      if (itemsError) throw itemsError;

      setShowForm(false);
      setPOItems([]);
      setFormData({ supplier_id: '', vat_rate: 15, notes: '' });
      loadData();
    } catch (error) {
      console.error('Error creating PO:', error);
      alert('Error creating purchase order');
    }
  };

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      pending: 'bg-yellow-100 text-yellow-800',
      approved: 'bg-blue-100 text-blue-800',
      rejected: 'bg-red-100 text-red-800',
      received: 'bg-green-100 text-green-800',
    };
    return styles[status] || 'bg-slate-100 text-slate-800';
  };

  if (loading) return <div className="text-center py-8">Loading...</div>;

  const { subtotal, vat_amount, total } = calculateTotals();
  const dailyOpOrders = purchaseOrders.filter(po => po.is_daily_op);
  const manualOrders = purchaseOrders.filter(po => !po.is_daily_op);
  const displayedOrders = activeTab === 'daily_op' ? dailyOpOrders : manualOrders;

  const POTable = ({ orders, readOnly }: { orders: PurchaseOrder[]; readOnly: boolean }) => (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <table className="w-full">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">{t('po_number')}</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">{t('supplier')}</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">{t('status')}</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">{t('total')}</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">{t('date')}</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">{t('actions')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {orders.length === 0 ? (
            <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">{t('no_purchase_orders_found')}</td></tr>
          ) : (
            orders.map((po) => (
              <tr key={po.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-sm font-medium text-slate-900">
                  <div className="flex items-center gap-2">
                    {readOnly && <Lock className="w-3 h-3 text-slate-400" />}
                    {po.po_number}
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-slate-600">{po.supplier.name}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-1 text-xs font-medium rounded ${getStatusBadge(po.status)}`}>{po.status}</span>
                </td>
                <td className="px-4 py-3 text-sm font-medium text-slate-900">{po.total.toFixed(2)}</td>
                <td className="px-4 py-3 text-sm text-slate-600">{new Date(po.created_at).toLocaleDateString()}</td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => setSelectedPO(po)} className="p-1 text-blue-600 hover:bg-blue-50 rounded transition-colors" title="View Details">
                    <Eye className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-slate-900">{t('raw_material_purchase_orders')}</h2>
        {activeTab === 'manual' && (
          <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
            <Plus className="w-4 h-4" />
            {t('new_purchase_order')}
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200">
        <button
          onClick={() => setActiveTab('daily_op')}
          className={`px-5 py-3 text-sm font-medium transition-colors ${activeTab === 'daily_op' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-600 hover:text-slate-900'}`}
        >
          Daily Operation POs
          {dailyOpOrders.length > 0 && <span className="ml-2 px-1.5 py-0.5 text-xs bg-blue-100 text-blue-700 rounded-full">{dailyOpOrders.length}</span>}
        </button>
        <button
          onClick={() => setActiveTab('manual')}
          className={`px-5 py-3 text-sm font-medium transition-colors ${activeTab === 'manual' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-600 hover:text-slate-900'}`}
        >
          Manual POs
          {manualOrders.length > 0 && <span className="ml-2 px-1.5 py-0.5 text-xs bg-slate-100 text-slate-600 rounded-full">{manualOrders.length}</span>}
        </button>
      </div>

      {activeTab === 'daily_op' && (
        <div className="flex items-center gap-2 text-sm text-slate-600 bg-blue-50 border border-blue-100 rounded-lg px-4 py-2.5">
          <Lock className="w-4 h-4 text-blue-500" />
          These purchase orders were automatically generated by submitted daily operations and are read-only.
        </div>
      )}

      {/* Manual PO Form */}
      {activeTab === 'manual' && showForm && (
        <form onSubmit={handleSubmit} className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
          <h3 className="text-lg font-semibold text-slate-900">Create Raw Material Purchase Order</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Supplier *</label>
              <select value={formData.supplier_id} onChange={e => setFormData({ ...formData, supplier_id: e.target.value })} required className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent">
                <option value="">Select supplier...</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">VAT Rate (%)</label>
              <input type="number" value={formData.vat_rate} onChange={e => setFormData({ ...formData, vat_rate: parseFloat(e.target.value) || 0 })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
              <textarea value={formData.notes} onChange={e => setFormData({ ...formData, notes: e.target.value })} rows={2} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
            </div>
          </div>

          <div className="border-t pt-4">
            <div className="flex justify-between items-center mb-3">
              <h4 className="text-md font-semibold text-slate-900">Raw Materials</h4>
              <button type="button" onClick={() => setPOItems(prev => [...prev, { raw_material_id: '', quantity: 0, unit_price: 0 }])} className="text-sm px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700">Add Item</button>
            </div>
            {poItems.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-4">No items added yet</p>
            ) : (
              <div className="space-y-3">
                {poItems.map((item, index) => {
                  const selectedRM = item.raw_material_id ? rawMaterials.find(rm => rm.id === item.raw_material_id) : null;
                  return (
                    <div key={index} className="grid grid-cols-12 gap-2 items-start bg-slate-50 p-3 rounded">
                      <div className="col-span-5">
                        <select value={item.raw_material_id} onChange={e => setPOItems(prev => prev.map((it, i) => i === index ? { ...it, raw_material_id: e.target.value } : it))} required className="w-full px-2 py-1 text-sm border border-slate-300 rounded">
                          <option value="">Select raw material...</option>
                          {rawMaterials.map(rm => <option key={rm.id} value={rm.id}>{rm.name}</option>)}
                        </select>
                        {selectedRM && <p className="text-xs text-slate-500 mt-1">Unit: {selectedRM.unit} | Stock: {selectedRM.current_stock.toFixed(2)}</p>}
                      </div>
                      <div className="col-span-2">
                        <input type="number" step="0.01" value={item.quantity || ''} onChange={e => setPOItems(prev => prev.map((it, i) => i === index ? { ...it, quantity: parseFloat(e.target.value) || 0 } : it))} placeholder="Qty" required className="w-full px-2 py-1 text-sm border border-slate-300 rounded" />
                      </div>
                      <div className="col-span-2">
                        <input type="number" step="0.01" value={item.unit_price || ''} onChange={e => setPOItems(prev => prev.map((it, i) => i === index ? { ...it, unit_price: parseFloat(e.target.value) || 0 } : it))} placeholder="Price" required className="w-full px-2 py-1 text-sm border border-slate-300 rounded" />
                      </div>
                      <div className="col-span-2 text-sm font-medium text-slate-900 py-1">{(item.quantity * item.unit_price).toFixed(2)}</div>
                      <div className="col-span-1">
                        <button type="button" onClick={() => setPOItems(prev => prev.filter((_, i) => i !== index))} className="p-1 text-red-600 hover:bg-red-50 rounded"><X className="w-4 h-4" /></button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {poItems.length > 0 && (
            <div className="border-t pt-4 flex justify-end">
              <div className="w-64 space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-slate-600">Subtotal:</span><span className="font-medium">{subtotal.toFixed(2)}</span></div>
                <div className="flex justify-between"><span className="text-slate-600">VAT ({formData.vat_rate}%):</span><span className="font-medium">{vat_amount.toFixed(2)}</span></div>
                <div className="flex justify-between text-lg font-bold border-t pt-2"><span>Total:</span><span>{total.toFixed(2)}</span></div>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 border-t pt-4">
            <button type="button" onClick={() => { setShowForm(false); setPOItems([]); setFormData({ supplier_id: '', vat_rate: 15, notes: '' }); }} className="px-4 py-2 text-slate-700 hover:bg-slate-100 rounded-lg">Cancel</button>
            <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Create Purchase Order</button>
          </div>
        </form>
      )}

      <POTable orders={displayedOrders} readOnly={activeTab === 'daily_op'} />

      {/* Detail modal */}
      {selectedPO && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center">
              <div className="flex items-center gap-3">
                <h3 className="text-xl font-bold text-slate-900">{selectedPO.po_number}</h3>
                {selectedPO.is_daily_op && (
                  <span className="flex items-center gap-1 text-xs px-2 py-1 bg-blue-50 text-blue-700 border border-blue-200 rounded font-medium">
                    <Lock className="w-3 h-3" /> Daily Operation
                  </span>
                )}
              </div>
              <button onClick={() => setSelectedPO(null)} className="p-2 hover:bg-slate-100 rounded-lg"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><span className="text-slate-600">Supplier:</span><p className="font-medium">{selectedPO.supplier.name}</p></div>
                <div><span className="text-slate-600">Status:</span><p><span className={`px-2 py-1 text-xs font-medium rounded ${getStatusBadge(selectedPO.status)}`}>{selectedPO.status}</span></p></div>
                <div><span className="text-slate-600">Date:</span><p className="font-medium">{new Date(selectedPO.created_at).toLocaleString()}</p></div>
                {selectedPO.notes && <div><span className="text-slate-600">Notes:</span><p className="font-medium">{selectedPO.notes}</p></div>}
              </div>

              <div className="border-t pt-4">
                <h4 className="font-semibold text-slate-900 mb-3">Raw Materials</h4>
                <table className="w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">Material</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-slate-500">Qty</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-slate-500">Unit Price</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-slate-500">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {selectedPO.raw_material_po_items.map((item) => (
                      <tr key={item.id}>
                        <td className="px-3 py-2">{item.raw_material?.name || item.raw_material_id}</td>
                        <td className="px-3 py-2 text-right">{Number(item.quantity).toFixed(2)} {item.raw_material?.unit || ''}</td>
                        <td className="px-3 py-2 text-right">{Number(item.unit_price).toFixed(4)}</td>
                        <td className="px-3 py-2 text-right font-medium">{Number(item.total).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="border-t pt-4 flex justify-end">
                <div className="w-64 space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-slate-600">Subtotal:</span><span className="font-medium">{Number(selectedPO.subtotal).toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-600">VAT ({selectedPO.vat_rate}%):</span><span className="font-medium">{Number(selectedPO.vat_amount).toFixed(2)}</span></div>
                  <div className="flex justify-between text-lg font-bold border-t pt-2"><span>Total:</span><span>{Number(selectedPO.total).toFixed(2)}</span></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
