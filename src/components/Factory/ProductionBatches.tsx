import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { Plus, Eye, X, Lock } from 'lucide-react';

interface RawMaterial {
  id: string;
  name: string;
  unit: string;
  current_stock: number;
}

interface Item {
  id: string;
  serial: string;
  name: string;
}

interface InputItem {
  raw_material_id: string;
  quantity: number;
}

interface OutputItem {
  item_id: string;
  quantity: number;
}

interface ProductionBatch {
  id: string;
  batch_number: string;
  production_date: string;
  created_at: string;
  notes: string | null;
  daily_operation_id: string | null;
  production_inputs: ProductionInput[];
  production_outputs: ProductionOutput[];
}

interface ProductionInput {
  id: string;
  raw_material_id: string;
  quantity_used: number;
  raw_material?: { name: string; unit: string };
}

interface ProductionOutput {
  id: string;
  item_id: string;
  quantity_produced: number;
  item?: { serial: string; name: string };
}

export function ProductionBatches() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [batches, setBatches] = useState<ProductionBatch[]>([]);
  const [rawMaterials, setRawMaterials] = useState<RawMaterial[]>([]);
  const [factoryItems, setFactoryItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [selectedBatch, setSelectedBatch] = useState<ProductionBatch | null>(null);
  const [activeTab, setActiveTab] = useState<'daily_op' | 'manual'>('daily_op');

  const [formData, setFormData] = useState({
    production_date: new Date().toISOString().split('T')[0],
    notes: '',
  });
  const [inputs, setInputs] = useState<InputItem[]>([]);
  const [outputs, setOutputs] = useState<OutputItem[]>([]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [batchesRes, rawMaterialsRes, itemsRes] = await Promise.all([
        supabase
          .from('production_batches')
          .select(`
            *,
            production_inputs(*, raw_material:raw_materials(name, unit)),
            production_outputs(*, item:items(serial, name))
          `)
          .order('created_at', { ascending: false }),
        supabase.from('raw_materials').select('*').order('name'),
        supabase.from('items').select('*').eq('category', 'factory').order('serial'),
      ]);

      if (batchesRes.error) throw batchesRes.error;
      if (rawMaterialsRes.error) throw rawMaterialsRes.error;
      if (itemsRes.error) throw itemsRes.error;

      setBatches(batchesRes.data as unknown as ProductionBatch[] || []);
      setRawMaterials(rawMaterialsRes.data || []);
      setFactoryItems(itemsRes.data || []);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (inputs.length === 0) { alert('Please add at least one raw material input'); return; }
    if (outputs.length === 0) { alert('Please add at least one factory item output'); return; }

    try {
      const { data: batch, error: batchError } = await supabase
        .from('production_batches')
        .insert([{ production_date: formData.production_date, created_by: user?.id, notes: formData.notes }])
        .select().single();
      if (batchError) throw batchError;

      const { error: inputsError } = await supabase.from('production_inputs').insert(
        inputs.map(i => ({ batch_id: batch.id, raw_material_id: i.raw_material_id, quantity_used: i.quantity }))
      );
      if (inputsError) throw inputsError;

      const { error: outputsError } = await supabase.from('production_outputs').insert(
        outputs.map(o => ({ batch_id: batch.id, item_id: o.item_id, quantity_produced: o.quantity }))
      );
      if (outputsError) throw outputsError;

      setShowForm(false);
      setFormData({ production_date: new Date().toISOString().split('T')[0], notes: '' });
      setInputs([]);
      setOutputs([]);
      loadData();
    } catch (error) {
      console.error('Error creating production batch:', error);
      alert('Error recording production batch');
    }
  };

  if (loading) return <div className="text-center py-8">Loading...</div>;

  const dailyOpBatches = batches.filter(b => b.daily_operation_id !== null);
  const manualBatches = batches.filter(b => b.daily_operation_id === null);
  const displayedBatches = activeTab === 'daily_op' ? dailyOpBatches : manualBatches;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-slate-900">{t('production_batches')}</h2>
        {activeTab === 'manual' && (
          <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
            <Plus className="w-4 h-4" />
            {t('record_production')}
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200">
        <button
          onClick={() => setActiveTab('daily_op')}
          className={`px-5 py-3 text-sm font-medium transition-colors ${activeTab === 'daily_op' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-600 hover:text-slate-900'}`}
        >
          Daily Operation Batches
          {dailyOpBatches.length > 0 && <span className="ml-2 px-1.5 py-0.5 text-xs bg-blue-100 text-blue-700 rounded-full">{dailyOpBatches.length}</span>}
        </button>
        <button
          onClick={() => setActiveTab('manual')}
          className={`px-5 py-3 text-sm font-medium transition-colors ${activeTab === 'manual' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-600 hover:text-slate-900'}`}
        >
          Manual Batches
          {manualBatches.length > 0 && <span className="ml-2 px-1.5 py-0.5 text-xs bg-slate-100 text-slate-600 rounded-full">{manualBatches.length}</span>}
        </button>
      </div>

      {activeTab === 'daily_op' && (
        <div className="flex items-center gap-2 text-sm text-slate-600 bg-blue-50 border border-blue-100 rounded-lg px-4 py-2.5">
          <Lock className="w-4 h-4 text-blue-500" />
          These production records were automatically created by submitted daily operations and are read-only.
        </div>
      )}

      {/* Manual form */}
      {activeTab === 'manual' && showForm && (
        <form onSubmit={handleSubmit} className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
          <h3 className="text-lg font-semibold text-slate-900">Record Production Batch</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Production Date *</label>
              <input type="date" value={formData.production_date} onChange={e => setFormData({ ...formData, production_date: e.target.value })} required className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
              <textarea value={formData.notes} onChange={e => setFormData({ ...formData, notes: e.target.value })} rows={2} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
            </div>
          </div>

          <div className="border-t pt-4">
            <div className="flex justify-between items-center mb-3">
              <h4 className="font-semibold text-slate-900">Raw Materials Used (Inputs)</h4>
              <button type="button" onClick={() => setInputs(prev => [...prev, { raw_material_id: '', quantity: 0 }])} className="text-sm px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700">Add Raw Material</button>
            </div>
            {inputs.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-4">No raw materials added yet</p>
            ) : inputs.map((input, index) => {
              const selectedRM = input.raw_material_id ? rawMaterials.find(rm => rm.id === input.raw_material_id) : null;
              return (
                <div key={index} className="grid grid-cols-12 gap-2 items-start bg-red-50 p-3 rounded mb-2">
                  <div className="col-span-8">
                    <select value={input.raw_material_id} onChange={e => setInputs(prev => prev.map((it, i) => i === index ? { ...it, raw_material_id: e.target.value } : it))} required className="w-full px-2 py-1 text-sm border border-slate-300 rounded">
                      <option value="">Select raw material...</option>
                      {rawMaterials.map(rm => <option key={rm.id} value={rm.id}>{rm.name} (Stock: {Math.round(rm.current_stock)} {rm.unit})</option>)}
                    </select>
                  </div>
                  <div className="col-span-3">
                    <input type="number" step="1" value={input.quantity || ''} onChange={e => setInputs(prev => prev.map((it, i) => i === index ? { ...it, quantity: parseFloat(e.target.value) || 0 } : it))} placeholder={`Qty (${selectedRM?.unit || 'units'})`} required className="w-full px-2 py-1 text-sm border border-slate-300 rounded" />
                  </div>
                  <div className="col-span-1">
                    <button type="button" onClick={() => setInputs(prev => prev.filter((_, i) => i !== index))} className="p-1 text-red-600 hover:bg-red-100 rounded"><X className="w-4 h-4" /></button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="border-t pt-4">
            <div className="flex justify-between items-center mb-3">
              <h4 className="font-semibold text-slate-900">Factory Items Produced (Outputs)</h4>
              <button type="button" onClick={() => setOutputs(prev => [...prev, { item_id: '', quantity: 0 }])} className="text-sm px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700">Add Item</button>
            </div>
            {outputs.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-4">No output items added yet</p>
            ) : outputs.map((output, index) => (
              <div key={index} className="grid grid-cols-12 gap-2 items-start bg-green-50 p-3 rounded mb-2">
                <div className="col-span-8">
                  <select value={output.item_id} onChange={e => setOutputs(prev => prev.map((it, i) => i === index ? { ...it, item_id: e.target.value } : it))} required className="w-full px-2 py-1 text-sm border border-slate-300 rounded">
                    <option value="">Select factory item...</option>
                    {factoryItems.map(item => <option key={item.id} value={item.id}>{item.serial} - {item.name}</option>)}
                  </select>
                </div>
                <div className="col-span-3">
                  <input type="number" step="1" value={output.quantity || ''} onChange={e => setOutputs(prev => prev.map((it, i) => i === index ? { ...it, quantity: parseFloat(e.target.value) || 0 } : it))} placeholder="Quantity" required className="w-full px-2 py-1 text-sm border border-slate-300 rounded" />
                </div>
                <div className="col-span-1">
                  <button type="button" onClick={() => setOutputs(prev => prev.filter((_, i) => i !== index))} className="p-1 text-red-600 hover:bg-red-100 rounded"><X className="w-4 h-4" /></button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-2 border-t pt-4">
            <button type="button" onClick={() => { setShowForm(false); setInputs([]); setOutputs([]); }} className="px-4 py-2 text-slate-700 hover:bg-slate-100 rounded-lg">Cancel</button>
            <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">{t('record_production')}</button>
          </div>
        </form>
      )}

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">{t('batch_number')}</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">{t('production_date')}</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">{t('inputs')}</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">{t('outputs')}</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">{t('created')}</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">{t('actions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {displayedBatches.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">{t('no_production_batches_found')}</td></tr>
            ) : displayedBatches.map((batch) => (
              <tr key={batch.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-sm font-medium text-slate-900">
                  <div className="flex items-center gap-2">
                    {batch.daily_operation_id && <Lock className="w-3 h-3 text-slate-400" />}
                    {batch.batch_number}
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-slate-600">{new Date(batch.production_date).toLocaleDateString()}</td>
                <td className="px-4 py-3 text-sm text-slate-600">{batch.production_inputs.length} items</td>
                <td className="px-4 py-3 text-sm text-slate-600">{batch.production_outputs.length} items</td>
                <td className="px-4 py-3 text-sm text-slate-600">{new Date(batch.created_at).toLocaleDateString()}</td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => setSelectedBatch(batch)} className="p-1 text-blue-600 hover:bg-blue-50 rounded transition-colors" title="View Details">
                    <Eye className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedBatch && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center">
              <div className="flex items-center gap-3">
                <h3 className="text-xl font-bold text-slate-900">{selectedBatch.batch_number}</h3>
                {selectedBatch.daily_operation_id && (
                  <span className="flex items-center gap-1 text-xs px-2 py-1 bg-blue-50 text-blue-700 border border-blue-200 rounded font-medium">
                    <Lock className="w-3 h-3" /> Daily Operation
                  </span>
                )}
              </div>
              <button onClick={() => setSelectedBatch(null)} className="p-2 hover:bg-slate-100 rounded-lg"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div><span className="text-slate-600">Production Date:</span><p className="font-medium">{new Date(selectedBatch.production_date).toLocaleDateString()}</p></div>
                <div><span className="text-slate-600">Created:</span><p className="font-medium">{new Date(selectedBatch.created_at).toLocaleString()}</p></div>
                {selectedBatch.notes && <div className="col-span-2"><span className="text-slate-600">Notes:</span><p className="font-medium">{selectedBatch.notes}</p></div>}
              </div>

              <div className="border-t pt-4">
                <h4 className="font-semibold text-slate-900 mb-3 text-red-700">Raw Materials Used (Inputs)</h4>
                <table className="w-full text-sm">
                  <thead className="bg-red-50">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">Material</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-slate-500">Quantity Used</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {selectedBatch.production_inputs.map((input) => (
                      <tr key={input.id}>
                        <td className="px-3 py-2">{input.raw_material?.name || input.raw_material_id}</td>
                        <td className="px-3 py-2 text-right font-medium">{Math.round(Number(input.quantity_used))} {input.raw_material?.unit || ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="border-t pt-4">
                <h4 className="font-semibold text-slate-900 mb-3 text-green-700">Factory Items Produced (Outputs)</h4>
                <table className="w-full text-sm">
                  <thead className="bg-green-50">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">Item</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-slate-500">Quantity Produced</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {selectedBatch.production_outputs.map((output) => (
                      <tr key={output.id}>
                        <td className="px-3 py-2">{output.item ? `${output.item.serial} — ${output.item.name}` : output.item_id}</td>
                        <td className="px-3 py-2 text-right font-medium">{Math.round(Number(output.quantity_produced))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
