import { toExcelPath } from 'config';
import { proxyJsonPost } from '../_lib/api_support';

// to-excel is synchronous: the back end builds the workbook, stores it and returns the
// presigned download URL directly rather than a status id, so this is a pure
// forward-the-POST proxy with no long-poll.
export async function POST(request) {
  return proxyJsonPost(request, toExcelPath(), 'To excel');
}
