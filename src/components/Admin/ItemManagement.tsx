import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { useLanguage } from '../../contexts/LanguageContext';
import { useAuth } from '../../contexts/AuthContext';
import { Pencil, Trash2, Download, Upload, Image, X, ChevronUp, ChevronDown, Save, AlertTriangle, Plus } from 'lucide-react';
import { downloadItemsTemplate, parseItemsExcel } from '../../utils/excelTemplates';

interface Item {
  id: string;
  serial: string;
  name: string;
  description: string;
  category: 'warehouse' | 'factory';
  stock_level_required: boolean;
  picture_url: string | null;
  order_index: number;
  created_at: string;
}

async function compressImage(file: File, maxSizeKB = 550): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = document.createElement('img');
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      let { width, height } = img;
      const maxDim = 1200;
      if (width > maxDim || height > maxDim) {
        const ratio = Math.min(maxDim / width, maxDim / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, width, height);
      let quality = 0.85;
      const tryCompress = () => {
        canvas.toBlob(
          (blob) => {
            if (!blob) return reject(new Error('Compression failed'));
            if (blob.size <= maxSizeKB * 1024 || quality <= 0.1) {
              resolve(blob);
            } else {
              quality -= 0.1;
              tryCompress();
            }
          },
          'image/jpeg',
          quality
        );
      };
      tryCompress();
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = url;
  });
}

const emptyForm = {
  serial: '',
  name: '',
  description: '',
  category: 'warehouse' as 'warehouse' | 'factory',
  stock_level_required: false,
};

const emptyWarehouseUnits = {
  purchase_unit: '',
  sale_unit: '',
  purchase_to_sale_ratio: 1,
  minimum_stock_purchase_units: 0,
};

