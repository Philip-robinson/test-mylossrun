import { calculateCellsPath } from 'config';
import { proxyJsonPost } from '../_lib/api_support';

// calculate-cells is intentionally synchronous (single page, text read only): the
// back-end returns the CalculateCellsResponse directly rather than a status id, so this
// is a pure forward-the-POST proxy with no long-poll (contrast find-tables/route.js).
export async function POST(request) {
  return proxyJsonPost(request, calculateCellsPath(), 'Calculate cells');
}
