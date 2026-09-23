import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { AlertTriangle, CheckCircle, Save, RotateCcw, ChevronDown, ChevronUp } from 'lucide-react';

type AdjustmentMode = 'factory_item' | 'raw_material';

interface FactoryItemRow {
  id: string;
  serial: string;
  name: string;
  current_stock: number;
  new_stock: string;
  dirty: boolean;
}

interface RawMaterialRow {
  id: string;
  name: string;
  unit: string;
  current_stock: number;
  new_stock: string;
  dirty: boolean;
}

interface HistoryEntry {
  id: string;
  item_id: string | null;
  raw_material_id: string | null;
  adjustment_type: string;
  quantity_before: number;
  quantity_after: number;
  difference: number;
  reason: string;
  created_at: string;
  adjusted_by_profile: { display_name: string } | null;
}

export function FactoryStockAdjustments() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [mode, setMode] = useState<AdjustmentMode>('factory_item');
  const [factoryRows, setFactoryRows] = useState<FactoryItemRow[]>([]);
  const [rmRows, setRmRows] = useState<RawMaterialRow[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reason, setReason] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  const showToast = (type: 'success' | 'error', msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4000);
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      // Load items and raw materials independently from history to avoid
      // a profiles RLS error blocking the main data.
      const [itemsRes, stockRes, rmRes] = await Promise.all([
        supabase.from('items').select('id, serial, name').eq('category', 'factory').order('order_index', { ascending: true }),
        supabase.from('factory_stock').select('item_id, current_stock'),
        supabase.from('raw_materials').select('id, name, unit, current_stock').order('name'),
      ]);

      if (itemsRes.error) throw itemsRes.error;
      if (rmRes.error) throw rmRes.error;

      const stockMap = new Map(
        (stockRes.data || []).map((s: { item_id: string; current_stock: number }) => [s.item_id, Number(s.current_stock)])
      );

      setFactoryRows(
        (itemsRes.data || []).map((item: { id: string; serial: string; name: string }) => ({
          id: item.id,
          serial: item.serial,
          name: item.name,
          current_stock: stockMap.get(item.id) ?? 0,
          new_stock: '',
          dirty: false,
        }))
      );

      setRmRows(
        (rmRes.data || []).map((rm: { id: string; name: string; unit: string; current_stock: number }) => ({
          id: rm.id,
          name: rm.name,
          unit: rm.unit,
          current_stock: Number(rm.current_stock),
          new_stock: '',
          dirty: false,
        }))
      );
    } catch (err) {
      console.error('Error loading stock data:', err);
      showToast('error', 'Failed to load data');
    } finally {
      setLoading(false);
    }

    // Load history separately — a join failure here must not affect item lists
    try {
      const histRes = await supabase
        .from('stock_adjustments')
        .select('*, adjusted_by_profile:profiles!stock_adjustments_adjusted_by_fkey(display_name)')
        .in('adjustment_type', ['factory', 'raw_material'])
        .order('created_at', { ascending: false })
        .limit(50);
      if (!histRes.error) {
        setHistory(histRes.data as unknown as HistoryEntry[] || []);
      }
    } catch {
      // history is non-critical
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const dirtyFactory = factoryRows.filter(r => r.dirty && r.new_stock !== '');
  const dirtyRm = rmRows.filter(r => r.dirty && r.new_stock !== '');
  const hasDirty = mode === 'factory_item' ? dirtyFactory.length > 0 : dirtyRm.length > 0;

  const handleFactoryChange = (id: string, val: string) => {
    setFactoryRows(prev => prev.map(r => r.id === id ? { ...r, new_stock: val, dirty: true } : r));
  };

  const handleRmChange = (id: string, val: string) => {
    setRmRows(prev => prev.map(r => r.id === id ? { ...r, new_stock: val, dirty: true } : r));
  };

  const resetDirty = () => {
    setFactoryRows(prev => prev.map(r => ({ ...r, new_stock: '', dirty: false })));
    setRmRows(prev => prev.map(r => ({ ...r, new_stock: '', dirty: false })));
    setReason('');
  };

  const handleSave = async () => {
    setSaving(true);
    setShowConfirm(false);
    try {
      if (mode === 'factory_item') {
        for (const row of dirtyFactory) {
          const newQty = parseFloat(row.new_stock);
          if (isNaN(newQty)) continue;
          const diff = newQty - row.current_stock;
          const { error: adjErr } = await supabase.from('stock_adjustments').insert([{
            adjustment_type: 'factory',
            item_id: row.id,
            reference_id: row.id,
            quantity_before: row.current_stock,
            quantity_after: newQty,
            difference: diff,
            reason,
            adjusted_by: user?.id,
          }]);
          if (adjErr) throw adjErr;
          const { error: stockErr } = await supabase
            .from('factory_stock')
            .upsert({ item_id: row.id, current_stock: newQty, updated_at: new Date().toISOString() }, { onConflict: 'item_id' });
          if (stockErr) throw stockErr;
        }
      } else {
        for (const row of dirtyRm) {
          const newQty = parseFloat(row.new_stock);
          if (isNaN(newQty)) continue;
          const diff = newQty - row.current_stock;
          const { error: adjErr } = await supabase.from('stock_adjustments').insert([{
            adjustment_type: 'raw_material',
            raw_material_id: row.id,
            reference_id: row.id,
            quantity_before: row.current_stock,
            quantity_after: newQty,
            difference: diff,
            reason,
            adjusted_by: user?.id,
          }]);
          if (adjErr) throw adjErr;
          const { error: rmErr } = await supabase.from('raw_materials').update({ current_stock: newQty }).eq('id', row.id);
          if (rmErr) throw rmErr;
        }
      }

      showToast('success', `Stock adjustments saved successfully`);
      resetDirty();
      loadData();
    } catch (err) {
      console.error(err);
      showToast('error', 'Failed to save adjustments');
    } finally {
      setSaving(false);
    }
  };

  const getHistoryName = (entry: HistoryEntry): string => {
    if (entry.adjustment_type === 'factory' && entry.item_id) {
      const row = factoryRows.find(r => r.id === entry.item_id);
      return row ? `${row.serial} — ${row.name}` : entry.item_id.substring(0, 8) + '…';
    }
    if (entry.adjustment_type === 'raw_material' && entry.raw_material_id) {
      const row = rmRows.find(r => r.id === entry.raw_material_id);
      return row ? row.name : entry.raw_material_id.substring(0, 8) + '…';
    }
    return '—';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-600" />
      </div>
    );
  }

  const pendingCount = mode === 'factory_item' ? dirtyFactory.length : dirtyRm.length;

  return (
    <div className="space-y-6">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg text-white text-sm font-medium transition-all ${toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'}`}>
          <CheckCircle className="w-4 h-4 flex-shrink-0" />
          {toast.msg}
        </div>
      )}

      {/* Confirmation modal */}
      {showConfirm && (
        <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full space-y-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-6 h-6 text-amber-500 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Confirm Stock Adjustment</h3>
                <p className="text-sm text-slate-600 mt-1">
                  You are about to adjust <strong>{pendingCount} {mode === 'factory_item' ? 'item(s)' : 'raw material(s)'}</strong>. This action will permanently update the stock levels.
                </p>
              </div>
            </div>

            <div className="bg-slate-50 rounded-lg p-3 space-y-1 max-h-48 overflow-y-auto text-sm">
              {mode === 'factory_item'
                ? dirtyFactory.map(r => {
                    const nq = parseFloat(r.new_stock);
                    const diff = isNaN(nq) ? 0 : nq - r.current_stock;
                    return (
                      <div key={r.id} className="flex justify-between">
                        <span className="text-slate-700">{r.serial} — {r.name}</span>
                        <span className={`font-medium ${diff >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                          {Math.round(r.current_stock)} → {isNaN(nq) ? '?' : Math.round(nq)} ({diff >= 0 ? '+' : ''}{Math.round(diff)})
                        </span>
                      </div>
                    );
                  })
                : dirtyRm.map(r => {
                    const nq = parseFloat(r.new_stock);
                    const diff = isNaN(nq) ? 0 : nq - r.current_stock;
                    return (
                      <div key={r.id} className="flex justify-between">
                        <span className="text-slate-700">{r.name}</span>
                        <span className={`font-medium ${diff >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                          {Math.round(r.current_stock)} → {isNaN(nq) ? '?' : Math.round(nq)} {r.unit} ({diff >= 0 ? '+' : ''}{Math.round(diff)})
                        </span>
                      </div>
                    );
                  })
              }
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Reason *</label>
              <textarea
                value={reason}
                onChange={e => setReason(e.target.value)}
                rows={3}
                placeholder="e.g. Physical count discrepancy, damaged goods..."
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-orange-500 focus:border-transparent"
              />
            </div>

            <div className="flex gap-3 justify-end pt-2">
              <button
                onClick={() => setShowConfirm(false)}
                className="px-4 py-2 text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 text-sm transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!reason.trim() || saving}
                className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm transition-colors font-medium"
              >
                {saving ? 'Saving…' : 'Confirm & Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-slate-900">{t('stock_adjustments')}</h2>
        <div className="flex gap-2">
          {hasDirty && (
            <button
              onClick={resetDirty}
              className="flex items-center gap-2 px-3 py-2 text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50 text-sm transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              Reset
            </button>
          )}
          <button
            onClick={() => setShowConfirm(true)}
            disabled={!hasDirty}
            className="flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium transition-colors"
          >
            <Save className="w-4 h-4" />
            Save Adjustments {hasDirty ? `(${pendingCount})` : ''}
          </button>
        </div>
      </div>

      {/* Warning */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
        <p className="text-sm text-amber-800">
          <strong>{t('important')}:</strong> {t('adjustment_warning_full')}
        </p>
      </div>

      {/* Mode toggle */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="flex border-b border-slate-200">
          {(['factory_item', 'raw_material'] as AdjustmentMode[]).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex-1 py-3 text-sm font-medium transition-colors ${
                mode === m
                  ? 'bg-orange-50 text-orange-700 border-b-2 border-orange-600'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              {m === 'factory_item' ? 'Factory Items' : 'Raw Materials'}
            </button>
          ))}
        </div>

        {/* Factory Items table */}
        {mode === 'factory_item' && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Serial</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Item Name</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">Current Stock</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide w-40">Correct Stock</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">Difference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {factoryRows.map(row => {
                  const nq = row.new_stock !== '' ? parseFloat(row.new_stock) : NaN;
                  const diff = !isNaN(nq) ? nq - row.current_stock : null;
                  return (
                    <tr key={row.id} className={`transition-colors ${row.dirty && row.new_stock !== '' ? 'bg-orange-50/40' : 'hover:bg-slate-50'}`}>
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{row.serial}</td>
                      <td className="px-4 py-2.5 font-medium text-slate-900">{row.name}</td>
                      <td className="px-4 py-2.5 text-right text-slate-700 tabular-nums">{Math.round(row.current_stock)}</td>
                      <td className="px-4 py-2.5">
                        <input
                          type="number"
                          step="1"
                          min="0"
                          value={row.new_stock}
                          onChange={e => handleFactoryChange(row.id, e.target.value)}
                          placeholder="—"
                          className={`w-full px-2.5 py-1.5 border rounded-lg text-right text-sm tabular-nums focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-colors ${
                            row.dirty && row.new_stock !== '' ? 'border-orange-400 bg-white' : 'border-slate-300 bg-white'
                          }`}
                        />
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {diff !== null ? (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${diff >= 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                            {diff >= 0 ? '+' : ''}{Math.round(diff)}
                          </span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Raw Materials table */}
        {mode === 'raw_material' && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Raw Material</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Unit</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">Current Stock</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide w-40">Correct Stock</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">Difference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rmRows.map(row => {
                  const nq = row.new_stock !== '' ? parseFloat(row.new_stock) : NaN;
                  const diff = !isNaN(nq) ? nq - row.current_stock : null;
                  return (
                    <tr key={row.id} className={`transition-colors ${row.dirty && row.new_stock !== '' ? 'bg-orange-50/40' : 'hover:bg-slate-50'}`}>
                      <td className="px-4 py-2.5 font-medium text-slate-900">{row.name}</td>
                      <td className="px-4 py-2.5 text-slate-500">{row.unit}</td>
                      <td className="px-4 py-2.5 text-right text-slate-700 tabular-nums">{Math.round(row.current_stock)}</td>
                      <td className="px-4 py-2.5">
                        <input
                          type="number"
                          step="1"
                          min="0"
                          value={row.new_stock}
                          onChange={e => handleRmChange(row.id, e.target.value)}
                          placeholder="—"
                          className={`w-full px-2.5 py-1.5 border rounded-lg text-right text-sm tabular-nums focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-colors ${
                            row.dirty && row.new_stock !== '' ? 'border-orange-400 bg-white' : 'border-slate-300 bg-white'
                          }`}
                        />
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {diff !== null ? (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${diff >= 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                            {diff >= 0 ? '+' : ''}{Math.round(diff)}
                          </span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Adjustment History (collapsible) */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <button
          onClick={() => setShowHistory(v => !v)}
          className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-50 transition-colors"
        >
          <h3 className="text-base font-semibold text-slate-900">{t('adjustment_history')}</h3>
          {showHistory ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
        </button>

        {showHistory && (
          <div className="overflow-x-auto border-t border-slate-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">{t('date')}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">{t('type')}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">{t('item_material')}</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase">{t('old_stock')}</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase">{t('new_stock')}</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase">{t('difference')}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">{t('reason')}</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">{t('by')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {history.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400 text-sm">{t('no_adjustments_recorded')}</td></tr>
                ) : (
                  history.map(entry => (
                    <tr key={entry.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">{new Date(entry.created_at).toLocaleString()}</td>
                      <td className="px-4 py-2.5">
                        <span className={`px-2 py-0.5 text-xs font-medium rounded ${entry.adjustment_type === 'factory' ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-700'}`}>
                          {entry.adjustment_type === 'factory' ? 'Factory Item' : 'Raw Material'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-medium text-slate-900">{getHistoryName(entry)}</td>
                      <td className="px-4 py-2.5 text-right text-slate-600 tabular-nums">{Math.round(Number(entry.quantity_before))}</td>
                      <td className="px-4 py-2.5 text-right text-slate-600 tabular-nums">{Math.round(Number(entry.quantity_after))}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        <span className={`px-2 py-0.5 text-xs font-semibold rounded ${entry.difference >= 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                          {entry.difference >= 0 ? '+' : ''}{Math.round(Number(entry.difference))}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-slate-600 max-w-xs truncate">{entry.reason}</td>
                      <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">{entry.adjusted_by_profile?.display_name || 'Unknown'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
