import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { Eye, X, Download } from 'lucide-react';

interface PurchaseOrder {
  id: string;
  po_number: string;
  status: string;
  subtotal: number;
  vat_rate: number;
  vat_amount: number;
  total: number;
  created_at: string;
  supplier: { name: string };
  items: any[];
}

interface Props {
  type: 'warehouse' | 'raw_material';
}

export function AccountantPOView({ type }: Props) {
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPO, setSelectedPO] = useState<PurchaseOrder | null>(null);

  useEffect(() => {
    loadPurchaseOrders();
  }, [type]);

  const loadPurchaseOrders = async () => {
    try {
      const table = type === 'warehouse' ? 'warehouse_purchase_orders' : 'raw_material_purchase_orders';
      const itemsTable = type === 'warehouse' ? 'warehouse_po_items' : 'raw_material_po_items';

      const { data, error } = await supabase
        .from(table)
        .select(`
          *,
          supplier:suppliers(name),
          ${itemsTable}(*)
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;

      setPurchaseOrders((data || []).map(po => ({
        ...po,
        items: po[itemsTable] || []
      })));
    } catch (error) {
      console.error('Error loading purchase orders:', error);
    } finally {
      setLoading(false);
    }
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

  const downloadPOReport = () => {
    const headers = ['PO Number', 'Supplier', 'Status', 'Subtotal', 'VAT', 'Total', 'Date'];
    const rows = purchaseOrders.map(po => [
      po.po_number,
      po.supplier.name,
      po.status,
      po.subtotal.toFixed(2),
      po.vat_amount.toFixed(2),
      po.total.toFixed(2),
      new Date(po.created_at).toLocaleDateString(),
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(',')),
    ].join('\n');

    const BOM = '\uFEFF';
    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${type}_purchase_orders_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  if (loading) {
    return <div className="text-center py-8">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-xl font-bold text-slate-900">
          {type === 'warehouse' ? 'Warehouse' : 'Raw Material'} Purchase Orders
        </h3>
        <button
          onClick={downloadPOReport}
          disabled={purchaseOrders.length === 0}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Download className="w-4 h-4" />
          Download Report
        </button>
      </div>

      {purchaseOrders.length === 0 ? (
        <div className="text-center py-12 text-slate-500">
          No purchase orders found
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
                  Supplier
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                  Status
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
              {purchaseOrders.map((po) => (
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
                    <button
                      onClick={() => setSelectedPO(po)}
                      className="p-1 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                      title="View Details"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
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
                    {selectedPO.items.map((item: any, idx) => (
                      <tr key={idx}>
                        <td className="px-3 py-2">
                          {type === 'warehouse' ? `Item ${item.item_id?.substring(0, 8)}` : `RM ${item.raw_material_id?.substring(0, 8)}`}
                        </td>
                        <td className="px-3 py-2 text-right">{item.quantity}</td>
                        <td className="px-3 py-2 text-right">SR {item.unit_price?.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right font-medium">SR {item.total?.toFixed(2)}</td>
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
