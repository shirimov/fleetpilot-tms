import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const headers = {
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json',
};

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json(
      {
        status: 'ok',
        database: 'ok',
        commit: process.env.APP_COMMIT_SHA ?? 'unknown',
      },
      { headers },
    );
  } catch {
    return Response.json(
      {
        status: 'unavailable',
        database: 'unavailable',
        commit: process.env.APP_COMMIT_SHA ?? 'unknown',
      },
      { status: 503, headers },
    );
  }
}
