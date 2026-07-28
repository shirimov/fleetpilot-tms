import { NextResponse } from 'next/server';
import { taskAuthorizationService } from '@/lib/tasks/task-authorization';
import { validateTaskFile } from '@/lib/tasks/task-file-policy';
import { taskRouteErrorResponse } from '@/lib/tasks/task-route-response';
import { taskService } from '@/lib/tasks/task-service';
import { validateTaskCardId } from '@/lib/tasks/task-validation';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

function actorFrom(context: Awaited<ReturnType<typeof taskAuthorizationService.requireCard>>) {
  return {
    userId: context.user.id,
    displayName: context.user.displayName,
    companyId: context.companyId,
    role: context.role,
  };
}

export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const cardId = validateTaskCardId((await params).id);
    const context = await taskAuthorizationService.requireCard(cardId);
    return NextResponse.json(
      await taskService.getAttachments(cardId, actorFrom(context)),
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return taskRouteErrorResponse(error);
  }
}

export async function POST(request: Request, { params }: RouteContext) {
  try {
    const cardId = validateTaskCardId((await params).id);
    const context = await taskAuthorizationService.requireCard(cardId);
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'A file is required.' }, { status: 400 });
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const validated = validateTaskFile(file, bytes);
    const attachment = await taskService.createAttachment(
      cardId,
      validated,
      bytes,
      actorFrom(context),
    );
    return NextResponse.json(attachment, {
      status: 201,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return taskRouteErrorResponse(error);
  }
}
