import { taskAuthorizationService } from '@/lib/tasks/task-authorization';
import { taskRouteErrorResponse } from '@/lib/tasks/task-route-response';
import { taskService } from '@/lib/tasks/task-service';
import { validateTaskCardId } from '@/lib/tasks/task-validation';
import { privateDownloadHeaders } from '@/lib/storage/private-file-storage';

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
    const preview =
      new URL(request.url).searchParams.get('preview') === '1' &&
      (download.mimeType.startsWith('image/') ||
        download.mimeType === 'application/pdf');
    return new Response(new Uint8Array(download.bytes).buffer as ArrayBuffer, {
      headers: {
        ...privateDownloadHeaders(
          download.filename,
          download.mimeType,
          preview ? 'inline' : 'attachment',
        ),
        'Content-Length': String(download.bytes.byteLength),
      },
    });
  } catch (error) {
    return taskRouteErrorResponse(error);
  }
}
