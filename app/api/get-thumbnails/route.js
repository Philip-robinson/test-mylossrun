import { proxyJsonPost } from '../_lib/api_support';

export async function POST(request) {
  return proxyJsonPost(request, '/mylossrun/get-thumbnails', 'Get thumbnails');
}
