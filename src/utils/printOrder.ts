import { supabase } from '../lib/supabase';

export async function printOrder(orderId: string, t: (key: string) => string, userRole?: string) {
  try {
    const { data: order, error } = await supabase
      .from('orders')
      .select(`
        id,
        order_number,
        created_at,
        branch:branches(name, location),
        customer:profiles(display_name),
        order_items(
          quantity,
          stock_level,
          item:items(
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

    const sortBySerialAsc = (a: any, b: any) =>
      (a.item?.serial || '').localeCompare(b.item?.serial || '', undefined, { numeric: true, sensitivity: 'base' });

    const warehouseItems = (order as any).order_items
      .filter((oi: any) => oi.item && oi.item.category === 'warehouse' && oi.quantity > 0)
      .sort(sortBySerialAsc);
    const factoryItems = (order as any).order_items
      .filter((oi: any) => oi.item && oi.item.category === 'factory' && (
        oi.quantity > 0 ||
        (oi.item.stock_level_required && oi.stock_level !== null && oi.stock_level !== undefined)
      ))
      .sort(sortBySerialAsc);

    // Dynamic font sizing: fill the A4 page optimally regardless of item count.
    // A4 usable height at 96dpi with 6mm margins ≈ 1065px.
    // Be conservative with chrome estimates to avoid overflow.
    // Fixed chrome (generous estimates):
    //   header: 58px, info-line: 48px, per-section: title(36) + thead(32) + gaps(10)
    const hasBoth = warehouseItems.length > 0 && factoryItems.length > 0;
    const sectionCount = (warehouseItems.length > 0 ? 1 : 0) + (factoryItems.length > 0 ? 1 : 0);
    const fixedHeightPx = 58 + 48 + sectionCount * (36 + 32 + 10) + 30;
    const availableForRowsPx = 1065 - fixedHeightPx;
    // Rows per column = ceil(n/2); when both sections exist they stack, so add both
    const wRows = warehouseItems.length > 0 ? Math.ceil(warehouseItems.length / 2) : 0;
    const fRows = factoryItems.length > 0 ? Math.ceil(factoryItems.length / 2) : 0;
    const totalRows = hasBoth ? wRows + fRows : Math.max(wRows, fRows);
    // Row height px = font-size-px * lineHeight(1.15) + top-pad(2) + bottom-pad(2) + border(1)
    // So: rowHeightPx = fontPx * 1.15 + 5  →  fontPx = (rowHeightPx - 5) / 1.15
    const rowHeightPx = totalRows > 0 ? availableForRowsPx / totalRows : 60;
    const fontPx = Math.max((rowHeightPx - 5) / 1.15, 10);
    const computedFontPt = Math.floor(fontPx * (72 / 96));
    const fontPt = Math.min(Math.max(computedFontPt, 9), 23);

    const printFrame = document.createElement('iframe');
    printFrame.style.position = 'fixed';
    printFrame.style.left = '-9999px';
    printFrame.style.top = '0';
    // A4 at 96 dpi = 794×1123px; give it full size so scrollHeight is accurate
    printFrame.style.width = '794px';
    printFrame.style.height = '1123px';
    printFrame.style.border = '0';
    printFrame.style.visibility = 'hidden';
    document.body.appendChild(printFrame);

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${(order as any).order_number} - Order Receipt</title>
  <style>
    @page {
      size: A4;
      margin: 6mm;
    }

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    html, body {
      width: 100%;
    }

    body {
      font-family: 'Segoe UI', Arial, sans-serif;
      color: #1e293b;
      background: white;
    }

    .container {
      width: 100%;
      display: flex;
      flex-direction: column;
    }

    .header {
      text-align: center;
      margin-bottom: 4px;
      padding: 5px 8px;
      background: linear-gradient(135deg, #1e293b 0%, #334155 100%);
      color: white;
      border-radius: 3px;
    }

    .header h1 {
      font-size: 22pt;
      font-weight: 800;
      letter-spacing: -0.3px;
      line-height: 1.1;
    }

    .info-line {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 4px 10px;
      background: #f8fafc;
      border-radius: 2px;
      margin-bottom: 4px;
      font-size: 13pt;
      font-weight: 700;
    }

    .info-line span {
      font-weight: 700;
      color: #1e293b;
    }

    .section {
      display: flex;
      flex-direction: column;
      margin-bottom: 4px;
    }

    .section-title {
      font-size: 11pt;
      font-weight: 800;
      margin-bottom: 3px;
      padding: 3px 8px;
      background: #f1f5f9;
      border-radius: 2px;
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .section-title::before {
      content: '';
      width: 3px;
      height: 12px;
      background: #3b82f6;
      border-radius: 1px;
      flex-shrink: 0;
    }

    .section-title.warehouse::before { background: #22c55e; }
    .section-title.factory::before   { background: #3b82f6; }

    table {
      width: 100%;
      border-collapse: collapse;
      border: 1px solid #cbd5e1;
    }

    thead {
      background: #334155;
      color: white;
    }

    th {
      font-weight: 800;
      text-align: left;
      padding: 3px 6px;
      font-size: ${Math.max(fontPt - 4, 8)}pt;
      text-transform: uppercase;
      letter-spacing: 0.2px;
      border: 1px solid #475569;
    }

    th:last-child {
      text-align: center;
      width: 54px;
    }

    td {
      padding: 2px 6px;
      border: 1px solid #e2e8f0;
      font-size: ${fontPt}pt;
      font-weight: 700;
      line-height: 1.15;
    }

    td:first-child {
      font-weight: 800;
    }

    td:last-child {
      text-align: center;
      font-weight: 800;
      font-size: ${Math.min(fontPt + 2, 25)}pt;
      width: 54px;
    }

    tbody tr:nth-child(even) {
      background-color: #f8fafc;
    }

    .serial-cell {
      font-weight: 800;
      color: #1e3a8a;
      font-family: 'Courier New', monospace;
      white-space: nowrap;
    }

    .items-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 5px;
    }

    @media print {
      body {
        print-color-adjust: exact;
        -webkit-print-color-adjust: exact;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>ORDER RECEIPT - ${(order as any).order_number}</h1>
    </div>

    <div class="info-line">
      <span>Branch: ${(order as any).branch?.name || 'N/A'}</span>
      <span>Date: ${new Date((order as any).created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</span>
    </div>

  ${warehouseItems.length > 0 ? (() => {
    const half = Math.ceil(warehouseItems.length / 2);
    const leftCol = warehouseItems.slice(0, half);
    const rightCol = warehouseItems.slice(half);
    const renderWarehouseRow = (oi: any) => `
      <tr>
        <td>${oi.item.serial}</td>
        <td>${oi.item.name}</td>
        <td>${oi.quantity}</td>
      </tr>
    `;
    return `
  <div class="section">
    <div class="section-title warehouse">${t('warehouse_items')}</div>
    <div class="items-grid">
      <div class="items-column">
        <table>
          <thead><tr><th>${t('serial')}</th><th>${t('name')}</th><th>${t('quantity')}</th></tr></thead>
          <tbody>${leftCol.map(renderWarehouseRow).join('')}</tbody>
        </table>
      </div>
      <div class="items-column">
        <table>
          <thead><tr><th>${t('serial')}</th><th>${t('name')}</th><th>${t('quantity')}</th></tr></thead>
          <tbody>${rightCol.map(renderWarehouseRow).join('')}</tbody>
        </table>
      </div>
    </div>
  </div>
  `;
  })() : ''}

  ${factoryItems.length > 0 ? (() => {
    const half = Math.ceil(factoryItems.length / 2);
    const leftCol = factoryItems.slice(0, half);
    const rightCol = factoryItems.slice(half);
    const renderFactoryRow = (item: any) => `
      <tr>
        <td><span class="serial-cell">${item.item.serial}:</span> ${item.item.name}</td>
        <td>${item.quantity}</td>
      </tr>
    `;
    return `
  <div class="section">
    <div class="section-title factory">${t('factory_items')}</div>
    <div class="items-grid">
      <div class="items-column">
        <table>
          <thead><tr><th>${t('name')}</th><th>${t('quantity')}</th></tr></thead>
          <tbody>${leftCol.map(renderFactoryRow).join('')}</tbody>
        </table>
      </div>
      <div class="items-column">
        <table>
          <thead><tr><th>${t('name')}</th><th>${t('quantity')}</th></tr></thead>
          <tbody>${rightCol.map(renderFactoryRow).join('')}</tbody>
        </table>
      </div>
    </div>
  </div>
  `;
  })() : ''}

  </div>
</body>
</html>
    `;

    const doc = printFrame.contentWindow?.document;
    if (!doc) {
      document.body.removeChild(printFrame);
      alert('Unable to initialize print');
      return;
    }

    doc.open();
    doc.write(html);
    doc.close();

    setTimeout(() => {
      try {
        const win = printFrame.contentWindow;
        if (win) {
          const docEl = win.document.documentElement;
          // A4 usable area at 96dpi with 6mm margins each side
          const pageW = 782;
          const pageH = 1065;
          const contentW = docEl.scrollWidth;
          const contentH = docEl.scrollHeight;
          const scale = Math.min(pageW / contentW, pageH / contentH, 1);
          if (scale < 0.999) {
            // Apply zoom to html element as a guaranteed safety net
            docEl.style.zoom = String(Math.floor(scale * 1000) / 1000);
          }
        }
        printFrame.contentWindow?.focus();
        printFrame.contentWindow?.print();
        setTimeout(() => {
          document.body.removeChild(printFrame);
        }, 1500);
      } catch (e) {
        console.error('Print error:', e);
        document.body.removeChild(printFrame);
        alert('Print failed. Please try again.');
      }
    }, 500);
  } catch (error) {
    console.error('Error printing order:', error);
    alert(t('error'));
  }
}
