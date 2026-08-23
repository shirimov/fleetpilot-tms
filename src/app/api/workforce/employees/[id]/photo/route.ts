import { NextResponse } from 'next/server';
import { authorizationService } from '@/lib/auth/authorization';
import { prisma } from '@/lib/prisma';
import { FilesystemPrivateFileStorage, privateDownloadHeaders } from '@/lib/storage/private-file-storage';
import { workforceProfileService, WorkforceValidationError } from '@/lib/workforce/workforce-profile-service';
import { workforceRouteErrorResponse } from '@/lib/workforce/workforce-route-response';

const storage = new FilesystemPrivateFileStorage('employee-photos');
const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const maxBytes = 5 * 1024 * 1024;

function signatureMatches(bytes: Uint8Array, mimeType: string) {
  if (mimeType === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === 'image/png') return bytes.slice(0, 8).every((byte, index) => byte === [137, 80, 78, 71, 13, 10, 26, 10][index]);
  return mimeType === 'image/webp' && new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP';
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await authorizationService.requireActiveCompany();
    const { id } = await params;
    await workforceProfileService.getProfile(context, id);
    const employee = await prisma.employee.findFirst({ where: { id, companyId: context.companyId }, select: { photoStorageKey: true, photoMimeType: true } });
    if (!employee?.photoStorageKey || !employee.photoMimeType) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    const bytes = await storage.get(employee.photoStorageKey);
    return new NextResponse(new Uint8Array(bytes).buffer as ArrayBuffer, { headers: privateDownloadHeaders('profile-photo', employee.photoMimeType, 'inline') });
  } catch (error) {
    return workforceRouteErrorResponse(error);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await authorizationService.requireActiveCompany();
    const { id } = await params;
    await workforceProfileService.getProfile(context, id);
    const form = await request.formData();
    const file = form.get('photo');
    if (!(file instanceof File) || !allowedTypes.has(file.type) || file.size <= 0 || file.size > maxBytes) throw new WorkforceValidationError('Photo must be a JPEG, PNG, or WebP image up to 5 MB.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!signatureMatches(bytes, file.type)) throw new WorkforceValidationError('Photo content does not match its image type.');
    const storageKey = await storage.put(bytes);
    const previous = await prisma.employee.findFirst({ where: { id, companyId: context.companyId }, select: { photoStorageKey: true } });
    try {
      await prisma.employee.update({ where: { id }, data: { photoStorageKey: storageKey, photoMimeType: file.type } });
    } catch (error) {
      await storage.delete(storageKey);
      throw error;
    }
    if (previous?.photoStorageKey) await storage.delete(previous.photoStorageKey);
    return NextResponse.json({ photoUrl: `/api/workforce/employees/${id}/photo` });
  } catch (error) {
    return workforceRouteErrorResponse(error);
  }
}
