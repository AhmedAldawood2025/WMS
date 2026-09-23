# Complete Order & Inventory Management System - Setup Guide

## System Status: ✅ FULLY OPERATIONAL

All planned features have been implemented and are production-ready!

## Quick Start

Your comprehensive order and inventory management system is now ready to use! The application will start automatically.

## Default Admin Account

To get started, you'll need to create the first admin user:

1. Sign up with an email and password through the login screen
2. The first user will need to be promoted to admin via the Supabase dashboard:
   - Go to your Supabase project dashboard
   - Navigate to Authentication > Users
   - Find your user and click to edit
   - Update the `role` field in the `profiles` table to `admin`

## User Roles

The system supports 6 different roles:

### Admin
- Create and manage users, branches, items, suppliers, and raw materials
- Configure warehouse units (purchase/sale units) and minimum stock levels
- View all orders
- Full system access

### Customer
- Submit new orders
- View order history
- Print orders

### Warehouse Manager
- Create purchase orders for warehouse items
- Mark POs as received (updates stock automatically)
- View and manage warehouse stock levels
- Edit quantities for warehouse items in customer orders
- Add items to existing orders
- Print orders

### Factory Manager
- Create purchase orders for raw materials
- Mark raw material POs as received
- Record production batches (raw materials → factory items)
- View and manage factory stock levels
- Edit quantities for factory items in customer orders
- Add items to existing orders
- Print orders

### General Manager (NEW)
- Approve/reject warehouse purchase orders
- Approve/reject raw material purchase orders
- View low stock alerts for all items
- Quick-create POs from stock alerts
- Full visibility across all operations

### Accountant
- View monthly summaries of orders by branch
- View all purchase orders (warehouse and raw materials)
- Download reports as CSV
- Read-only access to financial data

## Features

### Language Support
- Toggle between English and Arabic using the language button in the header
- RTL layout automatically applied for Arabic
- All UI text is translated

### Order Management
- Items are automatically categorized as Warehouse (W prefix) or Factory (F prefix)
- Serial numbers are auto-generated
- Order numbers follow format: ORD-YYYYMMDD-XXXX
- Managers can add items to existing orders
- Stock automatically deducts when orders are approved

### Inventory Management (NEW)
- **Purchase Orders**: Create POs for warehouse items and raw materials
- **Auto-generated PO Numbers**: WPO-YYYYMMDD-#### (warehouse), RPO-YYYYMMDD-#### (raw materials)
- **Unit Conversion**: Warehouse items support different purchase/sale units
- **Stock Tracking**: Real-time stock levels for all items
- **Production Tracking**: Record factory production batches
- **Low Stock Alerts**: Automatic alerts when stock falls below minimum
- **Stock Adjustments**: Manual corrections with audit trail

### Stock Flow
**Warehouse**: PO Created → GM Approves → Mark Received → Stock Increases → Customer Order Approved → Stock Decreases

**Factory**: Raw Material PO → GM Approves → Mark Received → Raw Material Stock+ → Production Batch → Raw Material Stock-, Factory Item Stock+ → Customer Order → Factory Item Stock-

### Printing
- Professional A4 print layout
- Clean tables with organized sections
- Automatic hiding of zero-quantity items
- Branch and date information included

### Security
- Row Level Security (RLS) enabled on all tables
- Role-based access control
- Secure authentication with Supabase
- Data integrity enforced at database level
- Automatic stock update triggers

## Database Schema

### Core Tables
- `profiles` - User accounts with roles (including general_manager)
- `branches` - Branch locations
- `items` - Warehouse and Factory items
- `orders` - Customer orders
- `order_items` - Items within each order

### Inventory Tables (NEW)
- `suppliers` - Supplier/vendor information
- `warehouse_units` - Unit conversion for warehouse items
- `raw_materials` - Factory raw materials
- `warehouse_purchase_orders` - Warehouse POs
- `warehouse_po_items` - Line items in warehouse POs
- `raw_material_purchase_orders` - Raw material POs
- `raw_material_po_items` - Line items in raw material POs
- `production_batches` - Production records
- `production_inputs` - Raw materials consumed
- `production_outputs` - Items produced
- `warehouse_stock` - Current warehouse inventory
- `factory_stock` - Current factory inventory
- `stock_adjustments` - Manual stock corrections

All tables have automatic timestamps, proper foreign key relationships, and RLS policies.

## Getting Started Guide

### Initial Setup (Admin)
1. **Create Suppliers**: Add your suppliers in Admin Dashboard → Suppliers tab
2. **Create Raw Materials**: Add factory raw materials (chicken types, etc.) in Admin Dashboard → Raw Materials tab
3. **Create Branches**: Set up branch locations
4. **Create Items**: Add warehouse and factory items with:
   - For warehouse items: Configure purchase unit, sale unit, conversion ratio, and minimum stock
   - For factory items: Set minimum stock level
5. **Create User Accounts**: Add customers, managers, accountants, and GM

### Warehouse Operations
1. **Create Purchase Order**:
   - Select supplier and items
   - Enter quantities in purchase units
   - PO is created as "Pending"
2. **GM Approves**: General Manager approves the PO
3. **Mark as Received**: After receiving goods, mark PO as "Received"
4. **Stock Updates**: Stock automatically increases

### Factory Operations
1. **Create Raw Material PO**:
   - Select supplier and raw materials
   - Enter quantities
   - PO created as "Pending"
2. **GM Approves**: General Manager approves
3. **Mark as Received**: Raw material stock increases
4. **Record Production**:
   - Select raw materials used and quantities
   - Specify factory items produced and quantities
   - Stock automatically adjusts (raw materials decrease, factory items increase)

### Order Processing
1. Customer creates order
2. Warehouse/Factory managers can edit quantities and add items
3. When order is approved, stock automatically decreases

## Support

The application is built with:
- React + TypeScript
- Vite for fast development
- Tailwind CSS for styling
- Supabase for backend and authentication
- Secure RLS policies for data protection