export function ItemManagement() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Item | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [formData, setFormData] = useState(emptyForm);
  const [warehouseUnits, setWarehouseUnits] = useState(emptyWarehouseUnits);
  const [factoryMinStock, setFactoryMinStock] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [uploadingPicture, setUploadingPicture] = useState(false);
  const [pictureFile, setPictureFile] = useState<File | null>(null);
  const [picturePreview, setPicturePreview] = useState<string | null>(null);
  const [rankingMode, setRankingMode] = useState(false);
  const [rankingCategory, setRankingCategory] = useState<'warehouse' | 'factory'>('warehouse');
  const [savingRanks, setSavingRanks] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pictureInputRef = useRef<HTMLInputElement>(null);
  const { t } = useLanguage();
  const { user } = useAuth();

  useEffect(() => { loadItems(); }, []);

  const showToast = (type: 'success' | 'error', msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4000);
  };

  const loadItems = async () => {
    try {
      const { data, error } = await supabase
        .from('items')
        .select('*')
        .order('category')
        .order('order_index', { ascending: true });
      if (error) throw error;
      setItems(data || []);
    } catch (error) {
      console.error('Error loading items:', error);
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormData(emptyForm);
    setWarehouseUnits(emptyWarehouseUnits);
    setFactoryMinStock(0);
    setPictureFile(null);
    setPicturePreview(null);
  };

  const openCreate = () => {
    resetForm();
    setShowCreateModal(true);
  };

  const openEdit = async (item: Item) => {
    setEditingItem(item);
    setFormData({
      serial: item.serial,
      name: item.name,
      description: item.description,
      category: item.category,
      stock_level_required: item.stock_level_required || false,
    });
    setPicturePreview(item.picture_url || null);
    setPictureFile(null);

    if (item.category === 'warehouse') {
      const { data } = await supabase
        .from('warehouse_units')
        .select('*')
        .eq('item_id', item.id)
        .maybeSingle();
      if (data) {
        setWarehouseUnits({
          purchase_unit: data.purchase_unit,
          sale_unit: data.sale_unit,
          purchase_to_sale_ratio: data.purchase_to_sale_ratio,
          minimum_stock_purchase_units: data.minimum_stock_purchase_units,
        });
      } else {
        setWarehouseUnits(emptyWarehouseUnits);
      }
    } else {
      const { data } = await supabase
        .from('factory_stock')
        .select('minimum_stock_level')
        .eq('item_id', item.id)
        .maybeSingle();
      setFactoryMinStock(data?.minimum_stock_level ?? 0);
    }

    setShowEditModal(true);
  };

  const closeModals = () => {
    setShowEditModal(false);
    setShowCreateModal(false);
    setDeleteTarget(null);
    setEditingItem(null);
    resetForm();
  };

  const handlePictureChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPictureFile(file);
    setPicturePreview(URL.createObjectURL(file));
  };

  const uploadPicture = async (itemId: string): Promise<string | null> => {
    if (!pictureFile) return null;
    setUploadingPicture(true);
    try {
      const compressed = await compressImage(pictureFile, 550);
      const path = `${itemId}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from('item-images')
        .upload(path, compressed, { upsert: true, contentType: 'image/jpeg' });
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from('item-images').getPublicUrl(path);
      return data.publicUrl + `?t=${Date.now()}`;
    } finally {
      setUploadingPicture(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.serial.trim()) return;
    setSubmitting(true);
    try {
      const { data: existing } = await supabase
        .from('items').select('id').eq('serial', formData.serial).maybeSingle();
      if (existing) {
        showToast('error', `Item code "${formData.serial}" is already in use`);
        return;
      }

      const { data: newItem, error } = await supabase
        .from('items')
        .insert([{ ...formData, created_by: user?.id }])
        .select()
        .single();
      if (error) throw error;

      let pictureUrl: string | null = null;
      if (pictureFile && newItem) {
        pictureUrl = await uploadPicture(newItem.id);
        if (pictureUrl) {
          await supabase.from('items').update({ picture_url: pictureUrl }).eq('id', newItem.id);
        }
      }

      if (newItem && formData.category === 'warehouse' && warehouseUnits.purchase_unit && warehouseUnits.sale_unit) {
        await supabase.from('warehouse_units').insert([{ item_id: newItem.id, ...warehouseUnits }]);
      } else if (newItem && formData.category === 'factory') {
        await supabase.from('factory_stock').update({ minimum_stock_level: factoryMinStock }).eq('item_id', newItem.id);
      }

      showToast('success', 'Item created successfully');
      closeModals();
      await loadItems();
    } catch (error) {
      console.error('Error creating item:', error);
      showToast('error', error instanceof Error ? error.message : t('error'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem || !formData.serial.trim()) return;
    setSubmitting(true);
    try {
      if (formData.serial !== editingItem.serial) {
        const { data: existing } = await supabase
          .from('items').select('id').eq('serial', formData.serial).neq('id', editingItem.id).maybeSingle();
        if (existing) {
          showToast('error', `Item code "${formData.serial}" is already in use`);
          return;
        }
      }

      let pictureUrl = editingItem.picture_url;
      if (pictureFile) pictureUrl = await uploadPicture(editingItem.id);

      const { error } = await supabase
        .from('items')
        .update({ ...formData, picture_url: pictureUrl })
        .eq('id', editingItem.id);
      if (error) throw error;

      if (formData.category === 'warehouse' && warehouseUnits.purchase_unit && warehouseUnits.sale_unit) {
        await supabase.from('warehouse_units').update(warehouseUnits).eq('item_id', editingItem.id);
      } else if (formData.category === 'factory') {
        await supabase.from('factory_stock').update({ minimum_stock_level: factoryMinStock }).eq('item_id', editingItem.id);
      }

      showToast('success', 'Item updated successfully');
      closeModals();
      await loadItems();
    } catch (error) {
      console.error('Error updating item:', error);
      showToast('error', error instanceof Error ? error.message : t('error'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const { error } = await supabase.from('items').delete().eq('id', deleteTarget.id);
      if (error) throw error;
      showToast('success', 'Item deleted successfully');
      setDeleteTarget(null);
      await loadItems();
    } catch (error) {
      console.error('Error deleting item:', error);
      showToast('error', error instanceof Error ? error.message : t('error'));
    } finally {
      setDeleting(false);
    }
  };

  const moveItem = (itemId: string, direction: 'up' | 'down') => {
    const catItems = items.filter(i => i.category === rankingCategory);
    const idx = catItems.findIndex(i => i.id === itemId);
    if (direction === 'up' && idx === 0) return;
    if (direction === 'down' && idx === catItems.length - 1) return;
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    const newCatItems = [...catItems];
    [newCatItems[idx], newCatItems[swapIdx]] = [newCatItems[swapIdx], newCatItems[idx]];
    const updated = newCatItems.map((item, i) => ({ ...item, order_index: i + 1 }));
    setItems(prev => {
      const others = prev.filter(i => i.category !== rankingCategory);
      return [...others, ...updated].sort((a, b) => {
        if (a.category !== b.category) return a.category.localeCompare(b.category);
        return a.order_index - b.order_index;
      });
    });
  };

  const saveRanks = async () => {
    setSavingRanks(true);
    try {
      const catItems = items.filter(i => i.category === rankingCategory);
      await Promise.all(
        catItems.map((item, idx) =>
          supabase.from('items').update({ order_index: idx + 1 }).eq('id', item.id)
        )
      );
      setRankingMode(false);
      showToast('success', 'Order saved');
    } catch {
      showToast('error', 'Error saving order');
    } finally {
      setSavingRanks(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const parsedItems = await parseItemsExcel(file);
      if (parsedItems.length === 0) { showToast('error', 'No valid items found in the file'); return; }
      const serials = parsedItems.map(i => i.serial);
      const uniqueSerials = new Set(serials);
      if (uniqueSerials.size !== serials.length) {
        const dupes = serials.filter((s, i) => serials.indexOf(s) !== i);
        showToast('error', `Duplicate codes in file: ${[...new Set(dupes)].join(', ')}`);
        return;
      }
      const { data: existingItems } = await supabase.from('items').select('id, serial').in('serial', serials);
      const existingMap = new Map((existingItems || []).map(i => [i.serial, i.id]));
      const toInsert = parsedItems
        .filter(item => !existingMap.has(item.serial))
        .map(item => ({ serial: item.serial, name: item.name, description: item.description, category: item.category, stock_level_required: item.stock_level_required, created_by: user?.id }));
      const toUpdate = parsedItems.filter(item => existingMap.has(item.serial));
      if (toInsert.length > 0) {
        const { error } = await supabase.from('items').insert(toInsert);
        if (error) throw new Error(`Insert error: ${error.message}`);
      }
      for (const item of toUpdate) {
        const { error } = await supabase.from('items').update({ name: item.name, description: item.description, category: item.category, stock_level_required: item.stock_level_required }).eq('id', existingMap.get(item.serial)!);
        if (error) throw new Error(`Update error: ${error.message}`);
      }
      showToast('success', `Done: ${toInsert.length} added, ${toUpdate.length} updated`);
      await loadItems();
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (error) {
      showToast('error', `Error uploading items: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setUploading(false);
    }
  };

  if (loading) return <div className="text-center py-8">{t('loading')}</div>;

  const ItemForm = ({ onSubmit, isEdit }: { onSubmit: (e: React.FormEvent) => void; isEdit: boolean }) => (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            Item Code <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={formData.serial}
            onChange={(e) => setFormData({ ...formData, serial: e.target.value })}
            required
            placeholder="e.g. W0001"
            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('category')}</label>
          <select
            value={formData.category}
            onChange={(e) => setFormData({ ...formData, category: e.target.value as 'warehouse' | 'factory' })}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
          >
            <option value="warehouse">{t('warehouse')}</option>
            <option value="factory">{t('factory')}</option>
          </select>
        </div>
        <div className="col-span-2">
          <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('name')} <span className="text-red-500">*</span></label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            required
            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
          />
        </div>
        <div className="col-span-2">
          <label className="block text-sm font-medium text-slate-700 mb-1.5">{t('description')}</label>
          <textarea
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            rows={2}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm resize-none"
          />
        </div>

        {formData.category === 'factory' && (
          <div className="col-span-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.stock_level_required}
                onChange={(e) => setFormData({ ...formData, stock_level_required: e.target.checked })}
                className="w-4 h-4 text-blue-600 border-slate-300 rounded"
              />
              <span className="text-sm font-medium text-slate-700">{t('stock_level_required')}</span>
            </label>
          </div>
        )}

        <div className="col-span-2">
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            Item Picture <span className="text-slate-400 text-xs">(max 550 KB, auto-compressed)</span>
          </label>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 px-3 py-2 border border-dashed border-slate-300 rounded-lg cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors text-sm text-slate-600">
              <Image className="w-4 h-4 text-slate-400" />
              {pictureFile ? pictureFile.name : 'Choose image...'}
              <input ref={pictureInputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={handlePictureChange} className="hidden" />
            </label>
            {picturePreview && (
              <div className="relative">
                <img src={picturePreview} alt="Preview" className="w-14 h-14 object-cover rounded-lg border border-slate-200" />
                <button type="button" onClick={() => { setPictureFile(null); setPicturePreview(null); }}
                  className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center">
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {formData.category === 'warehouse' && (
        <div className="border-t pt-4">
          <h4 className="text-sm font-semibold text-slate-800 mb-3">Warehouse Units Configuration</h4>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Purchase Unit *</label>
              <input type="text" value={warehouseUnits.purchase_unit}
                onChange={(e) => setWarehouseUnits({ ...warehouseUnits, purchase_unit: e.target.value })}
                required placeholder="e.g., box, carton"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Sale Unit *</label>
              <input type="text" value={warehouseUnits.sale_unit}
                onChange={(e) => setWarehouseUnits({ ...warehouseUnits, sale_unit: e.target.value })}
                required placeholder="e.g., piece, unit"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Conversion Ratio *</label>
              <input type="number" step="1" value={warehouseUnits.purchase_to_sale_ratio}
                onChange={(e) => setWarehouseUnits({ ...warehouseUnits, purchase_to_sale_ratio: parseFloat(e.target.value) || 1 })}
                required className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm" />
              <p className="text-xs text-slate-500 mt-1">
                1 {warehouseUnits.purchase_unit || 'purchase unit'} = {warehouseUnits.purchase_to_sale_ratio} {warehouseUnits.sale_unit || 'sale units'}
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Minimum Stock (Purchase Units) *</label>
              <input type="number" step="1" value={warehouseUnits.minimum_stock_purchase_units}
                onChange={(e) => setWarehouseUnits({ ...warehouseUnits, minimum_stock_purchase_units: parseFloat(e.target.value) || 0 })}
                required className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm" />
            </div>
          </div>
        </div>
      )}

      {formData.category === 'factory' && (
        <div className="border-t pt-4">
          <h4 className="text-sm font-semibold text-slate-800 mb-3">Factory Stock Configuration</h4>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Minimum Stock Level *</label>
            <input type="number" step="1" value={factoryMinStock}
              onChange={(e) => setFactoryMinStock(parseFloat(e.target.value) || 0)}
              required className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm" />
          </div>
        </div>
      )}

      <div className="flex gap-3 pt-2 justify-end border-t">
        <button type="button" onClick={closeModals}
          className="px-4 py-2 text-sm text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors">
          {t('cancel')}
        </button>
        <button type="submit" disabled={submitting || uploadingPicture}
          className="px-5 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors font-medium">
          {submitting || uploadingPicture ? t('loading') : isEdit ? 'Save Changes' : 'Create Item'}
        </button>
      </div>
    </form>
  );

  return (
    <div className="space-y-6">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg text-white text-sm font-medium transition-all ${toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'}`}>
          {toast.msg}
        </div>
      )}

      {/* Edit Modal */}
      {showEditModal && (
        <div className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) closeModals(); }}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center rounded-t-xl">
              <h3 className="text-lg font-bold text-slate-900">{t('edit_item')}</h3>
              <button onClick={closeModals} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors">
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>
            <div className="p-6">
              <ItemForm onSubmit={handleEdit} isEdit={true} />
            </div>
          </div>
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) closeModals(); }}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center rounded-t-xl">
              <h3 className="text-lg font-bold text-slate-900">{t('create_item')}</h3>
              <button onClick={closeModals} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors">
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>
            <div className="p-6">
              <ItemForm onSubmit={handleCreate} isEdit={false} />
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900">Delete Item</h3>
                <p className="text-sm text-slate-600 mt-1">
                  Are you sure you want to delete <strong>{deleteTarget.serial} — {deleteTarget.name}</strong>? This action cannot be undone and will remove all associated data.
                </p>
              </div>
            </div>
            <div className="flex gap-3 justify-end pt-2">
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 text-sm text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors font-medium"
              >
                {deleting ? 'Deleting...' : 'Delete Item'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-slate-900">{t('items')}</h2>
        <div className="flex gap-2 flex-wrap justify-end">
          {rankingMode ? (
            <>
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-600">Reordering:</span>
                <button onClick={() => setRankingCategory('warehouse')}
                  className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${rankingCategory === 'warehouse' ? 'bg-green-600 text-white' : 'bg-slate-200 text-slate-700 hover:bg-slate-300'}`}>
                  Warehouse
                </button>
                <button onClick={() => setRankingCategory('factory')}
                  className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${rankingCategory === 'factory' ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-700 hover:bg-slate-300'}`}>
                  Factory
                </button>
              </div>
              <button onClick={saveRanks} disabled={savingRanks}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center gap-2 disabled:opacity-50 text-sm">
                <Save size={16} />
                {savingRanks ? 'Saving...' : 'Save Order'}
              </button>
              <button onClick={() => { setRankingMode(false); loadItems(); }}
                className="px-4 py-2 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 transition-colors text-sm">
                Cancel
              </button>
            </>
          ) : (
            <>
              <button onClick={() => downloadItemsTemplate()}
                className="px-3 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-700 transition-colors flex items-center gap-2 text-sm">
                <Download size={16} />
                Template
              </button>
              <label className="px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center gap-2 cursor-pointer text-sm">
                <Upload size={16} />
                {uploading ? 'Uploading...' : 'Bulk Upload'}
                <input ref={fileInputRef} type="file" accept=".xlsx,.xls" onChange={handleFileUpload} disabled={uploading} className="hidden" />
              </label>
              <button onClick={openCreate}
                className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2 text-sm">
                <Plus size={16} />
                {t('create_item')}
              </button>
              <button onClick={() => setRankingMode(true)}
                className="px-3 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors flex items-center gap-2 text-sm">
                <ChevronUp size={16} />
                Reorder
              </button>
            </>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Pic</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('serial')}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('name')}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('category')}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('description')}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('stock_level_required')}</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('actions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((item) => {
              const catItems = items.filter(i => i.category === item.category);
              const catIdx = catItems.findIndex(i => i.id === item.id);
              const isRankingThis = rankingMode && item.category === rankingCategory;
              return (
                <tr key={item.id} className={`${isRankingThis ? 'bg-amber-50' : 'hover:bg-slate-50'} transition-colors`}>
                  <td className="px-4 py-3">
                    {item.picture_url ? (
                      <img src={item.picture_url} alt={item.name} className="w-10 h-10 object-cover rounded-lg border border-slate-200" />
                    ) : (
                      <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center">
                        <Image className="w-4 h-4 text-slate-400" />
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm font-mono font-semibold text-slate-900">{item.serial}</td>
                  <td className="px-4 py-3 text-sm text-slate-900 font-medium">{item.name}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${item.category === 'warehouse' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'}`}>
                      {t(item.category)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-500 max-w-xs truncate">{item.description}</td>
                  <td className="px-4 py-3">
                    {item.category === 'factory' ? (
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${item.stock_level_required ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>
                        {item.stock_level_required ? t('required') : t('not_required')}
                      </span>
                    ) : (
                      <span className="text-slate-400 text-sm">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      {isRankingThis ? (
                        <>
                          <span className="text-xs text-amber-600 font-medium w-6 text-center">{catIdx + 1}</span>
                          <button onClick={() => moveItem(item.id, 'up')} disabled={catIdx === 0}
                            className="p-1.5 text-slate-600 hover:bg-slate-200 rounded transition-colors disabled:opacity-30" title="Move up">
                            <ChevronUp className="w-4 h-4" />
                          </button>
                          <button onClick={() => moveItem(item.id, 'down')} disabled={catIdx === catItems.length - 1}
                            className="p-1.5 text-slate-600 hover:bg-slate-200 rounded transition-colors disabled:opacity-30" title="Move down">
                            <ChevronDown className="w-4 h-4" />
                          </button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => openEdit(item)}
                            className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title={t('edit')}>
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button onClick={() => setDeleteTarget(item)}
                            className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors" title={t('delete')}>
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
