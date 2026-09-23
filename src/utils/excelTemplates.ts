import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';

export async function downloadItemsTemplate() {
  // Fetch all existing items
  const { data: existingItems } = await supabase
    .from('items')
    .select('serial, name, description, category, stock_level_required')
    .order('category')
    .order('order_index', { ascending: true });

  const headerRow = ['Item Code', 'Name', 'Description', 'Category', 'Stock Level Required'];

  const existingRows = (existingItems || []).map(item => [
    item.serial,
    item.name,
    item.description || '',
    item.category,
    item.stock_level_required ? 'TRUE' : 'FALSE',
  ]);

  // Add example rows if no existing items
  const dataRows = existingRows.length > 0
    ? existingRows
    : [
        ['W0001', 'Example Warehouse Item', 'Description of item 1', 'warehouse', 'FALSE'],
        ['F0001', 'Example Factory Item', 'Description of item 2', 'factory', 'FALSE'],
      ];

  const worksheetData = [headerRow, ...dataRows, ['', '', '', '', '']];

  const ws = XLSX.utils.aoa_to_sheet(worksheetData);
  ws['!cols'] = [{ wch: 15 }, { wch: 30 }, { wch: 40 }, { wch: 15 }, { wch: 20 }];

  const headerStyle = {
    font: { bold: true, color: { rgb: 'FFFFFF' } },
    fill: { fgColor: { rgb: '334155' } },
    alignment: { horizontal: 'center', vertical: 'center' },
  };
  ['A1', 'B1', 'C1', 'D1', 'E1'].forEach(cell => {
    if (ws[cell]) ws[cell].s = headerStyle;
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Items Template');
  XLSX.writeFile(wb, 'items_bulk_upload_template.xlsx');
}

export function parseItemsExcel(file: File): Promise<Array<{
  serial: string;
  name: string;
  description: string;
  category: 'warehouse' | 'factory';
  stock_level_required: boolean;
}>> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: 'binary' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

        const rows = jsonData.slice(1);
        const items = rows
          .filter(row => row[0] && row[0].toString().trim() !== '' && row[1] && row[1].toString().trim() !== '')
          .map(row => ({
            serial: row[0]?.toString().trim() || '',
            name: row[1]?.toString().trim() || '',
            description: row[2]?.toString().trim() || '',
            category: (row[3]?.toString().toLowerCase().trim() === 'factory' ? 'factory' : 'warehouse') as 'warehouse' | 'factory',
            stock_level_required: row[4]?.toString().toUpperCase() === 'TRUE',
          }));

        resolve(items);
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsBinaryString(file);
  });
}
