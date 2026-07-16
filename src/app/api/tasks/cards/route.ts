import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const card = await prisma.taskCard.create({
      data: {
        projectId: body.projectId,
        boardId: body.boardId,
        title: body.title,
        description: body.description,
        priority: body.priority || 'MEDIUM',
        order: body.order || 0,
      },
      include: {
        labels: true,
        comments: true,
      },
    });

    return NextResponse.json(card, { status: 201 });
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();

    const card = await prisma.taskCard.update({
      where: { id: body.id },
      data: {
        boardId: body.boardId,
        title: body.title,
        description: body.description,
        priority: body.priority,
        status: body.status,
        assignedTo: body.assignedTo,
        dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
        order: body.order,
      },
      include: {
        labels: true,
        comments: true,
      },
    });

    return NextResponse.json(card);
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const cardId = searchParams.get('id');

    await prisma.taskCard.delete({ where: { id: cardId || '' } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
