import { NextResponse } from 'next/server';
import { baseUrl } from 'config';
import { logRequest, errorResponse } from '../_lib/api_support';

export async function POST(request) {
  logRequest(request);
  try {
    const body = await request.json();
    const { access_code, email } = body;

    if (!access_code) {
      return NextResponse.json(
        { success: false, error: 'Access code is required' },
        { status: 400 }
      );
    }

    const response = await fetch(`${baseUrl()}/mylossrun/validate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        access_code: access_code.trim(),
        email: email ? email.trim() : null,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Validation failed: ${response.status} ${errorText}`);
    }

    const data = await response.json();

    return NextResponse.json(data);
  } catch (error) {
    return errorResponse('Access code validation error', error);
  }
}
