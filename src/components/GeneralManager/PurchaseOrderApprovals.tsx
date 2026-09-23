import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { Check, X, Eye } from 'lucide-react';

interface PurchaseOrder {
  id: string;
  po_number: string;
  status: string;
  subtotal: number;
  vat_rate: number;
  vat_amount: number;
  total: number;
  created_at: string;
  notes: string | null;
  supplier: { name: string };
  type: 'warehouse' | 'raw_material';
  items: any[];
}

export function PurchaseOrderApprovals() {
  const [pendingPOs, setPendingPOs] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPO, setSelectedPO] = useState<PurchaseOrder | null>(null);

  useEffect(() => {
    loadPendingPOs();
  }, []);

  const loadPendingPOs = async () => {
    try {
      const [warehousePOs, rawMaterialPOs] = await Promise.all([
        supabase
          .from('warehouse_purchase_orders')
          .select(`
            *,
            supplier:suppliers(name),
            warehouse_po_items(*)
          `)
          .eq('status', 'pending')
          .order('created_at', { ascending: false }),

        supabase
          .from('raw_material_purchase_orders')
          .select(`
            *,
            supplier:suppliers(name),
            raw_material_po_items(*)
          `)
          .eq('status', 'pending')
          .order('created_at', { ascending: false })
      ]);

      if (warehousePOs.error) throw warehousePOs.error;
      if (rawMaterialPOs.error) throw rawMaterialPOs.error;

      const allPOs: PurchaseOrder[] = [
        ...(warehousePOs.data || []).map(po => ({
          ...po,
          type: 'warehouse' as const,
          items: po.warehouse_po_items
        })),
        ...(rawMaterialPOs.data || []).map(po => ({
          ...po,
          type: 'raw_material' as const,
          items: po.raw_material_po_items
        }))
      ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      setPendingPOs(allPOs);
    } catch (error) {
      console.error('Error loading pending POs:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (po: PurchaseOrder) => {
    if (!confirm(`Approve purchase order ${po.po_number}?`)) return;

    try {
      const table = po.type === 'warehouse' ? 'warehouse_purchase_orders' : 'raw_material_purchase_orders';
      const { error } = await supabase
        .from(table)
        .update({ status: 'approved' })
        .eq('id', po.id);

      if (error) throw error;

      alert('Purchase order approved successfully');
      loadPendingPOs();
    } catch (error) {
      console.error('Error approving PO:', error);
      alert('Error approving purchase order');
    }
  };

  const handleReject = async (po: PurchaseOrder) => {
    const reason = prompt(`Reject purchase order ${po.po_number}?\n\nPlease provide a reason:`);
    if (!reason) return;

    try {
      const table = po.type === 'warehouse' ? 'warehouse_purchase_orders' : 'raw_material_purchase_orders';
      const { error } = await supabase
        .from(table)
        .update({ status: 'rejected', notes: `${po.notes || ''}\n\nREJECTED: ${reason}` })
        .eq('id', po.id);

      if (error) throw error;

      alert('Purchase order rejected');
      loadPendingPOs();
    } catch (error) {
      console.error('Error rejecting PO:', error);
      alert('Error rejecting purchase order');
    }
  };

  if (loading) {
    return <div className="text-center py-8">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <h3 className="text-xl font-bold text-slate-900">Pending Purchase Orders for Approval</h3>

      {pendingPOs.length === 0 ? (
        <div className="text-center py-12 text-slate-500">
          No pending purchase orders to approve
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                  PO Number
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                  Type
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                  Supplier
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                  Total
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                  Date
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {pendingPOs.map((po) => (
                <tr key={po.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-sm font-medium text-slate-900">
                    {po.po_number}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 text-xs font-medium rounded ${
                      po.type === 'warehouse'
                        ? 'bg-green-100 text-green-800'
                        : 'bg-purple-100 text-purple-800'
                    }`}>
                      {po.type === 'warehouse' ? 'Warehouse' : 'Raw Material'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">
                    {po.supplier.name}
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
                      <button
                        onClick={() => handleApprove(po)}
                        className="p-1 text-green-600 hover:bg-green-50 rounded transition-colors"
                        title="Approve"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleReject(po)}
                        className="p-1 text-red-600 hover:bg-red-50 rounded transition-colors"
                        title="Reject"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
                  <span className="text-slate-600">Type:</span>
                  <p className="font-medium">{selectedPO.type === 'warehouse' ? 'Warehouse Items' : 'Raw Materials'}</p>
                </div>
                <div>
                  <span className="text-slate-600">Supplier:</span>
                  <p className="font-medium">{selectedPO.supplier.name}</p>
                </div>
                <div>
                  <span className="text-slate-600">Date:</span>
                  <p className="font-medium">{new Date(selectedPO.created_at).toLocaleString()}</p>
                </div>
                <div>
                  <span className="text-slate-600">Status:</span>
                  <p className="font-medium text-yellow-600">Pending Approval</p>
                </div>
                {selectedPO.notes && (
                  <div className="col-span-2">
                    <span className="text-slate-600">Notes:</span>
                    <p className="font-medium">{selectedPO.notes}</p>
                  </div>
                )}
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
                    {selectedPO.items.map((item: any, idx) => (
                      <tr key={idx}>
                        <td className="px-3 py-2">
                          {selectedPO.type === 'warehouse' ? `Item ${item.item_id.substring(0, 8)}` : `RM ${item.raw_material_id.substring(0, 8)}`}
                        </td>
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

              <div className="border-t pt-4 flex justify-end gap-3">
                <button
                  onClick={() => {
                    handleReject(selectedPO);
                    setSelectedPO(null);
                  }}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors flex items-center gap-2"
                >
                  <X className="w-4 h-4" />
                  Reject
                </button>
                <button
                  onClick={() => {
                    handleApprove(selectedPO);
                    setSelectedPO(null);
                  }}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center gap-2"
                >
                  <Check className="w-4 h-4" />
                  Approve
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
