import * as XLSX from '@e965/xlsx';

const top = ['Card', 'Unit', '', 'Location', 'Ticket', 'Auth.', 'P.O.', 'Trans', 'Odometer', 'Fuel', 'Fuel', 'Fuel', 'Fuel', 'Oil', 'Oil', 'Cash', 'Misc./', 'Sales', 'Invoice', 'Retail'];
const bottom = ['Number', 'Number', 'Loc.', 'City                  ST', 'Number', 'Number', 'Number', 'Date', 'Reading', 'Type', 'Units', 'Cost', 'Amount', 'Qts', 'Amount', 'Advance', 'Disc.', 'Tax', 'Total', 'Total'];

export function pilotXlsFixture(options: { invoiceNumber?: string; unitNumber?: string; productCode?: string; amount?: number; total?: number; transactionDate?: string; formula?: boolean; adjustment?: number; additionalProductCode?: string; additionalAmount?: number } = {}) {
  const amount = options.amount ?? 101;
  const rows: unknown[][] = [
    ['', '123456789', '', '', '', '', `InvoiceNo: ${options.invoiceNumber ?? '900001'}`, '', '', '', 'Billing Date: 08/25/26 Due Date: 09/01/26'],
    top,
    bottom,
    ['1111222233334444', options.unitNumber ?? '125', '0099', 'Dallas                  TX', 'TICKET-1', 'AUTH-1', 'Driver One', options.transactionDate ?? '08/18', 123456, options.productCode ?? '020', 10, 10, 100, 0, 0, 0, 0, 1, amount, 110],
  ];
  if (options.additionalProductCode) rows.push(['1111222233334444', options.unitNumber ?? '125', '0099', 'Dallas                  TX', 'TICKET-1', 'AUTH-1', 'Driver One', options.transactionDate ?? '08/18', 123456, options.additionalProductCode, 2, 10, options.additionalAmount ?? 20, 0, 0, 0, 0, 0, options.additionalAmount ?? 20, options.additionalAmount ?? 20]);
  if (options.adjustment !== undefined) rows.push(['', '', '', '', 'Freight Ra', '', '', '08/24', '', '', '', '', '', '', '', '', '', '', options.adjustment, '']);
  rows.push(['Total:', '', '', '', '', '', '', '', '', '', 10, '', 100, '', '', '', '', 1, options.total ?? amount + (options.adjustment ?? 0) + (options.additionalProductCode ? options.additionalAmount ?? 20 : 0), 110]);
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  if (options.formula) sheet.M4 = { t: 'n', f: '100+1', v: 101 };
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'StatementEFS_US');
  return new Uint8Array(XLSX.write(workbook, { type: 'buffer', bookType: 'xls' }));
}
