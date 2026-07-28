import {
  FilesystemPrivateFileStorage,
  type PrivateFileStorage,
} from '@/lib/storage/private-file-storage';

export type TaskAttachmentStorage = PrivateFileStorage;

export class DevelopmentTaskAttachmentStorage
  extends FilesystemPrivateFileStorage
  implements TaskAttachmentStorage
{
  constructor(root?: string) {
    super('task-attachments', root);
  }
}

export const taskAttachmentStorage = new DevelopmentTaskAttachmentStorage();
