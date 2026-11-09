import { validatePath } from 'config';
import { backendUrl, readEnvelopeData } from './backend';

export async function validate(accessCode, email) {
  if (!accessCode) {
    throw new Error('Access code is required');
  }

  const response = await fetch(backendUrl(validatePath()), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({
      access_code: accessCode.trim(),
      email: email ? email.trim() : null,
    }),
  });

  if (!response.ok) {
    throw new Error(`validate-access-code request failed (${response.status})`);
  }

  return await readEnvelopeData(response);
}
