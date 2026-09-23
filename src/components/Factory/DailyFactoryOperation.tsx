import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { Plus, Trash2, Save, RefreshCw, ChevronDown, ChevronUp, Printer, Send } from 'lucide-react';

interface RawMaterial {
  id: string;
  name: string;
  unit: string;
  current_stock: number;
  minimum_stock_level: number;
  supplier_id: string | null;
}

interface Supplier {
  id: string;
  name: string;
}

interface FactoryItem {
  id: string;
  name: string;
  serial: string;
}

interface Operation {
  id: string;
  operation_date: string;
  status: 'draft' | 'submitted';
}

interface SupplyEntry {
  supplier_id: string;
  raw_material_id: string;
  quantity: number;
  total_price: number;
}

interface ProcessEntry {
  raw_material_id: string;
  quantity: number;
}

interface ProductionEntry {
  item_id: string;
  opening_stock: number;
  production_qty: number;
  demand_qty: number;
  frozen_qty: number;
}

interface WithdrawalEntry {
  name: string;
  entry_type: 'raw_material' | 'processed_item';
  supplier_id: string;
  raw_material_id: string;
  item_id: string;
  quantity: number;
}

interface MealEntry {
  supplier_id: string;
  raw_material_id: string;
  quantity: number;
}

type SectionKey = 'opening' | 'supply' | 'process' | 'production' | 'withdrawals' | 'meals' | 'closing';

const SECTION_LABELS: Record<SectionKey, string> = {
  opening: 'المخزون الافتتاحي — Opening Stock',
  supply: 'توريد اليوم — Today\'s Supply',
  process: 'تقطيع اليوم — Today\'s Process',
  production: 'الإنتاج اليومي والتوزيع — Daily Items Production & Distribution',
  withdrawals: 'السحوبات — Withdrawals',
  meals: 'وجبات الموظفين — Employees Meal',
  closing: 'المخزون الختامي — Closing Stock',
};

