import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import {
  Eye, X, Download, Filter, Plus, Save, Trash2, FileText,
  ChevronDown, ChevronUp, Printer, Package
} from 'lucide-react';

interface RawMaterial {
  id: string;
  name: string;
  unit: string;
}

interface Supplier {
  id: string;
  name: string;
}

interface POItem {
  id?: string;
  raw_material_id: string;
  raw_material?: { name: string; unit: string } | null;
  quantity: number;
  unit_price: number;
  total: number;
  isNew?: boolean;
  isDeleted?: boolean;
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
  raw_material_po_items: POItem[];
  is_daily_op: boolean;
}

const STATUS_OPTIONS = ['pending', 'approved', 'rejected', 'on_hold'] as const;

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  approved: 'bg-blue-100 text-blue-800 border-blue-200',
  rejected: 'bg-red-100 text-red-800 border-red-200',
  on_hold: 'bg-orange-100 text-orange-800 border-orange-200',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  on_hold: 'On Hold',
};

const EDITABLE_STATUSES = new Set(['pending', 'on_hold']);

export function AccountantRawMaterialPOView() {
  const { user } = useAuth();

  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [rawMaterials, setRawMaterials] = useState<RawMaterial[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Filters
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterSupplier, setFilterSupplier] = useState<string>('all');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'daily_op' | 'manual'>('all');
  const [showFilters, setShowFilters] = useState(false);

  // Modal state
  const [selectedPO, setSelectedPO] = useState<PurchaseOrder | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editItems, setEditItems] = useState<POItem[]>([]);
  const [editStatus, setEditStatus] = useState('');
  const [editSupplier, setEditSupplier] = useState('');
  const [editVatRate, setEditVatRate] = useState(15);
  const [editNotes, setEditNotes] = useState('');

  // New PO form
  const [showNewForm, setShowNewForm] = useState(false);
  const [newFormData, setNewFormData] = useState({ supplier_id: '', vat_rate: 15, notes: '' });
  const [newPOItems, setNewPOItems] = useState<Omit<POItem, 'id' | 'total'>[]>([]);

  const loadData = useCallback(async () => {
    try {
      const [posRes, suppliersRes, rawMatsRes] = await Promise.all([
        supabase
          .from('raw_material_purchase_orders')
          .select(`*, supplier:suppliers(id, name), raw_material_po_items(*, raw_material:raw_materials(name, unit))`)
          .order('created_at', { ascending: false }),
        supabase.from('suppliers').select('id, name').in('type', ['raw_material', 'both']).order('name'),
        supabase.from('raw_materials').select('id, name, unit').order('name'),
      ]);

      if (posRes.error) throw posRes.error;

      const allPoIds = (posRes.data || []).map((p: any) => p.id);
      let dailyOpPoIds = new Set<string>();
      if (allPoIds.length > 0) {
        const { data: dailyLinks } = await supabase
          .from('daily_supply_entries')
          .select('po_id')
          .in('po_id', allPoIds);
        (dailyLinks || []).forEach((l: any) => { if (l.po_id) dailyOpPoIds.add(l.po_id); });
      }

      const orders = (posRes.data || []).map((po: any) => ({
        ...po,
        is_daily_op: dailyOpPoIds.has(po.id) || (po.notes?.startsWith('Daily operation') ?? false),
      }));

      setPurchaseOrders(orders);
      setSuppliers(suppliersRes.data || []);
      setRawMaterials(rawMatsRes.data || []);
    } catch (err) {
      console.error('Error loading data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const openPO = (po: PurchaseOrder) => {
    setSelectedPO(po);
    setEditMode(false);
    setEditItems(po.raw_material_po_items.map(i => ({ ...i })));
    setEditStatus(po.status);
    setEditSupplier(po.supplier.id);
    setEditVatRate(po.vat_rate);
    setEditNotes(po.notes || '');
  };

  const closeModal = () => {
    setSelectedPO(null);
    setEditMode(false);
  };

  const editSubtotal = editItems
    .filter(i => !i.isDeleted)
    .reduce((s, i) => s + i.quantity * i.unit_price, 0);
  const editVatAmount = editSubtotal * (editVatRate / 100);
  const editTotal = editSubtotal + editVatAmount;

  const handleSavePO = async () => {
    if (!selectedPO) return;
    setSaving(true);
    try {
      // Update PO header
      const { error: poErr } = await supabase
        .from('raw_material_purchase_orders')
        .update({
          supplier_id: editSupplier,
          status: editStatus,
          vat_rate: editVatRate,
          vat_amount: editVatAmount,
          subtotal: editSubtotal,
          total: editTotal,
          notes: editNotes || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', selectedPO.id);
      if (poErr) throw poErr;

      // Delete removed items
      const toDelete = editItems.filter(i => i.isDeleted && i.id);
      for (const item of toDelete) {
        await supabase.from('raw_material_po_items').delete().eq('id', item.id!);
      }

      // Upsert existing items
      const toUpsert = editItems.filter(i => !i.isDeleted && !i.isNew && i.id);
      for (const item of toUpsert) {
        await supabase
          .from('raw_material_po_items')
          .update({ quantity: item.quantity, unit_price: item.unit_price, total: item.quantity * item.unit_price })
          .eq('id', item.id!);
      }

      // Insert new items
      const toInsert = editItems.filter(i => !i.isDeleted && i.isNew);
      if (toInsert.length > 0) {
        await supabase.from('raw_material_po_items').insert(
          toInsert.map(i => ({
            po_id: selectedPO.id,
            raw_material_id: i.raw_material_id,
            quantity: i.quantity,
            unit_price: i.unit_price,
            total: i.quantity * i.unit_price,
          }))
        );
      }

      await loadData();
      setEditMode(false);
      closeModal();
    } catch (err) {
      console.error('Error saving PO:', err);
      alert('Error saving purchase order');
    } finally {
      setSaving(false);
    }
  };

  const handleCreatePO = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPOItems.length === 0) { alert('Add at least one item'); return; }
    setSaving(true);
    try {
      const subtotal = newPOItems.reduce((s, i) => s + i.quantity * i.unit_price, 0);
      const vat_amount = subtotal * (newFormData.vat_rate / 100);
      const total = subtotal + vat_amount;

      const { data: po, error: poErr } = await supabase
        .from('raw_material_purchase_orders')
        .insert([{
          supplier_id: newFormData.supplier_id,
          created_by: user?.id,
          status: 'pending',
          subtotal,
          vat_rate: newFormData.vat_rate,
          vat_amount,
          total,
          notes: newFormData.notes || null,
        }])
        .select()
        .single();
      if (poErr) throw poErr;

      await supabase.from('raw_material_po_items').insert(
        newPOItems.map(i => ({
          po_id: po.id,
          raw_material_id: i.raw_material_id,
          quantity: i.quantity,
          unit_price: i.unit_price,
          total: i.quantity * i.unit_price,
        }))
      );

      setShowNewForm(false);
      setNewPOItems([]);
      setNewFormData({ supplier_id: '', vat_rate: 15, notes: '' });
      await loadData();
    } catch (err) {
      console.error('Error creating PO:', err);
      alert('Error creating purchase order');
    } finally {
      setSaving(false);
    }
  };

  const filteredOrders = purchaseOrders.filter(po => {
    if (filterStatus !== 'all' && po.status !== filterStatus) return false;
    if (filterSupplier !== 'all' && po.supplier.id !== filterSupplier) return false;
    if (filterType === 'daily_op' && !po.is_daily_op) return false;
    if (filterType === 'manual' && po.is_daily_op) return false;
    if (filterDateFrom && po.created_at < filterDateFrom) return false;
    if (filterDateTo && po.created_at > filterDateTo + 'T23:59:59') return false;
    return true;
  });

  const clearFilters = () => {
    setFilterStatus('all');
    setFilterSupplier('all');
    setFilterDateFrom('');
    setFilterDateTo('');
    setFilterType('all');
  };

  const hasActiveFilters = filterStatus !== 'all' || filterSupplier !== 'all' ||
    filterDateFrom || filterDateTo || filterType !== 'all';

  const downloadReport = () => {
    const headers = [
      'PO Number', 'Type', 'Supplier', 'Status',
      'Subtotal (SR)', 'VAT Rate (%)', 'VAT (SR)', 'Total (SR)',
      'Notes', 'Date'
    ];
    const rows = filteredOrders.map(po => [
      po.po_number,
      po.is_daily_op ? 'Daily Operation' : 'Manual',
      po.supplier.name,
      po.status,
      po.subtotal.toFixed(2),
      po.vat_rate.toFixed(2),
      po.vat_amount.toFixed(2),
      po.total.toFixed(2),
      po.notes || '',
      new Date(po.created_at).toLocaleDateString(),
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')),
    ].join('\n');

    const BOM = '\uFEFF';
    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `raw_material_pos_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  const downloadDetailedReport = () => {
    const headers = [
      'PO Number', 'Type', 'Supplier', 'Status',
      'Material', 'Unit', 'Quantity', 'Unit Price (SR)', 'Line Total (SR)',
      'PO Subtotal (SR)', 'VAT Rate (%)', 'VAT (SR)', 'PO Total (SR)', 'Date'
    ];

    const rows: string[][] = [];
    filteredOrders.forEach(po => {
      if (po.raw_material_po_items.length === 0) {
        rows.push([
          po.po_number, po.is_daily_op ? 'Daily Operation' : 'Manual',
          po.supplier.name, po.status,
          '', '', '', '', '',
          po.subtotal.toFixed(2), po.vat_rate.toFixed(2), po.vat_amount.toFixed(2), po.total.toFixed(2),
          new Date(po.created_at).toLocaleDateString(),
        ]);
      } else {
        po.raw_material_po_items.forEach(item => {
          rows.push([
            po.po_number, po.is_daily_op ? 'Daily Operation' : 'Manual',
            po.supplier.name, po.status,
            item.raw_material?.name || item.raw_material_id,
            item.raw_material?.unit || '',
            Number(item.quantity).toFixed(2),
            Number(item.unit_price).toFixed(4),
            Number(item.total).toFixed(2),
            po.subtotal.toFixed(2), po.vat_rate.toFixed(2), po.vat_amount.toFixed(2), po.total.toFixed(2),
            new Date(po.created_at).toLocaleDateString(),
          ]);
        });
      }
    });

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')),
    ].join('\n');

    const BOM = '\uFEFF';
    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `raw_material_pos_detailed_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  const printPO = (po: PurchaseOrder) => {
    const printFrame = document.createElement('iframe');
    printFrame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    document.body.appendChild(printFrame);

    const totalAmount = po.raw_material_po_items.reduce((s, i) => s + Number(i.total), 0);
    const vatAmt = totalAmount * (po.vat_rate / 100);

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>${po.po_number}</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 8pt; color: #1e293b; }
  .header { background: linear-gradient(135deg, #1e293b 0%, #334155 100%); color: white; padding: 10px 12px; border-radius: 4px; margin-bottom: 10px; }
  .header h1 { font-size: 13pt; font-weight: 700; }
  .header p { font-size: 7pt; opacity: 0.8; margin-top: 2px; }
  .meta { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-bottom: 10px; }
  .meta-item label { font-size: 6pt; text-transform: uppercase; color: #64748b; font-weight: 600; }
  .meta-item p { font-size: 8pt; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
  thead { background: #334155; color: white; }
  th { padding: 4px 6px; text-align: left; font-size: 6.5pt; text-transform: uppercase; }
  th:last-child, td:last-child { text-align: right; }
  td { padding: 3px 6px; border-bottom: 1px solid #e2e8f0; font-size: 7.5pt; }
  tbody tr:nth-child(even) { background: #f8fafc; }
  .totals { display: flex; justify-content: flex-end; }
  .totals-box { width: 220px; }
  .totals-row { display: flex; justify-content: space-between; padding: 2px 0; font-size: 8pt; }
  .totals-row.grand { font-weight: 700; font-size: 10pt; border-top: 2px solid #1e293b; padding-top: 4px; margin-top: 2px; }
  .badge { display:inline-block; padding: 1px 6px; border-radius: 9999px; font-size:6.5pt; font-weight:600; }
  .badge-pending { background:#fef9c3; color:#854d0e; }
  .badge-approved { background:#dbeafe; color:#1e40af; }
  .badge-rejected { background:#fee2e2; color:#991b1b; }
  .badge-received { background:#dcfce7; color:#166534; }
</style></head><body>
<div class="header">
  <h1>${po.po_number}</h1>
  <p>Raw Material Purchase Order &mdash; ${new Date(po.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
</div>
<div class="meta">
  <div class="meta-item"><label>Supplier</label><p>${po.supplier.name}</p></div>
  <div class="meta-item"><label>Status</label><p><span class="badge badge-${po.status}">${(STATUS_LABELS[po.status] ?? po.status).toUpperCase()}</span></p></div>
  <div class="meta-item"><label>Type</label><p>${po.is_daily_op ? 'Daily Operation' : 'Manual'}</p></div>
</div>
<table>
  <thead><tr><th>#</th><th>Material</th><th>Unit</th><th>Quantity</th><th>Unit Price (SR)</th><th>Total (SR)</th></tr></thead>
  <tbody>
    ${po.raw_material_po_items.map((item, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${item.raw_material?.name || '-'}</td>
        <td>${item.raw_material?.unit || '-'}</td>
        <td>${Number(item.quantity).toFixed(2)}</td>
        <td>${Number(item.unit_price).toFixed(4)}</td>
        <td>${Number(item.total).toFixed(2)}</td>
      </tr>
    `).join('')}
  </tbody>
</table>
<div class="totals">
  <div class="totals-box">
    <div class="totals-row"><span>Subtotal:</span><span>SR ${totalAmount.toFixed(2)}</span></div>
    <div class="totals-row"><span>VAT (${po.vat_rate}%):</span><span>SR ${vatAmt.toFixed(2)}</span></div>
    <div class="totals-row grand"><span>Total:</span><span>SR ${(totalAmount + vatAmt).toFixed(2)}</span></div>
  </div>
</div>
${po.notes ? `<p style="margin-top:10px;font-size:7.5pt;color:#64748b;"><strong>Notes:</strong> ${po.notes}</p>` : ''}
</body></html>`;

    const doc = printFrame.contentWindow?.document;
    if (!doc) { document.body.removeChild(printFrame); return; }
    doc.open(); doc.write(html); doc.close();
    setTimeout(() => {
      printFrame.contentWindow?.focus();
      printFrame.contentWindow?.print();
      setTimeout(() => document.body.removeChild(printFrame), 1000);
    }, 400);
  };

  const summaryStats = {
    total: filteredOrders.length,
    pending: filteredOrders.filter(p => p.status === 'pending').length,
    approved: filteredOrders.filter(p => p.status === 'approved').length,
    rejected: filteredOrders.filter(p => p.status === 'rejected').length,
    on_hold: filteredOrders.filter(p => p.status === 'on_hold').length,
    totalValue: filteredOrders.reduce((s, p) => s + p.total, 0),
  };

  if (loading) return <div className="text-center py-12 text-slate-500">Loading...</div>;

  const newSubtotal = newPOItems.reduce((s, i) => s + i.quantity * i.unit_price, 0);
  const newVat = newSubtotal * (newFormData.vat_rate / 100);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Raw Material Purchase Orders</h2>
          <p className="text-sm text-slate-500 mt-1">Manage, edit and generate reports for raw material POs</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setShowFilters(v => !v)}
            className={`flex items-center gap-2 px-4 py-2 border rounded-lg text-sm font-medium transition-colors ${
              hasActiveFilters
                ? 'bg-blue-50 border-blue-300 text-blue-700'
                : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
            }`}
          >
            <Filter className="w-4 h-4" />
            Filters
            {hasActiveFilters && <span className="w-2 h-2 rounded-full bg-blue-500" />}
            {showFilters ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          <button
            onClick={downloadReport}
            disabled={filteredOrders.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 text-sm font-medium disabled:opacity-40 transition-colors"
          >
            <Download className="w-4 h-4" />
            Summary CSV
          </button>
          <button
            onClick={downloadDetailedReport}
            disabled={filteredOrders.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 text-sm font-medium disabled:opacity-40 transition-colors"
          >
            <FileText className="w-4 h-4" />
            Detailed CSV
          </button>
          <button
            onClick={() => setShowNewForm(v => !v)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" />
            New PO
          </button>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: 'Total POs', value: summaryStats.total },
          { label: 'Pending', value: summaryStats.pending },
          { label: 'Approved', value: summaryStats.approved },
          { label: 'Rejected', value: summaryStats.rejected },
          { label: 'On Hold', value: summaryStats.on_hold },
          { label: 'Total Value', value: `SR ${summaryStats.totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` },
        ].map(stat => (
          <div key={stat.label} className="bg-white border border-slate-200 rounded-lg px-4 py-3">
            <p className="text-xs text-slate-500 font-medium">{stat.label}</p>
            <p className="text-lg font-bold text-slate-900 mt-0.5">{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      {showFilters && (
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent">
                <option value="all">All Statuses</option>
                {STATUS_OPTIONS.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Supplier</label>
              <select value={filterSupplier} onChange={e => setFilterSupplier(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent">
                <option value="all">All Suppliers</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Type</label>
              <select value={filterType} onChange={e => setFilterType(e.target.value as any)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent">
                <option value="all">All Types</option>
                <option value="daily_op">Daily Operation</option>
                <option value="manual">Manual</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">From Date</label>
              <input type="date" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">To Date</label>
              <input type="date" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
            </div>
          </div>
          {hasActiveFilters && (
            <button onClick={clearFilters} className="text-xs text-red-600 hover:text-red-800 font-medium">
              Clear all filters
            </button>
          )}
        </div>
      )}

      {/* New PO Form */}
      {showNewForm && (
        <form onSubmit={handleCreatePO} className="bg-white border border-slate-200 rounded-xl p-6 space-y-4 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-900">Create Raw Material Purchase Order</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Supplier *</label>
              <select required value={newFormData.supplier_id}
                onChange={e => setNewFormData({ ...newFormData, supplier_id: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent">
                <option value="">Select supplier...</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">VAT Rate (%)</label>
              <input type="number" min="0" max="100" step="0.01" value={newFormData.vat_rate}
                onChange={e => setNewFormData({ ...newFormData, vat_rate: parseFloat(e.target.value) || 0 })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
              <textarea rows={2} value={newFormData.notes}
                onChange={e => setNewFormData({ ...newFormData, notes: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
            </div>
          </div>

          <div className="border-t pt-4">
            <div className="flex justify-between items-center mb-3">
              <h4 className="text-sm font-semibold text-slate-900">Raw Materials</h4>
              <button type="button"
                onClick={() => setNewPOItems(p => [...p, { raw_material_id: '', quantity: 0, unit_price: 0 }])}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-green-600 text-white rounded-lg hover:bg-green-700">
                <Plus className="w-3 h-3" /> Add Item
              </button>
            </div>
            {newPOItems.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-4">No items added yet</p>
            ) : (
              <div className="space-y-2">
                {newPOItems.map((item, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-center bg-slate-50 px-3 py-2 rounded-lg">
                    <div className="col-span-5">
                      <select required value={item.raw_material_id}
                        onChange={e => setNewPOItems(p => p.map((it, i) => i === idx ? { ...it, raw_material_id: e.target.value } : it))}
                        className="w-full px-2 py-1.5 text-sm border border-slate-300 rounded">
                        <option value="">Select material...</option>
                        {rawMaterials.map(rm => <option key={rm.id} value={rm.id}>{rm.name} ({rm.unit})</option>)}
                      </select>
                    </div>
                    <div className="col-span-2">
                      <input type="number" step="0.01" placeholder="Qty" required value={item.quantity || ''}
                        onChange={e => setNewPOItems(p => p.map((it, i) => i === idx ? { ...it, quantity: parseFloat(e.target.value) || 0 } : it))}
                        className="w-full px-2 py-1.5 text-sm border border-slate-300 rounded" />
                    </div>
                    <div className="col-span-2">
                      <input type="number" step="0.0001" placeholder="Price" required value={item.unit_price || ''}
                        onChange={e => setNewPOItems(p => p.map((it, i) => i === idx ? { ...it, unit_price: parseFloat(e.target.value) || 0 } : it))}
                        className="w-full px-2 py-1.5 text-sm border border-slate-300 rounded" />
                    </div>
                    <div className="col-span-2 text-sm font-medium text-slate-700 text-right">
                      {(item.quantity * item.unit_price).toFixed(2)}
                    </div>
                    <div className="col-span-1 flex justify-end">
                      <button type="button" onClick={() => setNewPOItems(p => p.filter((_, i) => i !== idx))}
                        className="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
                <div className="flex justify-end pt-2">
                  <div className="w-56 space-y-1 text-sm">
                    <div className="flex justify-between text-slate-600"><span>Subtotal:</span><span>SR {newSubtotal.toFixed(2)}</span></div>
                    <div className="flex justify-between text-slate-600"><span>VAT ({newFormData.vat_rate}%):</span><span>SR {newVat.toFixed(2)}</span></div>
                    <div className="flex justify-between font-bold text-slate-900 border-t pt-1"><span>Total:</span><span>SR {(newSubtotal + newVat).toFixed(2)}</span></div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 border-t pt-4">
            <button type="button" onClick={() => { setShowNewForm(false); setNewPOItems([]); setNewFormData({ supplier_id: '', vat_rate: 15, notes: '' }); }}
              className="px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 rounded-lg">Cancel</button>
            <button type="submit" disabled={saving}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
              <Save className="w-4 h-4" />
              {saving ? 'Creating...' : 'Create PO'}
            </button>
          </div>
        </form>
      )}

      {/* PO Table */}
      {filteredOrders.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <Package className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="font-medium">No purchase orders found</p>
          {hasActiveFilters && <p className="text-sm mt-1">Try clearing your filters</p>}
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">PO Number</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Type</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Supplier</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Status</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">Subtotal</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">VAT</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">Total</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Date</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredOrders.map(po => (
                <tr key={po.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 text-sm font-semibold text-slate-900">{po.po_number}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 text-xs font-medium rounded border ${
                      po.is_daily_op
                        ? 'bg-blue-50 text-blue-700 border-blue-200'
                        : 'bg-slate-50 text-slate-600 border-slate-200'
                    }`}>
                      {po.is_daily_op ? 'Daily Op' : 'Manual'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">{po.supplier.name}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 text-xs font-medium rounded border ${STATUS_BADGE[po.status] || 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                      {STATUS_LABELS[po.status] ?? po.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600 text-right">{po.subtotal.toFixed(2)}</td>
                  <td className="px-4 py-3 text-sm text-slate-500 text-right">{po.vat_amount.toFixed(2)}</td>
                  <td className="px-4 py-3 text-sm font-bold text-slate-900 text-right">SR {po.total.toFixed(2)}</td>
                  <td className="px-4 py-3 text-sm text-slate-500">{new Date(po.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex gap-1 justify-end">
                      <button onClick={() => openPO(po)}
                        className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="View / Edit">
                        <Eye className="w-4 h-4" />
                      </button>
                      <button onClick={() => printPO(po)}
                        className="p-1.5 text-slate-500 hover:bg-slate-100 rounded-lg transition-colors" title="Print">
                        <Printer className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-slate-100 px-4 py-2.5 bg-slate-50 flex justify-between items-center text-xs text-slate-500">
            <span>Showing {filteredOrders.length} of {purchaseOrders.length} purchase orders</span>
            <span className="font-semibold text-slate-700">
              Total: SR {filteredOrders.reduce((s, p) => s + p.total, 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
        </div>
      )}

      {/* Detail / Edit Modal */}
      {selectedPO && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[92vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center z-10">
              <div className="flex items-center gap-3">
                <h3 className="text-xl font-bold text-slate-900">{selectedPO.po_number}</h3>
                <span className={`px-2 py-0.5 text-xs font-medium rounded border ${STATUS_BADGE[selectedPO.status] || ''}`}>
                  {STATUS_LABELS[selectedPO.status] ?? selectedPO.status}
                </span>
                {selectedPO.is_daily_op && (
                  <span className="px-2 py-0.5 text-xs font-medium rounded border bg-blue-50 text-blue-700 border-blue-200">
                    Daily Operation
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                {!editMode && (
                  <>
                    <button onClick={() => printPO(selectedPO)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors">
                      <Printer className="w-4 h-4" /> Print
                    </button>
                    {EDITABLE_STATUSES.has(selectedPO.status) && (
                      <button onClick={() => setEditMode(true)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
                        Edit PO
                      </button>
                    )}
                  </>
                )}
                <button onClick={closeModal} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="p-6 space-y-6">
              {/* Meta fields */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-500 uppercase mb-1">Supplier</label>
                  {editMode ? (
                    <select value={editSupplier} onChange={e => setEditSupplier(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent">
                      {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  ) : (
                    <p className="text-sm font-semibold text-slate-900">{selectedPO.supplier.name}</p>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 uppercase mb-1">Status</label>
                  {editMode ? (
                    <select value={editStatus} onChange={e => setEditStatus(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent">
                      {STATUS_OPTIONS.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                    </select>
                  ) : (
                    <span className={`px-2 py-1 text-xs font-medium rounded border ${STATUS_BADGE[selectedPO.status] || ''}`}>
                      {STATUS_LABELS[selectedPO.status] ?? selectedPO.status}
                    </span>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 uppercase mb-1">VAT Rate (%)</label>
                  {editMode ? (
                    <input type="number" min="0" max="100" step="0.01" value={editVatRate}
                      onChange={e => setEditVatRate(parseFloat(e.target.value) || 0)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
                  ) : (
                    <p className="text-sm font-semibold text-slate-900">{selectedPO.vat_rate}%</p>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 uppercase mb-1">Date</label>
                  <p className="text-sm font-semibold text-slate-900">{new Date(selectedPO.created_at).toLocaleString()}</p>
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-500 uppercase mb-1">Notes</label>
                  {editMode ? (
                    <textarea rows={2} value={editNotes} onChange={e => setEditNotes(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
                  ) : (
                    <p className="text-sm text-slate-700">{selectedPO.notes || '—'}</p>
                  )}
                </div>
              </div>

              {/* Items table */}
              <div className="border-t pt-4">
                <div className="flex justify-between items-center mb-3">
                  <h4 className="font-semibold text-slate-900">Raw Materials</h4>
                  {editMode && (
                    <button type="button"
                      onClick={() => setEditItems(p => [...p, {
                        raw_material_id: '', quantity: 0, unit_price: 0, total: 0, isNew: true
                      }])}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-green-600 text-white rounded-lg hover:bg-green-700">
                      <Plus className="w-3 h-3" /> Add Item
                    </button>
                  )}
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border border-slate-200 rounded">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">Material</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-slate-500">Quantity</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-slate-500">Unit Price</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-slate-500">Total</th>
                      {editMode && <th className="px-3 py-2 w-8" />}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {editItems.filter(i => !i.isDeleted).map((item, idx) => {
                      const realIdx = editItems.indexOf(item);
                      const rm = rawMaterials.find(r => r.id === item.raw_material_id);
                      return (
                        <tr key={idx} className={item.isNew ? 'bg-green-50' : ''}>
                          <td className="px-3 py-2">
                            {editMode ? (
                              <select value={item.raw_material_id}
                                onChange={e => {
                                  const updated = [...editItems];
                                  updated[realIdx] = { ...updated[realIdx], raw_material_id: e.target.value };
                                  setEditItems(updated);
                                }}
                                className="w-full px-2 py-1 text-sm border border-slate-300 rounded">
                                <option value="">Select material...</option>
                                {rawMaterials.map(r => <option key={r.id} value={r.id}>{r.name} ({r.unit})</option>)}
                              </select>
                            ) : (
                              <span>{item.raw_material?.name || '—'}</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {editMode ? (
                              <input type="number" step="0.01" value={item.quantity || ''}
                                onChange={e => {
                                  const updated = [...editItems];
                                  const q = parseFloat(e.target.value) || 0;
                                  updated[realIdx] = { ...updated[realIdx], quantity: q, total: q * updated[realIdx].unit_price };
                                  setEditItems(updated);
                                }}
                                className="w-24 px-2 py-1 text-sm border border-slate-300 rounded text-right" />
                            ) : (
                              `${Number(item.quantity).toFixed(2)} ${rm?.unit || item.raw_material?.unit || ''}`
                            )}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {editMode ? (
                              <input type="number" step="0.0001" value={item.unit_price || ''}
                                onChange={e => {
                                  const updated = [...editItems];
                                  const p = parseFloat(e.target.value) || 0;
                                  updated[realIdx] = { ...updated[realIdx], unit_price: p, total: updated[realIdx].quantity * p };
                                  setEditItems(updated);
                                }}
                                className="w-28 px-2 py-1 text-sm border border-slate-300 rounded text-right" />
                            ) : (
                              `SR ${Number(item.unit_price).toFixed(4)}`
                            )}
                          </td>
                          <td className="px-3 py-2 text-right font-semibold">
                            SR {(item.quantity * item.unit_price).toFixed(2)}
                          </td>
                          {editMode && (
                            <td className="px-3 py-2">
                              <button
                                onClick={() => {
                                  const updated = [...editItems];
                                  if (item.isNew) {
                                    updated.splice(realIdx, 1);
                                  } else {
                                    updated[realIdx] = { ...updated[realIdx], isDeleted: true };
                                  }
                                  setEditItems(updated);
                                }}
                                className="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Totals */}
              <div className="flex justify-end border-t pt-4">
                <div className="w-64 space-y-2 text-sm">
                  <div className="flex justify-between text-slate-600">
                    <span>Subtotal:</span>
                    <span className="font-medium">SR {(editMode ? editSubtotal : selectedPO.subtotal).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>VAT ({editMode ? editVatRate : selectedPO.vat_rate}%):</span>
                    <span className="font-medium">SR {(editMode ? editVatAmount : selectedPO.vat_amount).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between font-bold text-slate-900 border-t pt-2 text-base">
                    <span>Total:</span>
                    <span>SR {(editMode ? editTotal : selectedPO.total).toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {/* Edit actions */}
              {editMode && (
                <div className="flex justify-end gap-2 border-t pt-4">
                  <button onClick={() => { setEditMode(false); setEditItems(selectedPO.raw_material_po_items.map(i => ({ ...i }))); }}
                    className="px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 rounded-lg transition-colors">
                    Cancel
                  </button>
                  <button onClick={handleSavePO} disabled={saving}
                    className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
                    <Save className="w-4 h-4" />
                    {saving ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

