import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import {
  landingPageForRole,
  moduleForPath,
  roleCanAccessModule,
} from '@/lib/auth/module-permissions';
import { PRIVATE_NO_STORE_HEADERS } from '@/lib/security/cache-headers';

async function activeMembershipRole(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      isActive: true,
      activeCompanyId: true,
      memberships: {
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { companyId: true, role: true },
      },
    },
  });
  if (!user?.isActive) return null;
  return (
    user.memberships.find(({ companyId }) => companyId === user.activeCompanyId)
      ?? user.memberships[0]
      ?? null
  )?.role ?? null;
}

export default auth(async function proxy(request) {
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith('/api/');
  const requiredModule = moduleForPath(pathname);
  const userId = request.auth?.user?.id;

  if (!requiredModule && pathname !== '/login') return NextResponse.next();

  if (!userId) {
    if (isApi) {
      return NextResponse.json(
        { error: 'Authentication is required.' },
        { status: 401, headers: PRIVATE_NO_STORE_HEADERS },
      );
    }
    // Existing pages render their signed-out shell while their protected APIs
    // return 401. Authenticated role enforcement below remains server-side.
    return NextResponse.next();
  }

  const role = await activeMembershipRole(userId);
  if (!role) {
    if (isApi) {
      return NextResponse.json(
        { error: 'You do not have access to this resource.' },
        { status: 403, headers: PRIVATE_NO_STORE_HEADERS },
      );
    }
    return NextResponse.rewrite(new URL('/access-denied', request.url), {
      status: 403,
    });
  }

  if (pathname === '/login') {
    return NextResponse.redirect(new URL(landingPageForRole(role), request.url));
  }
  if (pathname === '/' && role === 'MEMBER') {
    return NextResponse.redirect(new URL('/tasks', request.url));
  }
  if (requiredModule && !roleCanAccessModule(role, requiredModule)) {
    if (isApi) {
      return NextResponse.json(
        { error: 'You do not have access to this resource.' },
        { status: 403, headers: PRIVATE_NO_STORE_HEADERS },
      );
    }
    return NextResponse.rewrite(new URL('/access-denied', request.url), {
      status: 403,
    });
  }

  return NextResponse.next();
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|manifest.json).*)'],
};
