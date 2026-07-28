import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DispatchValidationError } from './dispatch-errors';
import type { DispatchDocumentInput } from './dispatch-types';

export const MAX_DISPATCH_DOCUMENT_BYTES = 20 * 1024 * 1024;

const allowed = new Map([
  ['.pdf', ['application/pdf']],
  ['.png', ['image/png']],
  ['.jpg', ['image/jpeg']],
  ['.jpeg', ['image/jpeg']],
  ['.webp', ['image/webp']],
  ['.doc', ['application/msword']],
  ['.docx', ['application/vnd.openxmlformats-officedocument.wordprocessingml.document']],
  ['.xls', ['application/vnd.ms-excel']],
  ['.xlsx', ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']],
]);

export interface DispatchDocumentStorage {
  put(bytes: Uint8Array): Promise<string>;
  get(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
}

export class DevelopmentDispatchDocumentStorage
  implements DispatchDocumentStorage
{
  private readonly root = path.join(process.cwd(), '.data', 'dispatch-documents');

  async put(bytes: Uint8Array) {
    const key = randomUUID();
    await mkdir(this.root, { recursive: true });
    await writeFile(path.join(this.root, key), bytes, { flag: 'wx' });
    return key;
  }

  async get(key: string) {
    if (!/^[0-9a-f-]{36}$/.test(key)) throw new Error('Invalid storage key.');
    return readFile(path.join(this.root, key));
  }

  async delete(key: string) {
    if (!/^[0-9a-f-]{36}$/.test(key)) return;
    await unlink(path.join(this.root, key)).catch(() => {});
  }
}

function signatureMatches(extension: string, bytes: Uint8Array): boolean {
  const starts = (...signature: number[]) =>
    signature.every((value, index) => bytes[index] === value);
  if (extension === '.pdf') return starts(0x25, 0x50, 0x44, 0x46);
  if (extension === '.png') return starts(0x89, 0x50, 0x4e, 0x47);
  if (extension === '.jpg' || extension === '.jpeg') return starts(0xff, 0xd8, 0xff);
  if (extension === '.webp') return starts(0x52, 0x49, 0x46, 0x46);
  if (extension === '.doc' || extension === '.xls') {
    return starts(0xd0, 0xcf, 0x11, 0xe0);
  }
  return starts(0x50, 0x4b);
}

export function validateDispatchDocument(
  file: File,
  type: DispatchDocumentInput['type'],
  bytes: Uint8Array,
): DispatchDocumentInput {
  if (!file.name || file.name.includes('/') || file.name.includes('\\')) {
    throw new DispatchValidationError('Document filename is invalid.');
  }
  if (!file.size || file.size > MAX_DISPATCH_DOCUMENT_BYTES) {
    throw new DispatchValidationError('Document must be between 1 byte and 20 MB.');
  }
  const extension = path.extname(file.name.normalize('NFKC')).toLowerCase();
  if (!allowed.get(extension)?.includes(file.type)) {
    throw new DispatchValidationError('Document type is not allowed.');
  }
  if (!signatureMatches(extension, bytes)) {
    throw new DispatchValidationError('Document content does not match its type.');
  }
  const stem = path
    .basename(file.name, extension)
    .replace(/[^a-zA-Z0-9 _().-]/g, '_')
    .trim()
    .slice(0, 120);
  return {
    type,
    originalFilename: file.name.slice(0, 255),
    displayFilename: `${stem || 'document'}${extension}`,
    mimeType: file.type,
    byteSize: file.size,
  };
}

export const dispatchDocumentStorage = new DevelopmentDispatchDocumentStorage();

