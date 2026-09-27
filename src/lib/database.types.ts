export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      branches: {
        Row: {
          code: string | null
          created_at: string | null
          created_by: string | null
          id: string
          internal_only: boolean
          location: string
          name: string
          updated_at: string | null
        }
        Insert: {
          code?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          internal_only?: boolean
          location: string
          name: string
          updated_at?: string | null
        }
        Update: {
          code?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          internal_only?: boolean
          location?: string
          name?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "branches_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_employee_meal_entries: {
        Row: {
          created_at: string | null
          id: string
          operation_id: string
          quantity: number
          raw_material_id: string | null
          stock_deducted: boolean
          supplier_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          operation_id: string
          quantity?: number
          raw_material_id?: string | null
          stock_deducted?: boolean
          supplier_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          operation_id?: string
          quantity?: number
          raw_material_id?: string | null
          stock_deducted?: boolean
          supplier_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_employee_meal_entries_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: false
            referencedRelation: "daily_factory_operations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_employee_meal_entries_raw_material_id_fkey"
            columns: ["raw_material_id"]
            isOneToOne: false
            referencedRelation: "raw_materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_employee_meal_entries_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_factory_operations: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: string
          notes: string | null
          operation_date: string
          status: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          notes?: string | null
          operation_date?: string
          status?: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          notes?: string | null
          operation_date?: string
          status?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      daily_item_snapshots: {
        Row: {
          created_at: string | null
          id: string
          item_id: string
          opening_stock: number
          operation_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          item_id: string
          opening_stock?: number
          operation_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          item_id?: string
          opening_stock?: number
          operation_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_item_snapshots_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_item_snapshots_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: false
            referencedRelation: "daily_factory_operations"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_process_entries: {
        Row: {
          created_at: string | null
          id: string
          operation_id: string
          quantity: number
          raw_material_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          operation_id: string
          quantity?: number
          raw_material_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          operation_id?: string
          quantity?: number
          raw_material_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_process_entries_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: false
            referencedRelation: "daily_factory_operations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_process_entries_raw_material_id_fkey"
            columns: ["raw_material_id"]
            isOneToOne: false
            referencedRelation: "raw_materials"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_production_entries: {
        Row: {
          created_at: string | null
          demand_qty: number
          frozen_qty: number
          id: string
          item_id: string
          opening_stock: number
          operation_id: string
          production_qty: number
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          demand_qty?: number
          frozen_qty?: number
          id?: string
          item_id: string
          opening_stock?: number
          operation_id: string
          production_qty?: number
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          demand_qty?: number
          frozen_qty?: number
          id?: string
          item_id?: string
          opening_stock?: number
          operation_id?: string
          production_qty?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_production_entries_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_production_entries_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: false
            referencedRelation: "daily_factory_operations"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_raw_material_snapshots: {
        Row: {
          created_at: string | null
          id: string
          opening_quantity: number
          operation_id: string
          raw_material_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          opening_quantity?: number
          operation_id: string
          raw_material_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          opening_quantity?: number
          operation_id?: string
          raw_material_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_raw_material_snapshots_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: false
            referencedRelation: "daily_factory_operations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_raw_material_snapshots_raw_material_id_fkey"
            columns: ["raw_material_id"]
            isOneToOne: false
            referencedRelation: "raw_materials"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_supply_entries: {
        Row: {
          created_at: string | null
          id: string
          operation_id: string
          po_id: string | null
          quantity: number
          raw_material_id: string
          supplier_id: string
          total_price: number
          unit_price: number
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          operation_id: string
          po_id?: string | null
          quantity?: number
          raw_material_id: string
          supplier_id: string
          total_price?: number
          unit_price?: number
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          operation_id?: string
          po_id?: string | null
          quantity?: number
          raw_material_id?: string
          supplier_id?: string
          total_price?: number
          unit_price?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_supply_entries_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: false
            referencedRelation: "daily_factory_operations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_supply_entries_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "raw_material_purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_supply_entries_raw_material_id_fkey"
            columns: ["raw_material_id"]
            isOneToOne: false
            referencedRelation: "raw_materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_supply_entries_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_withdrawal_entries: {
        Row: {
          created_at: string | null
          entry_type: string
          id: string
          item_id: string | null
          name: string
          operation_id: string
          quantity: number
          raw_material_id: string | null
          stock_deducted: boolean
          supplier_id: string | null
        }
        Insert: {
          created_at?: string | null
          entry_type: string
          id?: string
          item_id?: string | null
          name?: string
          operation_id: string
          quantity?: number
          raw_material_id?: string | null
          stock_deducted?: boolean
          supplier_id?: string | null
        }
        Update: {
          created_at?: string | null
          entry_type?: string
          id?: string
          item_id?: string | null
          name?: string
          operation_id?: string
          quantity?: number
          raw_material_id?: string | null
          stock_deducted?: boolean
          supplier_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_withdrawal_entries_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_withdrawal_entries_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: false
            referencedRelation: "daily_factory_operations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_withdrawal_entries_raw_material_id_fkey"
            columns: ["raw_material_id"]
            isOneToOne: false
            referencedRelation: "raw_materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_withdrawal_entries_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      factory_stock: {
        Row: {
          current_stock: number
          id: string
          item_id: string
          minimum_stock_level: number
          updated_at: string | null
        }
        Insert: {
          current_stock?: number
          id?: string
          item_id: string
          minimum_stock_level?: number
          updated_at?: string | null
        }
        Update: {
          current_stock?: number
          id?: string
          item_id?: string
          minimum_stock_level?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "factory_stock_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: true
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      items: {
        Row: {
          category: string
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          name: string
          order_index: number | null
          picture_url: string | null
          serial: string
          stock_level_required: boolean | null
          unit_price: number
          updated_at: string | null
        }
        Insert: {
          category: string
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          order_index?: number | null
          picture_url?: string | null
          serial: string
          stock_level_required?: boolean | null
          unit_price?: number
          updated_at?: string | null
        }
        Update: {
          category?: string
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          order_index?: number | null
          picture_url?: string | null
          serial?: string
          stock_level_required?: boolean | null
          unit_price?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "items_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      order_history: {
        Row: {
          created_at: string | null
          event_type: string
          id: string
          notes: string | null
          order_id: string
          performed_by: string | null
        }
        Insert: {
          created_at?: string | null
          event_type: string
          id?: string
          notes?: string | null
          order_id: string
          performed_by?: string | null
        }
        Update: {
          created_at?: string | null
          event_type?: string
          id?: string
          notes?: string | null
          order_id?: string
          performed_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_history_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_history_performed_by_profiles_fkey"
            columns: ["performed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          created_at: string | null
          id: string
          item_id: string | null
          order_id: string
          quantity: number
          stock_level: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          item_id?: string | null
          order_id: string
          quantity: number
          stock_level?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          item_id?: string | null
          order_id?: string
          quantity?: number
          stock_level?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          approved_at: string | null
          archived: boolean
          branch_id: string
          category: string
          completed_at: string | null
          created_at: string | null
          customer_id: string
          id: string
          order_number: string
          status: string | null
          updated_at: string | null
        }
        Insert: {
          approved_at?: string | null
          archived?: boolean
          branch_id: string
          category: string
          completed_at?: string | null
          created_at?: string | null
          customer_id: string
          id?: string
          order_number: string
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          approved_at?: string | null
          archived?: boolean
          branch_id?: string
          category?: string
          completed_at?: string | null
          created_at?: string | null
          customer_id?: string
          id?: string
          order_number?: string
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      production_batches: {
        Row: {
          batch_number: string
          created_at: string | null
          created_by: string
          daily_operation_id: string | null
          id: string
          notes: string | null
          production_date: string
        }
        Insert: {
          batch_number: string
          created_at?: string | null
          created_by: string
          daily_operation_id?: string | null
          id?: string
          notes?: string | null
          production_date?: string
        }
        Update: {
          batch_number?: string
          created_at?: string | null
          created_by?: string
          daily_operation_id?: string | null
          id?: string
          notes?: string | null
          production_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_batches_daily_operation_id_fkey"
            columns: ["daily_operation_id"]
            isOneToOne: false
            referencedRelation: "daily_factory_operations"
            referencedColumns: ["id"]
          },
        ]
      }
      production_inputs: {
        Row: {
          batch_id: string
          created_at: string | null
          id: string
          quantity_used: number
          raw_material_id: string
        }
        Insert: {
          batch_id: string
          created_at?: string | null
          id?: string
          quantity_used: number
          raw_material_id: string
        }
        Update: {
          batch_id?: string
          created_at?: string | null
          id?: string
          quantity_used?: number
          raw_material_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_inputs_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "production_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_inputs_raw_material_id_fkey"
            columns: ["raw_material_id"]
            isOneToOne: false
            referencedRelation: "raw_materials"
            referencedColumns: ["id"]
          },
        ]
      }
      production_outputs: {
        Row: {
          batch_id: string
          created_at: string | null
          id: string
          item_id: string
          quantity_produced: number
        }
        Insert: {
          batch_id: string
          created_at?: string | null
          id?: string
          item_id: string
          quantity_produced: number
        }
        Update: {
          batch_id?: string
          created_at?: string | null
          id?: string
          item_id?: string
          quantity_produced?: number
        }
        Relationships: [
          {
            foreignKeyName: "production_outputs_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "production_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_outputs_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string | null
          display_name: string
          email: string
          id: string
          role: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          display_name: string
          email: string
          id: string
          role: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          display_name?: string
          email?: string
          id?: string
          role?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      raw_material_po_items: {
        Row: {
          created_at: string | null
          id: string
          po_id: string
          quantity: number
          raw_material_id: string
          total: number
          unit_price: number
        }
        Insert: {
          created_at?: string | null
          id?: string
          po_id: string
          quantity: number
          raw_material_id: string
          total: number
          unit_price: number
        }
        Update: {
          created_at?: string | null
          id?: string
          po_id?: string
          quantity?: number
          raw_material_id?: string
          total?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "raw_material_po_items_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "raw_material_purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "raw_material_po_items_raw_material_id_fkey"
            columns: ["raw_material_id"]
            isOneToOne: false
            referencedRelation: "raw_materials"
            referencedColumns: ["id"]
          },
        ]
      }
      raw_material_purchase_orders: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string | null
          created_by: string
          id: string
          notes: string | null
          po_number: string
          received_at: string | null
          status: string
          subtotal: number
          supplier_id: string
          total: number
          updated_at: string | null
          vat_amount: number
          vat_rate: number
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          created_by: string
          id?: string
          notes?: string | null
          po_number: string
          received_at?: string | null
          status?: string
          subtotal?: number
          supplier_id: string
          total?: number
          updated_at?: string | null
          vat_amount?: number
          vat_rate?: number
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          created_by?: string
          id?: string
          notes?: string | null
          po_number?: string
          received_at?: string | null
          status?: string
          subtotal?: number
          supplier_id?: string
          total?: number
          updated_at?: string | null
          vat_amount?: number
          vat_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "raw_material_purchase_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      raw_materials: {
        Row: {
          created_at: string | null
          current_stock: number
          description: string | null
          id: string
          minimum_stock_level: number
          name: string
          supplier_id: string | null
          unit: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          current_stock?: number
          description?: string | null
          id?: string
          minimum_stock_level?: number
          name: string
          supplier_id?: string | null
          unit: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          current_stock?: number
          description?: string | null
          id?: string
          minimum_stock_level?: number
          name?: string
          supplier_id?: string | null
          unit?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "raw_materials_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_adjustments: {
        Row: {
          adjusted_by: string
          adjustment_type: string
          created_at: string | null
          difference: number
          id: string
          item_id: string | null
          quantity_after: number
          quantity_before: number
          raw_material_id: string | null
          reason: string
          reference_id: string
        }
        Insert: {
          adjusted_by: string
          adjustment_type: string
          created_at?: string | null
          difference: number
          id?: string
          item_id?: string | null
          quantity_after: number
          quantity_before: number
          raw_material_id?: string | null
          reason: string
          reference_id: string
        }
        Update: {
          adjusted_by?: string
          adjustment_type?: string
          created_at?: string | null
          difference?: number
          id?: string
          item_id?: string | null
          quantity_after?: number
          quantity_before?: number
          raw_material_id?: string | null
          reason?: string
          reference_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_adjustments_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_adjustments_raw_material_id_fkey"
            columns: ["raw_material_id"]
            isOneToOne: false
            referencedRelation: "raw_materials"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          address: string | null
          contact_person: string | null
          created_at: string | null
          email: string | null
          id: string
          name: string
          phone: string | null
          type: string
          updated_at: string | null
        }
        Insert: {
          address?: string | null
          contact_person?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          name: string
          phone?: string | null
          type: string
          updated_at?: string | null
        }
        Update: {
          address?: string | null
          contact_person?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          name?: string
          phone?: string | null
          type?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      trigger_debug_log: {
        Row: {
          condition_met: boolean | null
          created_at: string | null
          error_message: string | null
          id: string
          new_status: string | null
          old_status: string | null
          po_id: string | null
          po_number: string | null
          rows_updated: number | null
          trigger_name: string
        }
        Insert: {
          condition_met?: boolean | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          new_status?: string | null
          old_status?: string | null
          po_id?: string | null
          po_number?: string | null
          rows_updated?: number | null
          trigger_name: string
        }
        Update: {
          condition_met?: boolean | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          new_status?: string | null
          old_status?: string | null
          po_id?: string | null
          po_number?: string | null
          rows_updated?: number | null
          trigger_name?: string
        }
        Relationships: []
      }
      warehouse_po_items: {
        Row: {
          created_at: string | null
          id: string
          item_id: string | null
          po_id: string
          quantity: number
          total: number
          unit_price: number
        }
        Insert: {
          created_at?: string | null
          id?: string
          item_id?: string | null
          po_id: string
          quantity: number
          total: number
          unit_price: number
        }
        Update: {
          created_at?: string | null
          id?: string
          item_id?: string | null
          po_id?: string
          quantity?: number
          total?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "warehouse_po_items_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warehouse_po_items_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "warehouse_purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      warehouse_purchase_orders: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string | null
          created_by: string
          id: string
          notes: string | null
          po_number: string
          received_at: string | null
          status: string
          subtotal: number
          supplier_id: string
          total: number
          updated_at: string | null
          vat_amount: number
          vat_rate: number
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          created_by: string
          id?: string
          notes?: string | null
          po_number: string
          received_at?: string | null
          status?: string
          subtotal?: number
          supplier_id: string
          total?: number
          updated_at?: string | null
          vat_amount?: number
          vat_rate?: number
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          created_by?: string
          id?: string
          notes?: string | null
          po_number?: string
          received_at?: string | null
          status?: string
          subtotal?: number
          supplier_id?: string
          total?: number
          updated_at?: string | null
          vat_amount?: number
          vat_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "warehouse_purchase_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      warehouse_stock: {
        Row: {
          current_stock_purchase_units: number
          current_stock_sale_units: number
          id: string
          item_id: string
          updated_at: string | null
        }
        Insert: {
          current_stock_purchase_units?: number
          current_stock_sale_units?: number
          id?: string
          item_id: string
          updated_at?: string | null
        }
        Update: {
          current_stock_purchase_units?: number
          current_stock_sale_units?: number
          id?: string
          item_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "warehouse_stock_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: true
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      warehouse_units: {
        Row: {
          created_at: string | null
          id: string
          item_id: string
          minimum_stock_purchase_units: number
          purchase_to_sale_ratio: number
          purchase_unit: string
          sale_unit: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          item_id: string
          minimum_stock_purchase_units?: number
          purchase_to_sale_ratio?: number
          purchase_unit: string
          sale_unit: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          item_id?: string
          minimum_stock_purchase_units?: number
          purchase_to_sale_ratio?: number
          purchase_unit?: string
          sale_unit?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "warehouse_units_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: true
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_user_role: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      generate_batch_number: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      generate_order_number: {
        Args: { p_category: string }
        Returns: string
      }
      generate_raw_material_po_number: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      generate_warehouse_po_number: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      get_factory_low_stock_items: {
        Args: Record<PropertyKey, never>
        Returns: {
          current_stock: number
          item: Json
          item_id: string
          minimum_stock_level: number
        }[]
      }
      get_raw_material_low_stock_items: {
        Args: Record<PropertyKey, never>
        Returns: {
          current_stock: number
          id: string
          minimum_stock_level: number
          name: string
          unit: string
        }[]
      }
      get_warehouse_low_stock_items: {
        Args: Record<PropertyKey, never>
        Returns: {
          current_stock_purchase_units: number
          item: Json
          item_id: string
          warehouse_units: Json
        }[]
      }
      is_factory_manager: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      is_factory_or_admin: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

