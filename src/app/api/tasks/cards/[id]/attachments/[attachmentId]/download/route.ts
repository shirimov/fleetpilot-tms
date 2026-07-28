import { taskAuthorizationService } from '@/lib/tasks/task-authorization';
import { taskRouteErrorResponse } from '@/lib/tasks/task-route-response';
import { taskService } from '@/lib/tasks/task-service';
import { validateTaskCardId } from '@/lib/tasks/task-validation';

export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{ id: string; attachmentId: string }>;
};

export async function GET(request: Request, { params }: RouteContext) {
  try {
    const route = await params;
    const cardId = validateTaskCardId(route.id);
    const attachmentId = validateTaskCardId(route.attachmentId);
    const context = await taskAuthorizationService.requireCard(cardId);
    const download = await taskService.getAttachmentDownload(
      cardId,
      attachmentId,
      {
        userId: context.user.id,
        displayName: context.user.displayName,
        companyId: context.companyId,
        role: context.role,
      },
    );
    const asciiFilename = download.filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    const preview =
      new URL(request.url).searchParams.get('preview') === '1' &&
      (download.mimeType.startsWith('image/') ||
        download.mimeType === 'application/pdf');
    return new Response(new Uint8Array(download.bytes).buffer as ArrayBuffer, {
      headers: {
        'Content-Type': download.mimeType,
        'Content-Disposition': `${preview ? 'inline' : 'attachment'}; filename="${asciiFilename}"; filename*=UTF-8''${encodeURIComponent(download.filename)}`,
        'Content-Length': String(download.bytes.byteLength),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    return taskRouteErrorResponse(error);
  }
}
