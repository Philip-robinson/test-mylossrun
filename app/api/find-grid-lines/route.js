import { findGridLinesPath } from 'config';
import { proxyJsonPost } from '../_lib/api_support';

// find-grid-lines is intentionally synchronous (single page, no OCR): the back-end
// returns the FindGridLinesResponse directly rather than a status id, so this is a
// pure forward-the-POST proxy with no long-poll (contrast find-tables/route.js).
export async function POST(request) {
  return proxyJsonPost(request, findGridLinesPath(), 'Find grid lines');
}
