import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { Plus, CreditCard as Edit2, Trash2 } from 'lucide-react';

interface RawMaterial {
  id: string;
  name: string;
  description: string | null;
  unit: string;
  minimum_stock_level: number;
  current_stock: number;
  supplier_id: string | null;
  created_at: string;
}

interface Supplier {
  id: string;
  name: string;
  type: string;
}

export function RawMaterialManagement() {
  const [rawMaterials, setRawMaterials] = useState<RawMaterial[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    unit: '',
    minimum_stock_level: 0,
    supplier_id: '',
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [rmRes, suppRes] = await Promise.all([
        supabase.from('raw_materials').select('*').order('name'),
        supabase.from('suppliers').select('id, name, type').in('type', ['raw_material', 'both']).order('name'),
      ]);
      if (rmRes.error) throw rmRes.error;
      if (suppRes.error) throw suppRes.error;
      setRawMaterials(rmRes.data || []);
      setSuppliers(suppRes.data || []);
    } catch (error) {
      console.error('Error loading raw materials:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = {
        name: formData.name,
        description: formData.description,
        unit: formData.unit,
        minimum_stock_level: formData.minimum_stock_level,
        supplier_id: formData.supplier_id || null,
      };
      if (editingId) {
        const { error } = await supabase.from('raw_materials').update(payload).eq('id', editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('raw_materials').insert([{ ...payload, current_stock: 0 }]);
        if (error) throw error;
      }
      setShowForm(false);
      setEditingId(null);
      setFormData({ name: '', description: '', unit: '', minimum_stock_level: 0, supplier_id: '' });
      loadData();
    } catch (error) {
      console.error('Error saving raw material:', error);
      alert('Error saving raw material');
    }
  };

  const handleEdit = (material: RawMaterial) => {
    setFormData({
      name: material.name,
      description: material.description || '',
      unit: material.unit,
      minimum_stock_level: material.minimum_stock_level,
      supplier_id: material.supplier_id || '',
    });
    setEditingId(material.id);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this raw material?')) return;
    try {
      const { error } = await supabase.from('raw_materials').delete().eq('id', id);
      if (error) throw error;
      loadData();
    } catch (error) {
      console.error('Error deleting raw material:', error);
      alert('Error deleting raw material');
    }
  };

  const supplierMap = new Map(suppliers.map(s => [s.id, s.name]));

  if (loading) return <div className="text-center py-8">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-slate-900">Raw Material Management</h2>
        <button
          onClick={() => { setShowForm(true); setEditingId(null); setFormData({ name: '', description: '', unit: '', minimum_stock_level: 0, supplier_id: '' }); }}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Raw Material
        </button>
      </div>

      {showForm && (
        <div className="bg-white border border-slate-200 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-slate-900 mb-4">
            {editingId ? 'Edit Raw Material' : 'New Raw Material'}
          </h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Name *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Unit *</label>
                <input
                  type="text"
                  value={formData.unit}
                  onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                  required
                  placeholder="e.g., kg, pcs, box"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Supplier</label>
                <select
                  value={formData.supplier_id}
                  onChange={(e) => setFormData({ ...formData, supplier_id: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">No supplier assigned</option>
                  {suppliers.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Minimum Stock Level *</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.minimum_stock_level}
                  onChange={(e) => setFormData({ ...formData, minimum_stock_level: parseFloat(e.target.value) || 0 })}
                  required
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => { setShowForm(false); setEditingId(null); }} className="px-4 py-2 text-slate-700 hover:bg-slate-100 rounded-lg transition-colors">
                Cancel
              </button>
              <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
                {editingId ? 'Update' : 'Create'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Name</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Supplier</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Unit</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Current Stock</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Min Level</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {rawMaterials.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">No raw materials found.</td></tr>
            ) : rawMaterials.map((material) => (
              <tr key={material.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-sm font-medium text-slate-900">{material.name}</td>
                <td className="px-4 py-3 text-sm text-slate-600">
                  {material.supplier_id ? supplierMap.get(material.supplier_id) || '-' : <span className="text-slate-400 italic">Unassigned</span>}
                </td>
                <td className="px-4 py-3 text-sm text-slate-600">{material.unit}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-1 text-xs font-medium rounded ${material.current_stock <= material.minimum_stock_level ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`}>
                    {Math.round(material.current_stock)} {material.unit}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-slate-600">{Math.round(material.minimum_stock_level)} {material.unit}</td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-2">
                    <button onClick={() => handleEdit(material)} className="p-1 text-blue-600 hover:bg-blue-50 rounded transition-colors"><Edit2 className="w-4 h-4" /></button>
                    <button onClick={() => handleDelete(material.id)} className="p-1 text-red-600 hover:bg-red-50 rounded transition-colors"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
