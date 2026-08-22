import { NextRequest, NextResponse } from 'next/server';
import { emailAuthIsEnabled, emailAuthService } from '@/lib/auth/email-auth';
import { PRIVATE_NO_STORE_HEADERS } from '@/lib/security/cache-headers';

const GENERIC_MESSAGE =
  'If this email is authorized, a sign-in link has been sent.';

function requestIp(request: NextRequest) {
  return (
    request.headers.get('x-real-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  );
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  try {
    const body = (await request.json()) as { email?: unknown };
    if (
      emailAuthIsEnabled() &&
      typeof body.email === 'string' &&
      body.email.length <= 320
    ) {
      await emailAuthService.request(body.email, requestIp(request));
    }
  } catch (error) {
    console.error('Email sign-in request could not be completed.', {
      cause: error instanceof Error ? error.name : 'UnknownError',
    });
  }
  const remainingGenericResponseDelay = 300 - (Date.now() - startedAt);
  if (remainingGenericResponseDelay > 0) {
    await new Promise((resolve) => setTimeout(resolve, remainingGenericResponseDelay));
  }
  return NextResponse.json(
    { message: GENERIC_MESSAGE },
    { status: 202, headers: PRIVATE_NO_STORE_HEADERS },
  );
}
