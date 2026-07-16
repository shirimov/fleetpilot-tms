import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get('projectId');

    const projects = await prisma.taskProject.findMany({
      where: projectId ? { id: projectId } : {},
      include: {
        boards: {
          orderBy: { order: 'asc' },
          include: {
            cards: {
              orderBy: { order: 'asc' },
              include: {
                labels: true,
                comments: true,
              },
            },
          },
        },
      },
    });

    return NextResponse.json(projects);
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const project = await prisma.taskProject.create({
      data: {
        name: body.name,
        description: body.description,
        color: body.color || '#3b82f6',
        companyId: body.companyId,
        boards: {
          create: [
            { name: 'To Do', order: 0 },
            { name: 'In Progress', order: 1 },
            { name: 'In Review', order: 2 },
            { name: 'Done', order: 3 },
          ],
        },
      },
      include: { boards: true },
    });

    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
