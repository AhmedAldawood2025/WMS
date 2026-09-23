import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useLanguage } from '../../contexts/LanguageContext';
import { useAuth } from '../../contexts/AuthContext';
import { X, Save, Plus, History, CheckCircle, Clock, CreditCard as Edit3, XCircle, Package } from 'lucide-react';
import type { Database } from '../../lib/database.types';

type Item = Database['public']['Tables']['items']['Row'];

interface OrderDetails {
  id: string;
  order_number: string;
  status: string;
  category: string;
  created_at: string;
  branch: {
    name: string;
    location: string;
    code?: string;
  } | null;
  customer: {
    display_name: string;
  } | null;
  order_items: Array<{
    id: string;
    quantity: number;
    stock_level?: number | null;
    item: {
      id: string;
      serial: string;
      name: string;
      description: string;
      category: string;
      stock_level_required?: boolean;
    };
  }>;
}

interface HistoryEntry {
  id: string;
  event_type: string;
  notes: string;
  created_at: string;
  performed_by: string | null;
  performer?: { display_name: string } | null;
}

interface OrderDetailsModalProps {
  orderId: string;
  onClose: () => void;
  onSave?: () => void;
}

export function OrderDetailsModal({ orderId, onClose, onSave }: OrderDetailsModalProps) {
  const [order, setOrder] = useState<OrderDetails | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [stockLevels, setStockLevels] = useState<Record<string, number>>({});
  const [status, setStatus] = useState<string>('pending');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [availableItems, setAvailableItems] = useState<Item[]>([]);
  const [showAddItem, setShowAddItem] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState('');
  const [newItemQuantity, setNewItemQuantity] = useState(0);
  const [newItemStockLevel, setNewItemStockLevel] = useState(0);
  const [newOrderItems, setNewOrderItems] = useState<Array<{itemId: string, quantity: number, stock_level?: number | null}>>([]);
  const [itemSearch, setItemSearch] = useState('');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const { t } = useLanguage();
  const { profile } = useAuth();

  useEffect(() => {
    loadOrderDetails();
    loadAvailableItems();
    loadHistory();
  }, [orderId]);

  const loadHistory = async () => {
    try {
      const { data, error } = await supabase
        .from('order_history')
        .select(`
          id, event_type, notes, created_at, performed_by,
          performer:profiles(display_name)
        `)
        .eq('order_id', orderId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      setHistory((data as any) || []);
    } catch (error) {
      console.error('Error loading order history:', error);
    }
  };

  const loadOrderDetails = async () => {
    try {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          id,
          order_number,
          status,
          category,
          created_at,
          branch:branches(name, location),
          customer:profiles(display_name),
          order_items(
            id,
            quantity,
            stock_level,
            item:items(
              id,
              serial,
              name,
              description,
              category,
              stock_level_required
            )
          )
        `)
        .eq('id', orderId)
        .single();

      if (error) throw error;

      setOrder(data as any);
      setStatus((data as any).status);

      const initialQuantities: Record<string, number> = {};
      const initialStockLevels: Record<string, number> = {};
      (data as any).order_items.forEach((oi: any) => {
        initialQuantities[oi.id] = oi.quantity;
        if (oi.stock_level !== null && oi.stock_level !== undefined) {
          initialStockLevels[oi.id] = oi.stock_level;
        }
      });
      setQuantities(initialQuantities);
      setStockLevels(initialStockLevels);
    } catch (error) {
      console.error('Error loading order details:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadAvailableItems = async () => {
    try {
      const role = profile?.role;
      if (!role || !['admin', 'warehouse_manager', 'factory_manager', 'accountant'].includes(role)) return;

      let query = supabase.from('items').select('*').order('serial');

      if (role === 'warehouse_manager') query = query.eq('category', 'warehouse');
      else if (role === 'factory_manager') query = query.eq('category', 'factory');

      const { data, error } = await query;
      if (error) throw error;
      setAvailableItems(data || []);
    } catch (error) {
      console.error('Error loading available items:', error);
    }
  };

  const canEdit = (category: string) => {
    if (status === 'completed') return false;
    if (profile?.role === 'admin') return true;
    if (profile?.role === 'warehouse_manager' && category === 'warehouse') return true;
    if (profile?.role === 'factory_manager' && category === 'factory') return true;
    // Accountant can edit items only on approved orders
    if (profile?.role === 'accountant' && order?.status === 'approved') return true;
    return false;
  };

  const canAddItemsForCategory = (category: 'warehouse' | 'factory') => {
    if (status === 'completed') return false;
    if (profile?.role === 'admin') return true;
    if (profile?.role === 'warehouse_manager' && category === 'warehouse') return true;
    if (profile?.role === 'factory_manager' && category === 'factory') return true;
    // Accountant can only add items matching the order's category on approved orders
    if (profile?.role === 'accountant' && order?.status === 'approved' && order?.category === category) return true;
    return false;
  };

  const canChangeStatus = () => {
    if (profile?.role === 'admin') return true;
    if (profile?.role === 'warehouse_manager' || profile?.role === 'factory_manager') return true;
    // Accountant can only change status on approved orders (approved → completed)
    if (profile?.role === 'accountant' && order?.status === 'approved') return true;
    return false;
  };

  const allowedStatusOptions = (): string[] => {
    if (profile?.role === 'accountant') return ['approved', 'completed'];
    if (profile?.role === 'warehouse_manager' || profile?.role === 'factory_manager') return ['pending', 'approved'];
    if (profile?.role === 'admin') return ['pending', 'approved', 'completed', 'cancelled'];
    return [];
  };

  const handleAddItem = () => {
    if (!selectedItemId) {
      alert('Please select an item');
      return;
    }

    if (newItemQuantity < 0) {
      alert('Quantity cannot be negative');
      return;
    }

    const selectedItem = availableItems.find(item => item.id === selectedItemId);
    if (!selectedItem) return;

    if (selectedItem.stock_level_required && (newItemStockLevel === null || newItemStockLevel === undefined)) {
      alert(t('stock_level_required_error'));
      return;
    }

    const alreadyExists = order?.order_items.some(oi => oi.item?.id === selectedItemId) ||
                          newOrderItems.some(noi => noi.itemId === selectedItemId);

    if (alreadyExists) {
      alert('This item is already in the order');
      return;
    }

    setNewOrderItems([...newOrderItems, {
      itemId: selectedItemId,
      quantity: newItemQuantity,
      stock_level: selectedItem.stock_level_required ? newItemStockLevel : null
    }]);

    setSelectedItemId('');
    setNewItemQuantity(0);
    setNewItemStockLevel(0);
    setItemSearch('');
    setShowAddItem(false);
  };

  const handleRemoveNewItem = (itemId: string) => {
    setNewOrderItems(newOrderItems.filter(noi => noi.itemId !== itemId));
  };

  const handleSave = async () => {
    setSaving(true);

    try {
      const updatePromises = [];

      const itemsToUpdate = Object.entries(quantities).map(([orderItemId, quantity]) => {
        const orderItem = order?.order_items.find(oi => oi.id === orderItemId);
        const updateData: any = { quantity };

        if (orderItem?.item?.stock_level_required && stockLevels[orderItemId] !== undefined) {
          updateData.stock_level = stockLevels[orderItemId];
        }

        return { id: orderItemId, data: updateData };
      });

      for (const { id, data } of itemsToUpdate) {
        updatePromises.push(
          supabase.from('order_items').update(data).eq('id', id)
        );
      }

      const hasItemChanges = itemsToUpdate.length > 0 || newOrderItems.length > 0;

      if (newOrderItems.length > 0) {
        updatePromises.push(
          supabase.from('order_items').insert(
            newOrderItems.map(noi => ({
              order_id: orderId,
              item_id: noi.itemId,
              quantity: noi.quantity,
              stock_level: noi.stock_level,
            }))
          )
        );
      }

      // Status change — DB trigger records status-change history automatically
      if (status !== order?.status) {
        updatePromises.push(
          supabase.from('orders').update({ status }).eq('id', orderId)
        );
      }

      const results = await Promise.all(updatePromises);
      const errors = results.filter(r => r.error);
      if (errors.length > 0) throw errors[0].error;

      // Record an 'edited' history entry when items were changed but status did NOT change
      // (status-change entries are already written by the DB trigger)
      if (hasItemChanges && status === order?.status && profile?.id) {
        const notes = newOrderItems.length > 0
          ? `Items edited; ${newOrderItems.length} new item(s) added`
          : 'Item quantities updated';
        await supabase.from('order_history').insert({
          order_id: orderId,
          event_type: 'edited',
          performed_by: profile.id,
          notes,
        });
      }

      if (onSave) onSave();
      onClose();
    } catch (error: any) {
      console.error('Error saving changes:', error);
      const errorMessage = error?.message || error?.toString() || t('error');
      alert(`Error: ${errorMessage}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-xl p-8">
          <div className="text-center">{t('loading')}</div>
        </div>
      </div>
    );
  }

  if (!order) return null;

  const hasEditableItems = order.order_items.some(oi => oi.item && canEdit(oi.item.category));
  const isEditing = hasEditableItems && status !== 'completed';

  const warehouseItems = order.order_items.filter(oi => {
    if (!oi.item || oi.item.category !== 'warehouse') return false;
    if (isEditing && canEdit('warehouse')) return true;
    return (quantities[oi.id] ?? oi.quantity) > 0;
  });

  const factoryItems = order.order_items.filter(oi => {
    if (!oi.item || oi.item.category !== 'factory') return false;
    if (isEditing && canEdit('factory')) return true;
    return (quantities[oi.id] ?? oi.quantity) > 0 ||
      (oi.item.stock_level_required &&
        (stockLevels[oi.id] ?? oi.stock_level) != null);
  });

  const deletedItems = order.order_items.filter(oi => !oi.item);

  const hasChanges = status !== order.status || hasEditableItems;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">{order.order_number}</h2>
            <p className="text-sm text-slate-600 mt-1">
              {order.branch?.name || 'N/A'} • {order.customer?.display_name || 'N/A'} • {new Date(order.created_at).toLocaleDateString()}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">

          {/* Order History */}
          <div className="bg-slate-50 rounded-lg border border-slate-200 overflow-hidden">
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-100 transition-colors"
            >
              <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                <History className="w-4 h-4" />
                Order History
                <span className="text-xs text-slate-500 font-normal">({history.length} events)</span>
              </div>
              <span className="text-xs text-slate-500">{showHistory ? '▲ Hide' : '▼ Show'}</span>
            </button>
            {showHistory && (
              <div className="border-t border-slate-200 p-4 space-y-3 max-h-48 overflow-y-auto">
                {history.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-2">No history recorded</p>
                ) : (
                  history.map((entry) => {
                    const icons: Record<string, React.ReactNode> = {
                      created: <Package className="w-3.5 h-3.5 text-blue-500" />,
                      edited: <Edit3 className="w-3.5 h-3.5 text-amber-500" />,
                      approved: <CheckCircle className="w-3.5 h-3.5 text-green-500" />,
                      completed: <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />,
                      cancelled: <XCircle className="w-3.5 h-3.5 text-red-500" />,
                    };
                    return (
                      <div key={entry.id} className="flex items-start gap-3">
                        <div className="mt-0.5 flex-shrink-0">{icons[entry.event_type] || <Clock className="w-3.5 h-3.5 text-slate-400" />}</div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-slate-700 capitalize">{entry.event_type}</p>
                          <p className="text-xs text-slate-500">{entry.notes}</p>
                          {(entry as any).performer?.display_name && (
                            <p className="text-xs text-slate-400">by {(entry as any).performer.display_name}</p>
                          )}
                        </div>
                        <span className="text-xs text-slate-400 flex-shrink-0">
                          {new Date(entry.created_at).toLocaleDateString()} {new Date(entry.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {canChangeStatus() && (
            <div className="bg-slate-50 p-4 rounded-lg">
              <label className="block text-sm font-medium text-slate-700 mb-2">
                {t('status')}
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                disabled={status === 'completed' && profile?.role !== 'admin'}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {allowedStatusOptions().map(s => (
                  <option key={s} value={s}>{t(s)}</option>
                ))}
              </select>
              {status === 'completed' && (
                <p className="text-xs text-slate-500 mt-2">
                  {t('completed_orders_cannot_be_edited')}
                </p>
              )}
            </div>
          )}

          {(warehouseItems.length > 0 || canAddItemsForCategory('warehouse')) && (
            <div>
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-green-500"></span>
                  {t('warehouse_items')}
                </h3>
                {canAddItemsForCategory('warehouse') && (
                  <button
                    onClick={() => setShowAddItem(!showAddItem)}
                    className="flex items-center gap-2 px-3 py-1.5 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    Add Item
                  </button>
                )}
              </div>

              {showAddItem && canAddItemsForCategory('warehouse') && (() => {
                const warehouseSelectItems = availableItems
                  .filter(item => item.category === 'warehouse')
                  .filter(item => !order?.order_items.some(oi => oi.item?.id === item.id) && !newOrderItems.some(noi => noi.itemId === item.id));
                const filteredWarehouseItems = itemSearch
                  ? warehouseSelectItems.filter(item => `${item.serial} ${item.name}`.toLowerCase().includes(itemSearch.toLowerCase()))
                  : warehouseSelectItems;
                return (
                  <div className="bg-green-50 border border-green-200 p-4 rounded-lg mb-4">
                    <div className="grid grid-cols-3 gap-3">
                      <div className="col-span-2 space-y-1">
                        <label className="block text-xs font-medium text-slate-700">Search Item</label>
                        <input
                          type="text"
                          value={itemSearch}
                          onChange={(e) => { setItemSearch(e.target.value); setSelectedItemId(''); }}
                          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                          placeholder="Type serial or name..."
                          autoFocus
                        />
                        <select
                          size={5}
                          value={selectedItemId}
                          onChange={(e) => setSelectedItemId(e.target.value)}
                          className="w-full text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent overflow-y-auto"
                        >
                          <option value="">— choose an item —</option>
                          {filteredWarehouseItems.map(item => (
                            <option key={item.id} value={item.id}>{item.serial} - {item.name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">Quantity</label>
                        <input
                          type="number"
                          min="0"
                          value={newItemQuantity || ''}
                          onChange={(e) => setNewItemQuantity(parseInt(e.target.value) || 0)}
                          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                          placeholder="0"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end gap-2 mt-3">
                      <button
                        onClick={() => { setShowAddItem(false); setSelectedItemId(''); setNewItemQuantity(0); setItemSearch(''); }}
                        className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleAddItem}
                        className="px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                      >
                        Add to Order
                      </button>
                    </div>
                  </div>
                );
              })()}

              {newOrderItems.filter(noi => {
                const item = availableItems.find(i => i.id === noi.itemId);
                return item?.category === 'warehouse';
              }).length > 0 && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4">
                  <p className="text-xs font-medium text-green-800 mb-2">New items to be added:</p>
                  <div className="space-y-2">
                    {newOrderItems.filter(noi => {
                      const item = availableItems.find(i => i.id === noi.itemId);
                      return item?.category === 'warehouse';
                    }).map(noi => {
                      const item = availableItems.find(i => i.id === noi.itemId);
                      return (
                        <div key={noi.itemId} className="flex items-center justify-between bg-white px-3 py-2 rounded text-sm">
                          <span className="font-medium">{item?.serial} - {item?.name}</span>
                          <div className="flex items-center gap-3">
                            <span className="text-slate-600">Qty: {noi.quantity}</span>
                            <button
                              onClick={() => handleRemoveNewItem(noi.itemId)}
                              className="text-red-600 hover:text-red-800"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {warehouseItems.length > 0 && (
              <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                        {t('serial')}
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                        {t('name')}
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                        {t('description')}
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                        {t('quantity')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {warehouseItems.map((orderItem) => (
                      <tr key={orderItem.id}>
                        <td className="px-4 py-3 text-sm font-medium text-slate-900">
                          {orderItem.item.serial}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-900">
                          {orderItem.item.name}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-600">
                          {orderItem.item.description}
                        </td>
                        <td className="px-4 py-3">
                          {canEdit(orderItem.item.category) ? (
                            <input
                              type="number"
                              min="0"
                              value={quantities[orderItem.id] || 0}
                              onChange={(e) => setQuantities({
                                ...quantities,
                                [orderItem.id]: parseInt(e.target.value) || 0
                              })}
                              className="w-24 px-3 py-1 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            />
                          ) : (
                            <span className="text-sm text-slate-900">{orderItem.quantity}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              )}
            </div>
          )}

          {(factoryItems.length > 0 || canAddItemsForCategory('factory')) && (
            <div>
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                  {t('factory_items')}
                </h3>
                {canAddItemsForCategory('factory') && (
                  <button
                    onClick={() => setShowAddItem(!showAddItem)}
                    className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    Add Item
                  </button>
                )}
              </div>

              {showAddItem && canAddItemsForCategory('factory') && (() => {
                const factorySelectItems = availableItems
                  .filter(item => item.category === 'factory')
                  .filter(item => !order?.order_items.some(oi => oi.item?.id === item.id) && !newOrderItems.some(noi => noi.itemId === item.id));
                const filteredFactoryItems = itemSearch
                  ? factorySelectItems.filter(item => `${item.serial} ${item.name}`.toLowerCase().includes(itemSearch.toLowerCase()))
                  : factorySelectItems;
                return (
                  <div className="bg-blue-50 border border-blue-200 p-4 rounded-lg mb-4">
                    <div className="grid grid-cols-3 gap-3">
                      <div className="col-span-2 space-y-1">
                        <label className="block text-xs font-medium text-slate-700">Search Item</label>
                        <input
                          type="text"
                          value={itemSearch}
                          onChange={(e) => { setItemSearch(e.target.value); setSelectedItemId(''); }}
                          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          placeholder="Type serial or name..."
                          autoFocus
                        />
                        <select
                          size={5}
                          value={selectedItemId}
                          onChange={(e) => setSelectedItemId(e.target.value)}
                          className="w-full text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent overflow-y-auto"
                        >
                          <option value="">— choose an item —</option>
                          {filteredFactoryItems.map(item => (
                            <option key={item.id} value={item.id}>{item.serial} - {item.name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">Quantity</label>
                        <input
                          type="number"
                          min="0"
                          value={newItemQuantity || ''}
                          onChange={(e) => setNewItemQuantity(parseInt(e.target.value) || 0)}
                          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          placeholder="0"
                        />
                      </div>
                    </div>
                    {availableItems.find(i => i.id === selectedItemId)?.stock_level_required && (
                      <div className="mt-3">
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Current Stock Level <span className="text-amber-600">*</span>
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={newItemStockLevel || ''}
                          onChange={(e) => setNewItemStockLevel(parseInt(e.target.value) || 0)}
                          className="w-full px-3 py-2 text-sm border-2 border-amber-400 bg-amber-50 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                          placeholder="0"
                        />
                      </div>
                    )}
                    <div className="flex justify-end gap-2 mt-3">
                      <button
                        onClick={() => { setShowAddItem(false); setSelectedItemId(''); setNewItemQuantity(0); setNewItemStockLevel(0); setItemSearch(''); }}
                        className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleAddItem}
                        className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                      >
                        Add to Order
                      </button>
                    </div>
                  </div>
                );
              })()}

              {newOrderItems.filter(noi => {
                const item = availableItems.find(i => i.id === noi.itemId);
                return item?.category === 'factory';
              }).length > 0 && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
                  <p className="text-xs font-medium text-blue-800 mb-2">New items to be added:</p>
                  <div className="space-y-2">
                    {newOrderItems.filter(noi => {
                      const item = availableItems.find(i => i.id === noi.itemId);
                      return item?.category === 'factory';
                    }).map(noi => {
                      const item = availableItems.find(i => i.id === noi.itemId);
                      return (
                        <div key={noi.itemId} className="flex items-center justify-between bg-white px-3 py-2 rounded text-sm">
                          <span className="font-medium">{item?.serial} - {item?.name}</span>
                          <div className="flex items-center gap-3">
                            <span className="text-slate-600">Qty: {noi.quantity}</span>
                            {item?.stock_level_required && noi.stock_level !== null && (
                              <span className="text-amber-700">Stock: {noi.stock_level}</span>
                            )}
                            <button
                              onClick={() => handleRemoveNewItem(noi.itemId)}
                              className="text-red-600 hover:text-red-800"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {factoryItems.length > 0 && (
              <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                        {t('serial')}
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                        {t('name')}
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                        {t('description')}
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                        {t('quantity')}
                      </th>
                      {(profile?.role === 'factory_manager' || profile?.role === 'admin' || profile?.role === 'accountant') && (
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                          {t('current_stock_level')}
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {factoryItems.map((orderItem) => (
                      <tr key={orderItem.id}>
                        <td className="px-4 py-3 text-sm font-medium text-slate-900">
                          {orderItem.item.serial}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-900">
                          {orderItem.item.name}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-600">
                          {orderItem.item.description}
                        </td>
                        <td className="px-4 py-3">
                          {canEdit(orderItem.item.category) ? (
                            <input
                              type="number"
                              min="0"
                              value={quantities[orderItem.id] || 0}
                              onChange={(e) => setQuantities({
                                ...quantities,
                                [orderItem.id]: parseInt(e.target.value) || 0
                              })}
                              className="w-24 px-3 py-1 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            />
                          ) : (
                            <span className="text-sm text-slate-900">{orderItem.quantity}</span>
                          )}
                        </td>
                        {(profile?.role === 'factory_manager' || profile?.role === 'admin' || profile?.role === 'accountant') && (
                          <td className="px-4 py-3 text-sm text-slate-900">
                            {orderItem.item.stock_level_required ? (
                              canEdit(orderItem.item.category) ? (
                                <input
                                  type="number"
                                  min="0"
                                  value={stockLevels[orderItem.id] ?? orderItem.stock_level ?? ''}
                                  onChange={(e) => setStockLevels({
                                    ...stockLevels,
                                    [orderItem.id]: parseInt(e.target.value) || 0
                                  })}
                                  className="w-24 px-3 py-1 border-2 border-amber-400 bg-amber-50 rounded focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                                />
                              ) : (
                                orderItem.stock_level !== null && orderItem.stock_level !== undefined ? (
                                  <span className="px-2 py-1 bg-amber-50 border border-amber-200 rounded text-amber-800 font-medium">
                                    {orderItem.stock_level}
                                  </span>
                                ) : (
                                  <span className="text-slate-400">-</span>
                                )
                              )
                            ) : (
                              <span className="text-slate-400">-</span>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              )}
            </div>
          )}
          {deletedItems.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-sm font-medium text-red-700 mb-2">
                {deletedItems.length} item{deletedItems.length > 1 ? 's' : ''} in this order {deletedItems.length > 1 ? 'were' : 'was'} deleted
              </p>
              <div className="space-y-1">
                {deletedItems.map(oi => (
                  <div key={oi.id} className="flex justify-between text-xs text-red-600">
                    <span className="italic">Deleted item</span>
                    <span>Qty: {oi.quantity}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {(hasEditableItems || canChangeStatus() || newOrderItems.length > 0) && (
          <div className="sticky bottom-0 bg-slate-50 border-t border-slate-200 px-6 py-4 flex justify-end gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-slate-700 hover:bg-slate-200 rounded-lg transition-colors"
            >
              {t('cancel')}
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              <Save className="w-4 h-4" />
              {saving ? t('loading') : t('save')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
