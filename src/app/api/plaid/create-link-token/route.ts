import { NextResponse } from 'next/server';
import { plaidClient } from '@/lib/plaid';
import { CountryCode, Products } from 'plaid';

export async function POST() {
  try {
    const response = await plaidClient.linkTokenCreate({
      user: { client_user_id: 'fleetpilot-user' },
      client_name: 'FleetPilot TMS',
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: 'en',
    });
    return NextResponse.json({ link_token: response.data.link_token });
  } catch (error: unknown) {
    console.error('Plaid create link token error:', error);
    const err = error as { response?: { data?: unknown }; message?: string };
    return NextResponse.json(
      { error: 'Failed to create link token', details: err?.response?.data || err?.message },
      { status: 500 }
    );
  }
}
