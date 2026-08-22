import { NextRequest, NextResponse } from 'next/server';
import { PRIVATE_NO_STORE_HEADERS } from '@/lib/security/cache-headers';
import { emailAuthIsEnabled, emailAuthService } from './email-auth';

export const GENERIC_MESSAGE =
  'If this email is authorized, a sign-in link has been sent.';

type EmailRequestService = Pick<typeof emailAuthService, 'request'>;

function requestIp(request: NextRequest) {
  return (
    request.headers.get('x-real-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  );
}

export async function handleEmailSignInRequest(
  request: NextRequest,
  service: EmailRequestService = emailAuthService,
  minimumResponseDelayMs = 300,
) {
  const startedAt = Date.now();
  try {
    const body = (await request.json()) as { email?: unknown };
    if (
      emailAuthIsEnabled() &&
      typeof body.email === 'string' &&
      body.email.length <= 320
    ) {
      await service.request(body.email, requestIp(request));
    }
  } catch (error) {
    console.error('Email sign-in request could not be completed.', {
      cause: error instanceof Error ? error.name : 'UnknownError',
    });
  }
  const remainingGenericResponseDelay =
    minimumResponseDelayMs - (Date.now() - startedAt);
  if (remainingGenericResponseDelay > 0) {
    await new Promise((resolve) =>
      setTimeout(resolve, remainingGenericResponseDelay),
    );
  }
  return NextResponse.json(
    { message: GENERIC_MESSAGE },
    { status: 202, headers: PRIVATE_NO_STORE_HEADERS },
  );
}
