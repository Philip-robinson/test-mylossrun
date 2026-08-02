import { proxyJsonGet } from '../../_lib/api_support';

export async function GET(request, { params }) {
  const { pdfId } = await params;
  return proxyJsonGet(request, `/mylossrun/metadata/${encodeURIComponent(pdfId)}`, 'Get metadata');
}
