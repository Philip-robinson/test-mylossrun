export async function validate(accessCode, email) {
  const response = await fetch('/api/validate-access-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ access_code: accessCode, email: email || null }),
  });

  if (!response.ok) {
    throw new Error(`validate-access-code request failed (${response.status})`);
  }

  return await response.json();
}
