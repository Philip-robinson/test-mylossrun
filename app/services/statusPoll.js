import {
  statusPath,
  statusReady,
  statusError,
  envelopeByUrl,
  statusPollToleratedFailures,
} from 'config';
import { authHeaders } from './authHeaders';
import { backendUrl } from './backend';
import { sleep } from './pdfDisplayList';

// Shared long-poll for the asynchronous worker pattern: a dispatcher endpoint
// returns one or more status ids, and each is polled at
// GET /mylossrun/status/{id} until it is terminal. The poll interval and timeout
// are parameters rather than imports, so every caller supplies its own config
// values (find-tables, extract, …) instead of sharing one feature's settings.

// Read one status-poll response into its status object. A BY_URL envelope is
// followed to the presigned object, which stores the INLINE envelope carrying
// the top-level `status` (and, when READY, its `data`). Throws if the presigned
// fetch itself fails, so the caller counts it as a poll error.
export async function readStatusObject(response) {
  let obj = JSON.parse(await response.text());
  if (obj && obj.presentationType === envelopeByUrl()) {
    const inner = await fetch(obj.url, { cache: 'no-store' });
    if (!inner.ok) {
      throw new Error(`Status BY_URL fetch failed: HTTP ${inner.status}`);
    }
    obj = JSON.parse(await inner.text());
  }
  return obj;
}

// Poll one worker run's status endpoint until it is terminal. Resolves with the
// READY `data`; throws on a worker ERROR or on timeout. A transient poll failure
// (non-2xx response, transport/parse error) is tolerated and retried; two
// CONSECUTIVE poll errors abort, so a genuinely broken status endpoint fails fast
// instead of spinning to the timeout.
//
// The budget is consecutive rather than lifetime because a run is long: at a 1s
// interval and a 5-minute timeout a status id is polled up to ~300 times, and two
// unrelated network blips minutes apart should not lose the whole run. Fail-fast is
// unaffected — a broken endpoint fails every poll, so it still aborts on the second.
// The cost is that an endpoint alternating failure and success never trips the
// budget and runs to the timeout instead of aborting early.
export async function pollStatus(id, { intervalMs, timeoutMs }) {
  const deadline = Date.now() + timeoutMs;
  let pollErrors = 0;
  for (;;) {
    let obj;
    try {
      const response = await fetch(backendUrl(`${statusPath()}/${encodeURIComponent(id)}`), {
        headers: authHeaders(),
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error(`Status poll failed: HTTP ${response.status}`);
      }
      obj = await readStatusObject(response);
    } catch (error) {
      pollErrors += 1;
      if (pollErrors > statusPollToleratedFailures() || Date.now() >= deadline) throw error;
      await sleep(intervalMs);
      continue;
    }
    // A poll that read cleanly clears the budget, which is what makes `pollErrors` a count
    // of CONSECUTIVE failures rather than of every failure in the run.
    pollErrors = 0;
    if (obj.status === statusReady()) return obj.data;
    if (obj.status === statusError()) throw new Error(obj.error);
    if (Date.now() >= deadline) throw new Error(`Timed out polling status ${id}`);
    await sleep(intervalMs);
  }
}
