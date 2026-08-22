import { NextRequest } from 'next/server';
import { handleEmailSignInRequest } from '@/lib/auth/email-auth-route';

export async function POST(request: NextRequest) {
  return handleEmailSignInRequest(request);
}
