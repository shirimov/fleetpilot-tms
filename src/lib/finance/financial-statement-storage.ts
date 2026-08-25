import { createHash } from 'node:crypto';
import path from 'node:path';
import { FilesystemPrivateFileStorage, type PrivateFileStorage } from '@/lib/storage/private-file-storage';
import { FinancialValidationError } from './financial-control-errors';

export const MAX_FINANCIAL_STATEMENT_BYTES = 20 * 1024 * 1024;
const allowed = new Map<string, readonly string[]>([
  ['.csv', ['text/csv', 'application/csv', 'text/plain']],
  ['.xlsx', ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']],
  ['.xls', ['application/vnd.ms-excel', 'application/msexcel', 'application/x-msexcel', 'application/octet-stream']],
  ['.xls', ['application/vnd.ms-excel', 'application/msexcel', 'application/x-msexcel', 'application/octet-stream']],
  ['.pdf', ['application/pdf']],
]);

export class FinancialStatementStorage extends FilesystemPrivateFileStorage {
  constructor(root?: string) { super('financial-statements', root); }
}

function signatureMatches(extension: string, bytes: Uint8Array) {
  if (extension === '.pdf') return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
  if (extension === '.xlsx') return bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (extension === '.xls') return [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((value, index) => bytes[index] === value);
  if (extension === '.xls') return [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((value, index) => bytes[index] === value);
  if (extension === '.csv') {
    const sample = bytes.slice(0, Math.min(bytes.length, 4096));
    return !sample.includes(0) && new TextDecoder('utf-8', { fatal: true }).decode(sample).includes(',');
  }
  return false;
}

export function validateFinancialStatement(file: File, bytes: Uint8Array) {
  if (!file.name || file.name.includes('/') || file.name.includes('\\')) throw new FinancialValidationError('Statement filename is invalid.');
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_FINANCIAL_STATEMENT_BYTES) throw new FinancialValidationError('Statement must be between 1 byte and 20 MB.');
  const extension = path.extname(file.name.normalize('NFKC')).toLowerCase();
  if (!allowed.get(extension)?.includes(file.type)) throw new FinancialValidationError('Statement type is not allowed.');
  if (!signatureMatches(extension, bytes)) throw new FinancialValidationError('Statement content does not match its file type.');
  const stem = path.basename(file.name, extension).replace(/[^a-zA-Z0-9 _().-]/g, '_').trim().slice(0, 120);
  return {
    originalFilename: file.name.slice(0, 255), displayFilename: `${stem || 'statement'}${extension}`,
    mimeType: file.type, byteSize: bytes.byteLength,
    checksumSha256: createHash('sha256').update(bytes).digest('hex'), extension,
  };
}

export const financialStatementStorage: PrivateFileStorage = new FinancialStatementStorage();
