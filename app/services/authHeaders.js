import { accessCodeStorageKey } from 'config';

// Build request headers for service calls to the local /api/* routes, attaching
// the access code from localStorage as X-Access-Code when present (omitted when
// absent). The login call (validate.js) deliberately does not use this.
export function authHeaders(extra = {}) {
  const headers = { ...extra };
  const accessCode = localStorage.getItem(accessCodeStorageKey());
  if (accessCode) headers['X-Access-Code'] = accessCode;
  return headers;
}
