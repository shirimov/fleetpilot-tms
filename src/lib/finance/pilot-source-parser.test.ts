import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import * as XLSX from '@e965/xlsx';
import { mergePilotSources, normalizedSourceAsInvoice, parsePilotSource } from './pilot-source-parser';

const portalBytes = (formula = false) => {
  const rows = [
    ['Pilot Flying J - Customer Portal'],
    ['Card #','Card Description','Trx Date','Brand','Transaction #','Store Number','Store City','State','Country','Product','Driver ID','Odometer','Trailer','Trip','Vehicle','Quantity','Fuel','Merchandise','Invoice Amount'],
    [167052,'','09/25/2026 11:40 PM','PFJ Travel Center',27125,1180,'Tonopah','AZ','United States','Truck Diesel','','','','',3891,139.63,893.46,0,820.40],
    [167052,'','09/25/2026 11:40 PM','PFJ Travel Center',27125,1180,'Tonopah','AZ','United States','Adjustment','','','','',3891,'',0,-0.02,-0.02],
    ['Total','','','','','','','','','','','','','','',139.63,893.46,-0.02,820.38],
  ];
  const sheet = XLSX.utils.aoa_to_sheet(rows); if (formula) sheet.Q3 = { t:'n', v:893.46, f:'800+93.46' };
  const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, sheet, 'US'); XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['State']]), 'Summary by State');
  return new Uint8Array(XLSX.write(workbook, { type:'buffer', bookType:'xlsx' }));
};

const pipeBytes = () => {
  const header = Array(29).fill(' '); header[0]='H'; header[1]='149977'; header[16]='20251006'; header[17]='20250928'; header[18]='20251005'; header[19]='744402895';
  const detail = Array(51).fill(' '); Object.assign(detail, { 0:'D',1:'019',3:'391',4:'Central Point',5:'OR',7:'121201',11:'20251001',17:'81.77',19:'286.83',20:'367.90',21:'020',22:'Truck Diesel',23:'824163768' });
  const bottled = [...detail]; Object.assign(bottled, { 17:'',19:'9.99',20:'9.99',21:'138',22:'Diesel Exhaust Fluid Bottled' });
  const trailer = ['T','3'];
  return new TextEncoder().encode([header,detail,bottled,trailer].map((row) => row.join('|')).join('\r\n'));
};

test('portal XLSX preserves stable identity, adjustments, exact economics and observed-only coverage', () => {
  const source = parsePilotSource(portalBytes(), 'portal.xlsx', { portalAccount:'148525' });
  assert.equal(source.lines.length, 2); assert.equal(new Set(source.lines.map(({ transactionIdentity }) => transactionIdentity)).size, 1);
  assert.deepEqual(source.lines.map(({ product }) => product), ['TRUCK_DIESEL','ADJUSTMENT']);
  assert.equal(source.lines.reduce((sum, line) => sum + line.netMinor, BigInt(0)), BigInt(82038));
  assert.equal(source.periodStart, null); assert.equal(source.periodEnd, null);
  const normalized = normalizedSourceAsInvoice(source); assert.equal(normalized.billingPeriodExplicit, false); assert.equal(normalized.rows.length, 2);
});

test('pipe invoice validates controls and preserves bottled DEF as a non-gallon source line', () => {
  const source = parsePilotSource(pipeBytes(), 'invoice.csv');
  assert.equal(source.invoiceNumber, '744402895'); assert.equal(source.lines.length, 2); assert.equal(source.lines[1].product, 'DEF_BOTTLED'); assert.equal(source.lines[1].quantity, null);
  assert.equal(source.periodStart?.toISOString().slice(0,10), '2025-09-28');
});

test('XLSX formulas and malformed or generalized CSV are rejected fail-closed', () => {
  assert.throws(() => parsePilotSource(portalBytes(true), 'portal.xlsx', { portalAccount:'148525' }), /formulas/);
  assert.throws(() => parsePilotSource(new TextEncoder().encode('a,b,c'), 'invoice.csv'), /control structure/);
  assert.throws(() => parsePilotSource(portalBytes(), 'portal.xlsx'), /provider account/);
});

const realRoot = process.env.PILOT_REAL_SOURCE_DIR;
test('real package reproduces the reviewed authoritative population', { skip: !realRoot }, () => {
  const sources = fs.readdirSync(realRoot!).filter((name) => /\.(?:xls|xlsx|csv)$/i.test(name)).sort().map((name) => parsePilotSource(fs.readFileSync(path.join(realRoot!, name)), name, { portalAccount:'148525' }));
  const merged = mergePilotSources(sources); const lines = [...merged.transactions.values()].flat();
  const total = (field: 'retailMinor'|'savingsMinor'|'netMinor') => lines.reduce((sum, line) => sum + line[field], BigInt(0));
  assert.equal(merged.transactions.size, 7066); assert.equal(lines.length, 10726); assert.equal(merged.conflicts.length, 0);
  assert.deepEqual([total('retailMinor'),total('savingsMinor'),total('netMinor')],[BigInt(418526150),BigInt(53355788),BigInt(365170362)]);
  assert.equal(lines.filter(({ product }) => product === 'ADJUSTMENT').length, 14);
  assert.equal(lines.filter(({ product }) => product === 'DEF_BOTTLED').length, 2);
  assert.equal(lines.filter(({ product }) => product === 'MISC').length, 3);
});
