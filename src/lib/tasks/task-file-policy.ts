import path from 'node:path';
import { TaskValidationError } from './task-validation';

export const MAX_TASK_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const MAX_TASK_ATTACHMENTS = 20;

const allowedTypes = new Map([
  ['.png', ['image/png']],
  ['.jpg', ['image/jpeg']],
  ['.jpeg', ['image/jpeg']],
  ['.webp', ['image/webp']],
  ['.gif', ['image/gif']],
  ['.pdf', ['application/pdf']],
  ['.doc', ['application/msword']],
  ['.docx', ['application/vnd.openxmlformats-officedocument.wordprocessingml.document']],
  ['.xls', ['application/vnd.ms-excel']],
  ['.xlsx', ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']],
  ['.zip', ['application/zip', 'application/x-zip-compressed']],
  ['.rar', ['application/vnd.rar', 'application/x-rar-compressed']],
  ['.7z', ['application/x-7z-compressed']],
]);

const dangerousExtensions = new Set([
  '.exe', '.com', '.bat', '.cmd', '.sh', '.js', '.mjs', '.html', '.htm',
  '.svg', '.php', '.jar', '.msi', '.ps1', '.scr',
]);

export type ValidatedTaskFile = {
  originalFilename: string;
  displayFilename: string;
  mimeType: string;
  byteSize: number;
};

export function sanitizeTaskFilename(filename: string): string {
  if (
    !filename ||
    filename.includes('/') ||
    filename.includes('\\') ||
    filename.includes('\0') ||
    filename === '.' ||
    filename === '..'
  ) {
    throw new TaskValidationError('Attachment filename is invalid.');
  }
  const normalized = filename.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, '');
  const extensions = normalized.toLowerCase().match(/\.[a-z0-9]+/g) ?? [];
  if (extensions.some((extension) => dangerousExtensions.has(extension))) {
    throw new TaskValidationError('Executable or active-content files are not allowed.');
  }
  const extension = path.extname(normalized).toLowerCase();
  if (!allowedTypes.has(extension)) {
    throw new TaskValidationError('Attachment file type is not allowed.');
  }
  const stem = path.basename(normalized, extension)
    .replace(/[^a-zA-Z0-9 _().-]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return `${stem || 'attachment'}${extension}`;
}

function signatureMatches(extension: string, bytes: Uint8Array): boolean {
  const starts = (...signature: number[]) =>
    signature.every((value, index) => bytes[index] === value);
  if (extension === '.pdf') return starts(0x25, 0x50, 0x44, 0x46);
  if (extension === '.png') return starts(0x89, 0x50, 0x4e, 0x47);
  if (extension === '.jpg' || extension === '.jpeg') return starts(0xff, 0xd8, 0xff);
  if (extension === '.gif') return starts(0x47, 0x49, 0x46, 0x38);
  if (extension === '.webp') {
    return starts(0x52, 0x49, 0x46, 0x46) &&
      String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  }
  if (['.zip', '.docx', '.xlsx'].includes(extension)) {
    return starts(0x50, 0x4b);
  }
  if (extension === '.doc' || extension === '.xls') {
    return starts(0xd0, 0xcf, 0x11, 0xe0);
  }
  if (extension === '.7z') return starts(0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c);
  if (extension === '.rar') return starts(0x52, 0x61, 0x72, 0x21);
  return false;
}

export function validateTaskFile(file: File, bytes: Uint8Array): ValidatedTaskFile {
  if (file.size === 0 || bytes.length === 0) {
    throw new TaskValidationError('Attachment cannot be empty.');
  }
  if (file.size > MAX_TASK_ATTACHMENT_BYTES) {
    throw new TaskValidationError('Attachment exceeds the 20 MB limit.');
  }
  const displayFilename = sanitizeTaskFilename(file.name);
  const extension = path.extname(displayFilename).toLowerCase();
  if (!allowedTypes.get(extension)?.includes(file.type)) {
    throw new TaskValidationError('Attachment MIME type does not match its extension.');
  }
  if (!signatureMatches(extension, bytes)) {
    throw new TaskValidationError('Attachment content does not match its declared file type.');
  }
  return {
    originalFilename: file.name.slice(0, 255),
    displayFilename,
    mimeType: file.type,
    byteSize: file.size,
  };
}
