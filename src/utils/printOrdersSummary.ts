import { supabase } from '../lib/supabase';

interface AggregatedItem {
  serial: string;
  name: string;
  totalQuantity: number;
  category: 'warehouse' | 'factory';
}

export async function printOrdersSummary(orderIds: string[], t: (key: string) => string) {
  try {
    const { data: orders, error } = await supabase
      .from('orders')
      .select(`
        id,
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
      .in('id', orderIds);

    if (error) throw error;

    const itemsMap = new Map<string, AggregatedItem>();

    (orders as any).forEach((order: any) => {
      order.order_items.forEach((oi: any) => {
        if (!oi.item) return;

        const key = `${oi.item.serial}-${oi.item.category}`;
        const quantity = oi.quantity || 0;

        if (oi.item.category === 'warehouse' && quantity === 0) return;
        if (oi.item.category === 'factory' && quantity === 0 &&
            !(oi.item.stock_level_required && oi.stock_level !== null && oi.stock_level !== undefined)) {
          return;
        }

        if (itemsMap.has(key)) {
          const existing = itemsMap.get(key)!;
          existing.totalQuantity += quantity;
        } else {
          itemsMap.set(key, {
            serial: oi.item.serial,
            name: oi.item.name,
            totalQuantity: quantity,
            category: oi.item.category
          });
        }
      });
    });

    const allItems = Array.from(itemsMap.values());
    const warehouseItems = allItems.filter(item => item.category === 'warehouse');
    const factoryItems = allItems.filter(item => item.category === 'factory');

    const printFrame = document.createElement('iframe');
    printFrame.style.position = 'fixed';
    printFrame.style.right = '0';
    printFrame.style.bottom = '0';
    printFrame.style.width = '0';
    printFrame.style.height = '0';
    printFrame.style.border = '0';
    document.body.appendChild(printFrame);

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Orders Summary</title>
  <style>
    @page {
      size: A4;
      margin: 8mm;
    }

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: 'Segoe UI', Arial, sans-serif;
      font-size: 7pt;
      line-height: 1.2;
      color: #1e293b;
      background: white;
      height: 100vh;
      display: flex;
      flex-direction: column;
    }

    .container {
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      padding: 0;
    }

    .header {
      text-align: center;
      margin-bottom: 6px;
      padding: 6px;
      background: linear-gradient(135deg, #1e293b 0%, #334155 100%);
      color: white;
      border-radius: 3px;
    }

    .header h1 {
      font-size: 11pt;
      font-weight: 700;
      letter-spacing: -0.2px;
    }

    .info-line {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 4px 8px;
      background: #f8fafc;
      border-radius: 2px;
      margin-bottom: 6px;
      font-size: 7pt;
    }

    .info-line span {
      font-weight: 600;
      color: #1e293b;
    }

    .section {
      flex: 1;
      display: flex;
      flex-direction: column;
      margin-bottom: 6px;
      page-break-inside: avoid;
    }

    .section-title {
      font-size: 8pt;
      font-weight: 700;
      margin-bottom: 4px;
      padding: 3px 6px;
      background: #f1f5f9;
      border-radius: 2px;
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .section-title::before {
      content: '';
      width: 2px;
      height: 12px;
      background: #3b82f6;
      border-radius: 1px;
    }

    .section-title.warehouse::before {
      background: #22c55e;
    }

    .section-title.factory::before {
      background: #3b82f6;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      border: 1px solid #cbd5e1;
      height: 100%;
    }

    thead {
      background: #334155;
      color: white;
    }

    th {
      font-weight: 600;
      text-align: left;
      padding: 3px 4px;
      font-size: 6.5pt;
      text-transform: uppercase;
      letter-spacing: 0.2px;
      border: 1px solid #475569;
    }

    th:last-child {
      text-align: center;
      width: 35px;
    }

    td {
      padding: 2px 4px;
      border: 1px solid #e2e8f0;
      font-size: 6.5pt;
      line-height: 1.1;
    }

    td:first-child {
      font-weight: 700;
      font-size: 8.5pt;
    }

    td:last-child {
      text-align: center;
      font-weight: 700;
      font-size: 8.5pt;
    }

    tbody tr:nth-child(even) {
      background-color: #f8fafc;
    }

    .serial-cell {
      font-weight: 600;
      color: #3730a3;
      font-family: 'Courier New', monospace;
      white-space: nowrap;
    }

    .items-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
      flex: 1;
    }

    .items-column {
      display: flex;
      flex-direction: column;
      height: 100%;
    }

    .items-column table {
      width: 100%;
      height: 100%;
    }

    @media print {
      body {
        print-color-adjust: exact;
        -webkit-print-color-adjust: exact;
      }

      .container {
        padding: 0;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>ORDERS SUMMARY</h1>
    </div>

    <div class="info-line">
      <span>Total Orders: ${orderIds.length}</span>
      <span>Date: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</span>
    </div>

  ${warehouseItems.length > 0 ? `
  <div class="section">
    <div class="section-title warehouse">${t('warehouse_items')}</div>
    <div class="items-grid">
      <div class="items-column">
        <table>
          <thead>
            <tr>
              <th>${t('serial')}</th>
              <th>${t('name')}</th>
              <th>${t('quantity')}</th>
            </tr>
          </thead>
          <tbody>
            ${warehouseItems.filter((_: any, i: number) => i % 2 === 0).map((item: any) => `
              <tr>
                <td><span class="serial-badge">${item.serial}</span></td>
                <td>${item.name}</td>
                <td><span class="quantity-badge">${item.totalQuantity}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <div class="items-column">
        <table>
          <thead>
            <tr>
              <th>${t('serial')}</th>
              <th>${t('name')}</th>
              <th>${t('quantity')}</th>
            </tr>
          </thead>
          <tbody>
            ${warehouseItems.filter((_: any, i: number) => i % 2 === 1).map((item: any) => `
              <tr>
                <td><span class="serial-badge">${item.serial}</span></td>
                <td>${item.name}</td>
                <td><span class="quantity-badge">${item.totalQuantity}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  </div>
  ` : ''}

  ${factoryItems.length > 0 ? `
  <div class="section">
    <div class="section-title factory">${t('factory_items')}</div>
    <div class="items-grid">
      <div class="items-column">
        <table>
          <thead>
            <tr>
              <th>${t('name')}</th>
              <th>${t('quantity')}</th>
            </tr>
          </thead>
          <tbody>
            ${Array.from({ length: 30 }, (_, i) => {
              const item = factoryItems[i * 2];
              return item ? `
                <tr>
                  <td><span class="serial-cell">${item.serial}:</span> ${item.name}</td>
                  <td>${item.totalQuantity}</td>
                </tr>
              ` : `
                <tr>
                  <td>&nbsp;</td>
                  <td></td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
      <div class="items-column">
        <table>
          <thead>
            <tr>
              <th>${t('name')}</th>
              <th>${t('quantity')}</th>
            </tr>
          </thead>
          <tbody>
            ${Array.from({ length: 30 }, (_, i) => {
              const item = factoryItems[i * 2 + 1];
              return item ? `
                <tr>
                  <td><span class="serial-cell">${item.serial}:</span> ${item.name}</td>
                  <td>${item.totalQuantity}</td>
                </tr>
              ` : `
                <tr>
                  <td>&nbsp;</td>
                  <td></td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  </div>
  ` : ''}

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
        printFrame.contentWindow?.focus();
        printFrame.contentWindow?.print();
        setTimeout(() => {
          document.body.removeChild(printFrame);
        }, 1000);
      } catch (e) {
        console.error('Print error:', e);
        document.body.removeChild(printFrame);
        alert('Print failed. Please try again.');
      }
    }, 500);
  } catch (error) {
    console.error('Error printing orders summary:', error);
    alert(t('error'));
  }
}