export function DailyFactoryOperation() {
  const { user } = useAuth();
  const today = new Date().toISOString().split('T')[0];
  const [selectedDate, setSelectedDate] = useState(today);
  const [operation, setOperation] = useState<Operation | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<'draft' | 'submit' | null>(null);

  const [rawMaterials, setRawMaterials] = useState<RawMaterial[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [factoryItems, setFactoryItems] = useState<FactoryItem[]>([]);

  const [rmSnapshots, setRmSnapshots] = useState<Record<string, number>>({});
  const [itemSnapshots, setItemSnapshots] = useState<Record<string, number>>({});

  const [supplyEntries, setSupplyEntries] = useState<SupplyEntry[]>([]);
  const [processEntries, setProcessEntries] = useState<ProcessEntry[]>([]);
  const [productionEntries, setProductionEntries] = useState<ProductionEntry[]>([]);
  const [withdrawalEntries, setWithdrawalEntries] = useState<WithdrawalEntry[]>([]);
  const [mealEntries, setMealEntries] = useState<MealEntry[]>([]);

  const [collapsed, setCollapsed] = useState<Record<SectionKey, boolean>>({
    opening: false, supply: false, process: false, production: false,
    withdrawals: false, meals: false, closing: false,
  });

  const printRef = useRef<HTMLDivElement>(null);
  void printRef;

  const toggleSection = (key: SectionKey) =>
    setCollapsed(prev => ({ ...prev, [key]: !prev[key] }));

  const loadMasterData = useCallback(async () => {
    const [rmRes, suppRes, itemRes] = await Promise.all([
      supabase.from('raw_materials').select('id, name, unit, current_stock, minimum_stock_level, supplier_id').order('name'),
      supabase.from('suppliers').select('id, name').in('type', ['raw_material', 'both']).order('name'),
      supabase.from('items').select('id, name, serial').eq('category', 'factory').order('order_index', { ascending: true }),
    ]);
    if (rmRes.data) setRawMaterials(rmRes.data);
    if (suppRes.data) setSuppliers(suppRes.data);
    if (itemRes.data) setFactoryItems(itemRes.data);
    return { rms: rmRes.data || [], items: itemRes.data || [] };
  }, []);

  // Get demand for each factory item from approved orders on a given date
  const fetchDemandForDate = useCallback(async (date: string, items: FactoryItem[]): Promise<Record<string, number>> => {
    if (items.length === 0) return {};
    const dateStart = `${date}T00:00:00`;
    const dateEnd = `${date}T23:59:59`;
    const { data: orderItems } = await supabase
      .from('order_items')
      .select('item_id, quantity, order:orders!inner(status, category, created_at)')
      .eq('order.category', 'factory')
      .eq('order.status', 'approved')
      .gte('order.created_at', dateStart)
      .lte('order.created_at', dateEnd);

    const demand: Record<string, number> = {};
    (orderItems || []).forEach((oi: { item_id: string; quantity: number }) => {
      demand[oi.item_id] = (demand[oi.item_id] || 0) + oi.quantity;
    });
    return demand;
  }, []);

  // Get previous submitted operation's closing stock for each RM and item
  const fetchPreviousClosingStock = useCallback(async (date: string): Promise<{
    rmClosing: Record<string, number>;
    itemClosing: Record<string, number>;
  }> => {
    // Find the most recent submitted operation before this date
    const { data: prevOp } = await supabase
      .from('daily_factory_operations')
      .select('id, operation_date')
      .eq('status', 'submitted')
      .lt('operation_date', date)
      .order('operation_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!prevOp) return { rmClosing: {}, itemClosing: {} };

    // Load all data from that previous operation to recompute closing
    const [snapRM, snapItem, supply, process, withdrawals, meals] = await Promise.all([
      supabase.from('daily_raw_material_snapshots').select('raw_material_id, opening_quantity').eq('operation_id', prevOp.id),
      supabase.from('daily_item_snapshots').select('item_id, opening_stock').eq('operation_id', prevOp.id),
      supabase.from('daily_supply_entries').select('raw_material_id, quantity').eq('operation_id', prevOp.id),
      supabase.from('daily_process_entries').select('raw_material_id, quantity').eq('operation_id', prevOp.id),
      supabase.from('daily_withdrawal_entries').select('entry_type, raw_material_id, item_id, quantity').eq('operation_id', prevOp.id),
      supabase.from('daily_employee_meal_entries').select('raw_material_id, quantity').eq('operation_id', prevOp.id),
    ]);

    const prevRmSnap: Record<string, number> = {};
    (snapRM.data || []).forEach((s: { raw_material_id: string; opening_quantity: number }) => { prevRmSnap[s.raw_material_id] = Number(s.opening_quantity); });

    const rmClosing: Record<string, number> = {};
    // For each RM, compute: opening + supply - process - withdrawals - meals
    const allRmIds = new Set([
      ...Object.keys(prevRmSnap),
      ...(supply.data || []).map((e: { raw_material_id: string }) => e.raw_material_id),
    ]);
    allRmIds.forEach(rmId => {
      const opening = prevRmSnap[rmId] ?? 0;
      const sup = (supply.data || []).filter((e: { raw_material_id: string }) => e.raw_material_id === rmId).reduce((s: number, e: { quantity: number }) => s + Number(e.quantity), 0);
      const proc = (process.data || []).filter((e: { raw_material_id: string }) => e.raw_material_id === rmId).reduce((s: number, e: { quantity: number }) => s + Number(e.quantity), 0);
      const withdr = (withdrawals.data || []).filter((e: { entry_type: string; raw_material_id: string | null }) => e.entry_type === 'raw_material' && e.raw_material_id === rmId).reduce((s: number, e: { quantity: number }) => s + Number(e.quantity), 0);
      const meal = (meals.data || []).filter((e: { raw_material_id: string | null }) => e.raw_material_id === rmId).reduce((s: number, e: { quantity: number }) => s + Number(e.quantity), 0);
      rmClosing[rmId] = Math.max(0, opening + sup - proc - withdr - meal);
    });

    // For items, get production entries from previous op
    const { data: prevProduction } = await supabase
      .from('daily_production_entries')
      .select('item_id, opening_stock, production_qty, demand_qty, frozen_qty')
      .eq('operation_id', prevOp.id);

    const prevItemSnap: Record<string, number> = {};
    (snapItem.data || []).forEach((s: { item_id: string; opening_stock: number }) => { prevItemSnap[s.item_id] = Number(s.opening_stock); });

    const itemClosing: Record<string, number> = {};
    (prevProduction || []).forEach((e: { item_id: string; opening_stock: number; production_qty: number; demand_qty: number; frozen_qty: number }) => {
      // closing = opening + production - demand - item_withdrawals - frozen
      const itemWithdrawn = (withdrawals.data || [])
        .filter((w: { entry_type: string; item_id: string | null }) => w.entry_type === 'processed_item' && w.item_id === e.item_id)
        .reduce((s: number, w: { quantity: number }) => s + Number(w.quantity), 0);
      itemClosing[e.item_id] = Math.max(0, Number(e.opening_stock) + Number(e.production_qty) - Number(e.demand_qty) - itemWithdrawn - Number(e.frozen_qty));
    });

    return { rmClosing, itemClosing };
  }, []);

  const loadOperationData = useCallback(async (opId: string, allItems: FactoryItem[], date: string) => {
    const [snapRM, snapItem, supply, process, production, withdrawals, meals] = await Promise.all([
      supabase.from('daily_raw_material_snapshots').select('raw_material_id, opening_quantity').eq('operation_id', opId),
      supabase.from('daily_item_snapshots').select('item_id, opening_stock').eq('operation_id', opId),
      supabase.from('daily_supply_entries').select('*').eq('operation_id', opId),
      supabase.from('daily_process_entries').select('*').eq('operation_id', opId),
      supabase.from('daily_production_entries').select('*').eq('operation_id', opId),
      supabase.from('daily_withdrawal_entries').select('*').eq('operation_id', opId),
      supabase.from('daily_employee_meal_entries').select('*').eq('operation_id', opId),
    ]);

    const rmSnap: Record<string, number> = {};
    (snapRM.data || []).forEach((s: { raw_material_id: string; opening_quantity: number }) => {
      rmSnap[s.raw_material_id] = Number(s.opening_quantity);
    });
    setRmSnapshots(rmSnap);

    const itemSnap: Record<string, number> = {};
    (snapItem.data || []).forEach((s: { item_id: string; opening_stock: number }) => {
      itemSnap[s.item_id] = Number(s.opening_stock);
    });
    setItemSnapshots(itemSnap);

    setSupplyEntries((supply.data || []).map((e: Record<string, unknown>) => ({
      supplier_id: e.supplier_id as string,
      raw_material_id: e.raw_material_id as string,
      quantity: Number(e.quantity),
      total_price: Number(e.total_price ?? 0),
    })));

    setProcessEntries((process.data || []).map((e: Record<string, unknown>) => ({
      raw_material_id: e.raw_material_id as string,
      quantity: Number(e.quantity),
    })));

    // Fetch demand for this date
    const demand = await fetchDemandForDate(date, allItems);

    // Production: build from all factory items, pre-populate from saved entries
    const savedProduction = new Map((production.data || []).map((e: Record<string, unknown>) => [
      e.item_id as string,
      {
        opening_stock: Number(e.opening_stock),
        production_qty: Number(e.production_qty),
        demand_qty: Number(e.demand_qty ?? 0),
        frozen_qty: Number(e.frozen_qty),
      },
    ]));

    setProductionEntries(allItems.map(item => {
      const saved = savedProduction.get(item.id);
      return {
        item_id: item.id,
        opening_stock: saved?.opening_stock ?? itemSnap[item.id] ?? 0,
        production_qty: saved?.production_qty ?? 0,
        demand_qty: demand[item.id] ?? saved?.demand_qty ?? 0,
        frozen_qty: saved?.frozen_qty ?? 0,
      };
    }));

    setWithdrawalEntries((withdrawals.data || []).map((e: Record<string, unknown>) => ({
      name: e.name as string,
      entry_type: e.entry_type as 'raw_material' | 'processed_item',
      supplier_id: (e.supplier_id || '') as string,
      raw_material_id: (e.raw_material_id || '') as string,
      item_id: (e.item_id || '') as string,
      quantity: Number(e.quantity),
    })));

    setMealEntries((meals.data || []).map((e: Record<string, unknown>) => ({
      supplier_id: (e.supplier_id || '') as string,
      raw_material_id: (e.raw_material_id || '') as string,
      quantity: Number(e.quantity),
    })));
  }, [fetchDemandForDate]);

  const initOperation = useCallback(async (date: string, masterRMs: RawMaterial[], masterItems: FactoryItem[]) => {
    setLoading(true);
    try {
      const { data: existing } = await supabase
        .from('daily_factory_operations')
        .select('id, operation_date, status')
        .eq('operation_date', date)
        .maybeSingle();

      let op: Operation;
      if (existing) {
        op = existing as Operation;
      } else {
        // Get opening stock from previous day's closing
        const { rmClosing, itemClosing } = await fetchPreviousClosingStock(date);

        const { data: created, error } = await supabase
          .from('daily_factory_operations')
          .insert([{ operation_date: date, created_by: user?.id, status: 'draft' }])
          .select('id, operation_date, status')
          .single();
        if (error) throw error;
        op = created as Operation;

        // Snapshot: use previous closing if available, else current stock
        if (masterRMs.length > 0) {
          await supabase.from('daily_raw_material_snapshots').insert(
            masterRMs.map(rm => ({
              operation_id: op.id,
              raw_material_id: rm.id,
              opening_quantity: rmClosing[rm.id] ?? rm.current_stock,
            }))
          );
        }
        if (masterItems.length > 0) {
          const stockRes = await supabase.from('factory_stock').select('item_id, current_stock').in('item_id', masterItems.map(i => i.id));
          const stockMap: Record<string, number> = {};
          (stockRes.data || []).forEach((s: { item_id: string; current_stock: number }) => { stockMap[s.item_id] = Number(s.current_stock); });
          await supabase.from('daily_item_snapshots').insert(
            masterItems.map(item => ({
              operation_id: op.id,
              item_id: item.id,
              opening_stock: itemClosing[item.id] ?? stockMap[item.id] ?? 0,
            }))
          );
        }
      }

      setOperation(op);
      await loadOperationData(op.id, masterItems, date);
    } catch (err) {
      console.error('Error initializing operation:', err);
    } finally {
      setLoading(false);
    }
  }, [user?.id, loadOperationData, fetchPreviousClosingStock]);

  useEffect(() => {
    setLoading(true);
    loadMasterData().then(({ rms, items }) => {
      initOperation(selectedDate, rms, items);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate]);

  const refreshMasterData = async () => {
    const { data: rmData } = await supabase.from('raw_materials').select('id, name, unit, current_stock, minimum_stock_level, supplier_id').order('name');
    if (rmData) setRawMaterials(rmData);
  };

  // ---- Closing stock computation (live, used for display and for updating factory_stock on submit) ----
  const computeItemClosing = useCallback((itemId: string, entries: ProductionEntry[], wEntries: WithdrawalEntry[]): number => {
    const entry = entries.find(e => e.item_id === itemId);
    if (!entry) return 0;
    const itemWithdrawn = wEntries.filter(w => w.entry_type === 'processed_item' && w.item_id === itemId).reduce((s, w) => s + w.quantity, 0);
    return Math.max(0, entry.opening_stock + entry.production_qty - entry.demand_qty - itemWithdrawn - entry.frozen_qty);
  }, []);

  const computeRmClosing = useCallback((rmId: string): number => {
    const opening = rmSnapshots[rmId] ?? 0;
    const supply = supplyEntries.filter(e => e.raw_material_id === rmId).reduce((s, e) => s + e.quantity, 0);
    const process = processEntries.filter(e => e.raw_material_id === rmId).reduce((s, e) => s + e.quantity, 0);
    const withdrawn = withdrawalEntries.filter(e => e.entry_type === 'raw_material' && e.raw_material_id === rmId).reduce((s, e) => s + e.quantity, 0);
    const meals = mealEntries.filter(e => e.raw_material_id === rmId).reduce((s, e) => s + e.quantity, 0);
    return Math.max(0, opening + supply - process - withdrawn - meals);
  }, [rmSnapshots, supplyEntries, processEntries, withdrawalEntries, mealEntries]);

  // ---- Persist all sections ----
  const persistAll = async (opId: string, markSubmitted: boolean) => {
    // --- Supply: rebuild POs ---
    const existingSupply = await supabase.from('daily_supply_entries').select('po_id').eq('operation_id', opId);
    const existingPoIds = (existingSupply.data || []).map((e: { po_id: string | null }) => e.po_id).filter(Boolean) as string[];
    await supabase.from('daily_supply_entries').delete().eq('operation_id', opId);
    if (existingPoIds.length > 0) {
      for (const poId of existingPoIds) {
        await supabase.from('raw_material_po_items').delete().eq('po_id', poId);
        await supabase.from('raw_material_purchase_orders').delete().eq('id', poId);
      }
    }

    const bySupplier: Record<string, SupplyEntry[]> = {};
    supplyEntries.forEach(e => {
      if (e.supplier_id && e.raw_material_id && e.quantity > 0) {
        if (!bySupplier[e.supplier_id]) bySupplier[e.supplier_id] = [];
        bySupplier[e.supplier_id].push(e);
      }
    });

    for (const [supplierId, entries] of Object.entries(bySupplier)) {
      const subtotal = entries.reduce((sum, e) => sum + e.total_price, 0);
      const { data: po, error: poErr } = await supabase
        .from('raw_material_purchase_orders')
        .insert([{
          supplier_id: supplierId, created_by: user?.id,
          status: markSubmitted ? 'received' : 'pending',
          subtotal, vat_rate: 0, vat_amount: 0, total: subtotal,
          notes: `Daily operation ${operation?.operation_date}`,
          ...(markSubmitted ? { received_at: new Date().toISOString() } : {}),
        }])
        .select('id')
        .single();
      if (poErr) throw poErr;

      await supabase.from('raw_material_po_items').insert(
        entries.map(e => ({
          po_id: po.id, raw_material_id: e.raw_material_id,
          quantity: e.quantity,
          unit_price: e.quantity > 0 ? e.total_price / e.quantity : 0,
          total: e.total_price,
        }))
      );
      await supabase.from('daily_supply_entries').insert(
        entries.map(e => ({
          operation_id: opId, supplier_id: e.supplier_id,
          raw_material_id: e.raw_material_id,
          quantity: e.quantity, unit_price: e.quantity > 0 ? e.total_price / e.quantity : 0,
          total_price: e.total_price, po_id: po.id,
        }))
      );

      if (markSubmitted) {
        for (const e of entries) {
          const rm = rawMaterials.find(r => r.id === e.raw_material_id);
          if (rm) await supabase.from('raw_materials').update({ current_stock: rm.current_stock + e.quantity }).eq('id', e.raw_material_id);
        }
      }
    }

    // --- Process ---
    await supabase.from('daily_process_entries').delete().eq('operation_id', opId);
    const validProcess = processEntries.filter(e => e.raw_material_id && e.quantity > 0);
    if (validProcess.length > 0) {
      await supabase.from('daily_process_entries').insert(
        validProcess.map(e => ({ operation_id: opId, raw_material_id: e.raw_material_id, quantity: e.quantity }))
      );
      if (markSubmitted) {
        for (const e of validProcess) {
          const rm = rawMaterials.find(r => r.id === e.raw_material_id);
          if (rm) await supabase.from('raw_materials').update({ current_stock: Math.max(0, rm.current_stock - e.quantity) }).eq('id', e.raw_material_id);
        }
      }
    }

    // --- Production (with demand_qty) ---
    await supabase.from('daily_production_entries').delete().eq('operation_id', opId);
    const validProduction = productionEntries.filter(e => e.item_id);
    if (validProduction.length > 0) {
      await supabase.from('daily_production_entries').insert(
        validProduction.map(e => ({
          operation_id: opId, item_id: e.item_id,
          opening_stock: e.opening_stock, production_qty: e.production_qty,
          demand_qty: e.demand_qty, frozen_qty: e.frozen_qty,
        }))
      );
    }

    // --- Withdrawals ---
    await supabase.from('daily_withdrawal_entries').delete().eq('operation_id', opId);
    const validWithdrawals = withdrawalEntries.filter(e => e.quantity > 0 && (e.raw_material_id || e.item_id));
    for (const e of validWithdrawals) {
      await supabase.from('daily_withdrawal_entries').insert([{
        operation_id: opId, name: e.name, entry_type: e.entry_type,
        supplier_id: e.supplier_id || null, raw_material_id: e.raw_material_id || null,
        item_id: e.item_id || null, quantity: e.quantity, stock_deducted: markSubmitted,
      }]);
      if (markSubmitted && e.entry_type === 'raw_material' && e.raw_material_id) {
        const rm = rawMaterials.find(r => r.id === e.raw_material_id);
        if (rm) await supabase.from('raw_materials').update({ current_stock: Math.max(0, rm.current_stock - e.quantity) }).eq('id', e.raw_material_id);
      }
    }

    // --- Meals ---
    await supabase.from('daily_employee_meal_entries').delete().eq('operation_id', opId);
    const validMeals = mealEntries.filter(e => e.raw_material_id && e.quantity > 0);
    for (const e of validMeals) {
      await supabase.from('daily_employee_meal_entries').insert([{
        operation_id: opId, supplier_id: e.supplier_id || null,
        raw_material_id: e.raw_material_id, quantity: e.quantity, stock_deducted: markSubmitted,
      }]);
      if (markSubmitted) {
        const rm = rawMaterials.find(r => r.id === e.raw_material_id);
        if (rm) await supabase.from('raw_materials').update({ current_stock: Math.max(0, rm.current_stock - e.quantity) }).eq('id', e.raw_material_id);
      }
    }

    if (markSubmitted) {
      // Update raw_materials.current_stock to computed closing values
      for (const rm of rawMaterials) {
        const closing = computeRmClosing(rm.id);
        await supabase.from('raw_materials').update({ current_stock: closing }).eq('id', rm.id);
      }

      // Update factory_stock (closing = opening + production - demand - item_withdrawals - frozen)
      for (const item of factoryItems) {
        const closing = computeItemClosing(item.id, validProduction, validWithdrawals);
        const { data: existing } = await supabase.from('factory_stock').select('id').eq('item_id', item.id).maybeSingle();
        if (existing) {
          await supabase.from('factory_stock').update({ current_stock: closing, updated_at: new Date().toISOString() }).eq('item_id', item.id);
        } else {
          await supabase.from('factory_stock').insert([{ item_id: item.id, current_stock: closing, minimum_stock_level: 0 }]);
        }
      }

      // Create a production batch record linking to this daily op
      const { data: batch, error: batchErr } = await supabase
        .from('production_batches')
        .insert([{
          production_date: operation?.operation_date,
          created_by: user?.id,
          notes: `Daily operation ${operation?.operation_date}`,
          daily_operation_id: opId,
        }])
        .select('id')
        .single();

      if (!batchErr && batch) {
        // Inputs: process entries
        if (validProcess.length > 0) {
          await supabase.from('production_inputs').insert(
            validProcess.map(e => ({ batch_id: batch.id, raw_material_id: e.raw_material_id, quantity_used: e.quantity }))
          );
        }
        // Outputs: production entries with production_qty > 0
        const outputItems = validProduction.filter(e => e.production_qty > 0);
        if (outputItems.length > 0) {
          await supabase.from('production_outputs').insert(
            outputItems.map(e => ({ batch_id: batch.id, item_id: e.item_id, quantity_produced: e.production_qty }))
          );
        }
      }

      await supabase.from('daily_factory_operations').update({ status: 'submitted', updated_at: new Date().toISOString() }).eq('id', opId);
      setOperation(prev => prev ? { ...prev, status: 'submitted' } : prev);
      await refreshMasterData();
    }
  };

  const handleSaveDraft = async () => {
    if (!operation) return;
    setActionLoading('draft');
    try {
      await persistAll(operation.id, false);
      await supabase.from('daily_factory_operations').update({ updated_at: new Date().toISOString() }).eq('id', operation.id);
    } catch (err) {
      console.error('Draft save error:', err);
      alert('Error saving draft');
    } finally {
      setActionLoading(null);
    }
  };

  const handleSubmit = async () => {
    if (!operation) return;
    if (!confirm('Submit this daily operation? Stock levels will be updated immediately.')) return;
    setActionLoading('submit');
    try {
      await persistAll(operation.id, true);
    } catch (err) {
      console.error('Submit error:', err);
      alert('Error submitting operation');
    } finally {
      setActionLoading(null);
    }
  };

  const isSubmitted = operation?.status === 'submitted';

  // ---- Pivot groupings ----
  const supplierGroups = suppliers.map(s => ({
    supplier: s,
    rms: rawMaterials.filter(rm => rm.supplier_id === s.id),
  })).filter(g => g.rms.length > 0);
  const unassignedRMs = rawMaterials.filter(rm => !rm.supplier_id);
  const rmColumns = rawMaterials;

  // ---- UI helpers ----
  const SectionHeader = ({ label, sectionKey }: { label: string; sectionKey: SectionKey }) => (
    <div
      className="flex items-center justify-between px-4 py-3 bg-slate-800 text-white rounded-t-lg cursor-pointer select-none print:rounded-none"
      onClick={() => toggleSection(sectionKey)}
    >
      <h3 className="font-semibold text-sm tracking-wide">{label}</h3>
      <span className="print:hidden">
        {collapsed[sectionKey] ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
      </span>
    </div>
  );

  const numInput = (val: number, onChange: (v: number) => void, className = '') => (
    <input
      type="number" min="0" step="0.01"
      value={val || ''}
      onChange={e => onChange(parseFloat(e.target.value) || 0)}
      className={`w-20 text-center px-1 py-1 border border-slate-300 rounded text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 ${className}`}
    />
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <RefreshCw className="w-6 h-6 text-blue-600 animate-spin mr-2" />
        <span className="text-slate-600">Loading operation data...</span>
      </div>
    );
  }

  return (
    <>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #daily-op-print, #daily-op-print * { visibility: visible; }
          #daily-op-print { position: absolute; left: 0; top: 0; width: 100%; }
          .no-print { display: none !important; }
          @page { size: A4 landscape; margin: 10mm; }
        }
      `}</style>

      <div id="daily-op-print" className="space-y-4">
        {/* Header bar */}
        <div className="flex items-center gap-4 bg-white border border-slate-200 rounded-lg px-4 py-3 no-print">
          <label className="text-sm font-medium text-slate-700">Operation Date:</label>
          <input
            type="date" value={selectedDate} max={today}
            onChange={e => setSelectedDate(e.target.value)}
            className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          {operation && (
            <span className={`text-xs px-2 py-1 rounded border font-medium ${
              isSubmitted ? 'bg-green-50 border-green-200 text-green-700' : 'bg-amber-50 border-amber-200 text-amber-700'
            }`}>
              {isSubmitted ? 'Submitted' : 'Draft'}
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button onClick={handleSaveDraft} disabled={!!actionLoading || isSubmitted}
              className="flex items-center gap-1.5 px-4 py-2 text-sm border border-slate-300 rounded-lg hover:bg-slate-50 text-slate-700 disabled:opacity-40">
              <Save className="w-4 h-4" />
              {actionLoading === 'draft' ? 'Saving...' : 'Save Draft'}
            </button>
            <button onClick={handleSubmit} disabled={!!actionLoading || isSubmitted}
              className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40">
              <Send className="w-4 h-4" />
              {actionLoading === 'submit' ? 'Submitting...' : 'Submit'}
            </button>
            {isSubmitted && (
              <button onClick={() => window.print()}
                className="flex items-center gap-1.5 px-4 py-2 text-sm bg-slate-700 text-white rounded-lg hover:bg-slate-800">
                <Printer className="w-4 h-4" /> Print Report
              </button>
            )}
          </div>
        </div>

        {/* Print title */}
        <div className="hidden print:block text-center mb-2">
          <h1 className="text-lg font-bold">التشغيل اليومي لمعمل الدجاج — Daily Factory Operation Report</h1>
          <p className="text-sm text-slate-600">Date: {selectedDate}</p>
        </div>

        {/* 1. Opening Stock */}
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <SectionHeader label={SECTION_LABELS.opening} sectionKey="opening" />
          {!collapsed.opening && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-slate-600">Supplier</th>
                    {rmColumns.map(rm => (
                      <th key={rm.id} className="px-3 py-2 text-center font-medium text-slate-600 whitespace-nowrap">
                        {rm.name}<br /><span className="text-xs font-normal text-slate-400">({rm.unit})</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {supplierGroups.map(({ supplier, rms }) => (
                    <tr key={supplier.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-medium text-slate-800">{supplier.name}</td>
                      {rmColumns.map(rm => (
                        <td key={rm.id} className="px-3 py-2 text-center">
                          {rms.some(r => r.id === rm.id)
                            ? <span className="font-mono text-slate-800">{(rmSnapshots[rm.id] ?? 0).toFixed(2)}</span>
                            : <span className="text-slate-300">—</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {unassignedRMs.length > 0 && (
                    <tr className="hover:bg-slate-50">
                      <td className="px-3 py-2 text-slate-500 italic">Unassigned</td>
                      {rmColumns.map(rm => (
                        <td key={rm.id} className="px-3 py-2 text-center">
                          {!rm.supplier_id
                            ? <span className="font-mono text-slate-800">{(rmSnapshots[rm.id] ?? 0).toFixed(2)}</span>
                            : <span className="text-slate-300">—</span>}
                        </td>
                      ))}
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 2. Today's Supply */}
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <SectionHeader label={SECTION_LABELS.supply} sectionKey="supply" />
          {!collapsed.supply && (
            <div className="p-4 space-y-3">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-slate-600">Supplier</th>
                      <th className="px-3 py-2 text-left font-medium text-slate-600">Raw Material</th>
                      <th className="px-3 py-2 text-center font-medium text-slate-600">Quantity</th>
                      <th className="px-3 py-2 text-center font-medium text-slate-600">Total Price</th>
                      <th className="px-3 py-2 text-center font-medium text-slate-600">Unit Price</th>
                      <th className="px-3 py-2 no-print"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {supplyEntries.map((entry, idx) => {
                      const rm = rawMaterials.find(r => r.id === entry.raw_material_id);
                      const unitPrice = entry.quantity > 0 ? entry.total_price / entry.quantity : 0;
                      return (
                        <tr key={idx} className="hover:bg-slate-50">
                          <td className="px-3 py-2">
                            {isSubmitted
                              ? <span>{suppliers.find(s => s.id === entry.supplier_id)?.name || '—'}</span>
                              : <select value={entry.supplier_id} onChange={e => setSupplyEntries(prev => prev.map((en, i) => i === idx ? { ...en, supplier_id: e.target.value } : en))} className="w-full border border-slate-300 rounded px-2 py-1 text-sm">
                                  <option value="">Select supplier</option>
                                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                </select>
                            }
                          </td>
                          <td className="px-3 py-2">
                            {isSubmitted
                              ? <span>{rm?.name || '—'}</span>
                              : <select value={entry.raw_material_id} onChange={e => setSupplyEntries(prev => prev.map((en, i) => i === idx ? { ...en, raw_material_id: e.target.value } : en))} className="w-full border border-slate-300 rounded px-2 py-1 text-sm">
                                  <option value="">Select material</option>
                                  {rawMaterials.filter(r => !entry.supplier_id || r.supplier_id === entry.supplier_id).map(r => (
                                    <option key={r.id} value={r.id}>{r.name} ({r.unit})</option>
                                  ))}
                                </select>
                            }
                          </td>
                          <td className="px-3 py-2 text-center">
                            {isSubmitted ? <span className="font-mono">{entry.quantity.toFixed(2)}</span>
                              : numInput(entry.quantity, v => setSupplyEntries(prev => prev.map((en, i) => i === idx ? { ...en, quantity: v } : en)))}
                            {rm && <span className="ml-1 text-xs text-slate-400">{rm.unit}</span>}
                          </td>
                          <td className="px-3 py-2 text-center">
                            {isSubmitted ? <span className="font-mono">{entry.total_price.toFixed(2)}</span>
                              : numInput(entry.total_price, v => setSupplyEntries(prev => prev.map((en, i) => i === idx ? { ...en, total_price: v } : en)))}
                          </td>
                          <td className="px-3 py-2 text-center font-mono text-slate-500 text-xs">{unitPrice.toFixed(4)}</td>
                          <td className="px-3 py-2 no-print">
                            {!isSubmitted && <button onClick={() => setSupplyEntries(prev => prev.filter((_, i) => i !== idx))} className="p-1 text-red-500 hover:bg-red-50 rounded"><Trash2 className="w-4 h-4" /></button>}
                          </td>
                        </tr>
                      );
                    })}
                    {supplyEntries.length > 0 && (
                      <tr className="bg-slate-50 font-semibold">
                        <td colSpan={2} className="px-3 py-2 text-right text-slate-700">Total</td>
                        <td className="px-3 py-2 text-center font-mono">{supplyEntries.reduce((s, e) => s + e.quantity, 0).toFixed(2)}</td>
                        <td className="px-3 py-2 text-center font-mono">{supplyEntries.reduce((s, e) => s + e.total_price, 0).toFixed(2)}</td>
                        <td colSpan={2}></td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {!isSubmitted && (
                <button onClick={() => setSupplyEntries(prev => [...prev, { supplier_id: '', raw_material_id: '', quantity: 0, total_price: 0 }])}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-slate-300 rounded-lg hover:bg-slate-50 text-slate-600 no-print">
                  <Plus className="w-4 h-4" /> Add Row
                </button>
              )}
            </div>
          )}
        </div>

        {/* 3. Today's Process */}
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <SectionHeader label={SECTION_LABELS.process} sectionKey="process" />
          {!collapsed.process && (
            <div className="p-4 space-y-3">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-slate-600">Raw Material</th>
                      <th className="px-3 py-2 text-center font-medium text-slate-600">Opening Stock</th>
                      <th className="px-3 py-2 text-center font-medium text-slate-600">Qty Processed</th>
                      <th className="px-3 py-2 text-center font-medium text-slate-600">Remaining</th>
                      <th className="px-3 py-2 no-print"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {processEntries.map((entry, idx) => {
                      const opening = rmSnapshots[entry.raw_material_id] ?? 0;
                      const rm = rawMaterials.find(r => r.id === entry.raw_material_id);
                      const remaining = opening - entry.quantity;
                      return (
                        <tr key={idx} className="hover:bg-slate-50">
                          <td className="px-3 py-2">
                            {isSubmitted ? <span>{rm?.name || '—'}</span>
                              : <select value={entry.raw_material_id} onChange={e => setProcessEntries(prev => prev.map((en, i) => i === idx ? { ...en, raw_material_id: e.target.value } : en))} className="w-full border border-slate-300 rounded px-2 py-1 text-sm">
                                  <option value="">Select material</option>
                                  {rawMaterials.map(r => <option key={r.id} value={r.id}>{r.name} ({r.unit})</option>)}
                                </select>
                            }
                          </td>
                          <td className="px-3 py-2 text-center font-mono text-slate-600">{opening.toFixed(2)}</td>
                          <td className="px-3 py-2 text-center">
                            {isSubmitted ? <span className="font-mono">{entry.quantity.toFixed(2)}</span>
                              : numInput(entry.quantity, v => setProcessEntries(prev => prev.map((en, i) => i === idx ? { ...en, quantity: v } : en)))}
                            {rm && <span className="ml-1 text-xs text-slate-400">{rm.unit}</span>}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <span className={`font-mono ${remaining < 0 ? 'text-red-600 font-bold' : 'text-slate-700'}`}>{remaining.toFixed(2)}</span>
                          </td>
                          <td className="px-3 py-2 no-print">
                            {!isSubmitted && <button onClick={() => setProcessEntries(prev => prev.filter((_, i) => i !== idx))} className="p-1 text-red-500 hover:bg-red-50 rounded"><Trash2 className="w-4 h-4" /></button>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {!isSubmitted && (
                <button onClick={() => setProcessEntries(prev => [...prev, { raw_material_id: '', quantity: 0 }])}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-slate-300 rounded-lg hover:bg-slate-50 text-slate-600 no-print">
                  <Plus className="w-4 h-4" /> Add Row
                </button>
              )}
            </div>
          )}
        </div>

        {/* 4. Daily Items Production & Distribution */}
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <SectionHeader label={SECTION_LABELS.production} sectionKey="production" />
          {!collapsed.production && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-slate-600">Item</th>
                    <th className="px-3 py-2 text-center font-medium text-slate-600 bg-slate-100">Opening Stock</th>
                    <th className="px-3 py-2 text-center font-medium text-slate-600">Production</th>
                    <th className="px-3 py-2 text-center font-medium text-slate-600 bg-amber-50">Demand (Orders)</th>
                    <th className="px-3 py-2 text-center font-medium text-slate-600 bg-blue-50">Frozen</th>
                    <th className="px-3 py-2 text-center font-medium text-slate-600 bg-green-50">Closing Stock</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {productionEntries.map((entry, idx) => {
                    const item = factoryItems.find(it => it.id === entry.item_id);
                    const closing = computeItemClosing(entry.item_id, productionEntries, withdrawalEntries);
                    return (
                      <tr key={idx} className="hover:bg-slate-50">
                        <td className="px-3 py-2 font-medium text-slate-800">
                          <span className="text-xs text-slate-400 font-mono mr-1">{item?.serial}</span>
                          {item?.name}
                        </td>
                        <td className="px-3 py-2 text-center bg-slate-50 font-mono text-slate-700">
                          {entry.opening_stock.toFixed(2)}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {isSubmitted
                            ? <span className="font-mono">{entry.production_qty.toFixed(2)}</span>
                            : numInput(entry.production_qty, v => setProductionEntries(prev => prev.map((en, i) => i === idx ? { ...en, production_qty: v } : en)))
                          }
                        </td>
                        <td className="px-3 py-2 text-center bg-amber-50">
                          <span className="font-mono text-amber-800 font-semibold">{entry.demand_qty.toFixed(2)}</span>
                        </td>
                        <td className="px-3 py-2 text-center bg-blue-50">
                          {isSubmitted
                            ? <span className="font-mono text-blue-700">{entry.frozen_qty.toFixed(2)}</span>
                            : numInput(entry.frozen_qty, v => setProductionEntries(prev => prev.map((en, i) => i === idx ? { ...en, frozen_qty: v } : en)), 'border-blue-300 bg-blue-50')
                          }
                        </td>
                        <td className="px-3 py-2 text-center bg-green-50 font-semibold font-mono text-green-800">
                          {closing.toFixed(2)}
                        </td>
                      </tr>
                    );
                  })}
                  {productionEntries.length === 0 && (
                    <tr><td colSpan={6} className="px-3 py-4 text-center text-slate-400 text-sm">No factory items configured</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 5. Withdrawals */}
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <SectionHeader label={SECTION_LABELS.withdrawals} sectionKey="withdrawals" />
          {!collapsed.withdrawals && (
            <div className="p-4 space-y-3">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-slate-600">Description</th>
                      <th className="px-3 py-2 text-left font-medium text-slate-600">Type</th>
                      <th className="px-3 py-2 text-left font-medium text-slate-600">Material / Item</th>
                      <th className="px-3 py-2 text-left font-medium text-slate-600">Supplier</th>
                      <th className="px-3 py-2 text-center font-medium text-slate-600">Quantity</th>
                      <th className="px-3 py-2 no-print"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {withdrawalEntries.map((entry, idx) => (
                      <tr key={idx} className="hover:bg-slate-50">
                        <td className="px-3 py-2">
                          {isSubmitted ? <span>{entry.name}</span>
                            : <input type="text" value={entry.name} onChange={e => setWithdrawalEntries(prev => prev.map((en, i) => i === idx ? { ...en, name: e.target.value } : en))} placeholder="Description" className="w-full border border-slate-300 rounded px-2 py-1 text-sm" />
                          }
                        </td>
                        <td className="px-3 py-2">
                          {isSubmitted ? <span className="capitalize">{entry.entry_type.replace('_', ' ')}</span>
                            : <select value={entry.entry_type} onChange={e => setWithdrawalEntries(prev => prev.map((en, i) => i === idx ? { ...en, entry_type: e.target.value as 'raw_material' | 'processed_item', raw_material_id: '', item_id: '' } : en))} className="border border-slate-300 rounded px-2 py-1 text-sm">
                                <option value="raw_material">Raw Material</option>
                                <option value="processed_item">Processed Item</option>
                              </select>
                          }
                        </td>
                        <td className="px-3 py-2">
                          {isSubmitted ? (
                            <span>
                              {entry.entry_type === 'raw_material'
                                ? rawMaterials.find(r => r.id === entry.raw_material_id)?.name
                                : factoryItems.find(it => it.id === entry.item_id)?.name}
                            </span>
                          ) : entry.entry_type === 'raw_material' ? (
                            <select value={entry.raw_material_id} onChange={e => setWithdrawalEntries(prev => prev.map((en, i) => i === idx ? { ...en, raw_material_id: e.target.value } : en))} className="w-full border border-slate-300 rounded px-2 py-1 text-sm">
                              <option value="">Select material</option>
                              {rawMaterials.map(rm => <option key={rm.id} value={rm.id}>{rm.name} ({rm.unit})</option>)}
                            </select>
                          ) : (
                            <select value={entry.item_id} onChange={e => setWithdrawalEntries(prev => prev.map((en, i) => i === idx ? { ...en, item_id: e.target.value } : en))} className="w-full border border-slate-300 rounded px-2 py-1 text-sm">
                              <option value="">Select item</option>
                              {factoryItems.map(it => <option key={it.id} value={it.id}>{it.serial} — {it.name}</option>)}
                            </select>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {isSubmitted ? <span>{suppliers.find(s => s.id === entry.supplier_id)?.name || '—'}</span>
                            : <select value={entry.supplier_id} onChange={e => setWithdrawalEntries(prev => prev.map((en, i) => i === idx ? { ...en, supplier_id: e.target.value } : en))} className="w-full border border-slate-300 rounded px-2 py-1 text-sm">
                                <option value="">No supplier</option>
                                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                              </select>
                          }
                        </td>
                        <td className="px-3 py-2 text-center">
                          {isSubmitted ? <span className="font-mono">{entry.quantity.toFixed(2)}</span>
                            : numInput(entry.quantity, v => setWithdrawalEntries(prev => prev.map((en, i) => i === idx ? { ...en, quantity: v } : en)))}
                        </td>
                        <td className="px-3 py-2 no-print">
                          {!isSubmitted && <button onClick={() => setWithdrawalEntries(prev => prev.filter((_, i) => i !== idx))} className="p-1 text-red-500 hover:bg-red-50 rounded"><Trash2 className="w-4 h-4" /></button>}
                        </td>
                      </tr>
                    ))}
                    {withdrawalEntries.length === 0 && (
                      <tr><td colSpan={6} className="px-3 py-4 text-center text-slate-400 text-sm">No withdrawals entered</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              {!isSubmitted && (
                <button onClick={() => setWithdrawalEntries(prev => [...prev, { name: '', entry_type: 'raw_material', supplier_id: '', raw_material_id: '', item_id: '', quantity: 0 }])}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-slate-300 rounded-lg hover:bg-slate-50 text-slate-600 no-print">
                  <Plus className="w-4 h-4" /> Add Row
                </button>
              )}
            </div>
          )}
        </div>

        {/* 6. Employee Meals */}
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <SectionHeader label={SECTION_LABELS.meals} sectionKey="meals" />
          {!collapsed.meals && (
            <div className="p-4 space-y-3">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-slate-600">Supplier</th>
                      <th className="px-3 py-2 text-left font-medium text-slate-600">Raw Material</th>
                      <th className="px-3 py-2 text-center font-medium text-slate-600">Quantity</th>
                      <th className="px-3 py-2 no-print"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {mealEntries.map((entry, idx) => {
                      const rm = rawMaterials.find(r => r.id === entry.raw_material_id);
                      return (
                        <tr key={idx} className="hover:bg-slate-50">
                          <td className="px-3 py-2">
                            {isSubmitted ? <span>{suppliers.find(s => s.id === entry.supplier_id)?.name || '—'}</span>
                              : <select value={entry.supplier_id} onChange={e => setMealEntries(prev => prev.map((en, i) => i === idx ? { ...en, supplier_id: e.target.value, raw_material_id: '' } : en))} className="w-full border border-slate-300 rounded px-2 py-1 text-sm">
                                  <option value="">No supplier</option>
                                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                </select>
                            }
                          </td>
                          <td className="px-3 py-2">
                            {isSubmitted ? <span>{rm?.name || '—'}</span>
                              : <select value={entry.raw_material_id} onChange={e => setMealEntries(prev => prev.map((en, i) => i === idx ? { ...en, raw_material_id: e.target.value } : en))} className="w-full border border-slate-300 rounded px-2 py-1 text-sm">
                                  <option value="">Select material</option>
                                  {rawMaterials.filter(r => !entry.supplier_id || r.supplier_id === entry.supplier_id).map(r => (
                                    <option key={r.id} value={r.id}>{r.name} ({r.unit})</option>
                                  ))}
                                </select>
                            }
                          </td>
                          <td className="px-3 py-2 text-center">
                            {isSubmitted ? <span className="font-mono">{entry.quantity.toFixed(2)}</span>
                              : numInput(entry.quantity, v => setMealEntries(prev => prev.map((en, i) => i === idx ? { ...en, quantity: v } : en)))}
                            {rm && <span className="ml-1 text-xs text-slate-400">{rm.unit}</span>}
                          </td>
                          <td className="px-3 py-2 no-print">
                            {!isSubmitted && <button onClick={() => setMealEntries(prev => prev.filter((_, i) => i !== idx))} className="p-1 text-red-500 hover:bg-red-50 rounded"><Trash2 className="w-4 h-4" /></button>}
                          </td>
                        </tr>
                      );
                    })}
                    {mealEntries.length === 0 && (
                      <tr><td colSpan={4} className="px-3 py-4 text-center text-slate-400 text-sm">No meal entries</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              {!isSubmitted && (
                <button onClick={() => setMealEntries(prev => [...prev, { supplier_id: '', raw_material_id: '', quantity: 0 }])}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-slate-300 rounded-lg hover:bg-slate-50 text-slate-600 no-print">
                  <Plus className="w-4 h-4" /> Add Row
                </button>
              )}
            </div>
          )}
        </div>

        {/* 7. Closing Stock */}
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <SectionHeader label={SECTION_LABELS.closing} sectionKey="closing" />
          {!collapsed.closing && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-slate-600">Supplier</th>
                    {rmColumns.map(rm => (
                      <th key={rm.id} className="px-3 py-2 text-center font-medium text-slate-600 whitespace-nowrap">
                        {rm.name}<br /><span className="text-xs font-normal text-slate-400">({rm.unit})</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {supplierGroups.map(({ supplier, rms }) => (
                    <tr key={supplier.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-medium text-slate-800">{supplier.name}</td>
                      {rmColumns.map(rm => (
                        <td key={rm.id} className="px-3 py-2 text-center">
                          {rms.some(r => r.id === rm.id) ? (
                            <span className={`font-mono font-semibold ${computeRmClosing(rm.id) <= rm.minimum_stock_level ? 'text-red-600' : 'text-green-700'}`}>
                              {computeRmClosing(rm.id).toFixed(2)}
                            </span>
                          ) : <span className="text-slate-300">—</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {unassignedRMs.length > 0 && (
                    <tr className="hover:bg-slate-50">
                      <td className="px-3 py-2 text-slate-500 italic">Unassigned</td>
                      {rmColumns.map(rm => (
                        <td key={rm.id} className="px-3 py-2 text-center">
                          {!rm.supplier_id ? (
                            <span className={`font-mono font-semibold ${computeRmClosing(rm.id) <= rm.minimum_stock_level ? 'text-red-600' : 'text-green-700'}`}>
                              {computeRmClosing(rm.id).toFixed(2)}
                            </span>
                          ) : <span className="text-slate-300">—</span>}
                        </td>
                      ))}
                    </tr>
                  )}
                </tbody>
                <tfoot className="bg-slate-100 border-t-2 border-slate-300">
                  <tr>
                    <td className="px-3 py-2 font-bold text-slate-800">Total</td>
                    {rmColumns.map(rm => (
                      <td key={rm.id} className="px-3 py-2 text-center font-bold font-mono text-slate-800">
                        {computeRmClosing(rm.id).toFixed(2)}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>

        {/* Bottom action bar */}
        <div className="flex items-center justify-end gap-3 pt-2 no-print">
          {!isSubmitted && (
            <>
              <button onClick={handleSaveDraft} disabled={!!actionLoading}
                className="flex items-center gap-1.5 px-5 py-2.5 text-sm border border-slate-300 rounded-lg hover:bg-slate-50 text-slate-700 disabled:opacity-40">
                <Save className="w-4 h-4" />
                {actionLoading === 'draft' ? 'Saving...' : 'Save Draft'}
              </button>
              <button onClick={handleSubmit} disabled={!!actionLoading}
                className="flex items-center gap-1.5 px-5 py-2.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 font-medium">
                <Send className="w-4 h-4" />
                {actionLoading === 'submit' ? 'Submitting...' : 'Submit & Update Stock'}
              </button>
            </>
          )}
          {isSubmitted && (
            <button onClick={() => window.print()}
              className="flex items-center gap-1.5 px-5 py-2.5 text-sm bg-slate-700 text-white rounded-lg hover:bg-slate-800 font-medium">
              <Printer className="w-4 h-4" /> Print Report
            </button>
          )}
        </div>
      </div>
    </>
  );
}
