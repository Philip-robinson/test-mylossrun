import { proxyJsonPost } from '../_lib/api_support';

export async function POST(request) {
  return proxyJsonPost(request, '/mylossrun/start-pdf-processing', 'Start PDF processing');
}
