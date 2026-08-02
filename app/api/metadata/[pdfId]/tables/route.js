import { proxyJsonPut } from '../../../_lib/api_support';

export async function PUT(request, { params }) {
  const { pdfId } = await params;
  return proxyJsonPut(
    request,
    `/mylossrun/metadata/${encodeURIComponent(pdfId)}/tables`,
    'Save metadata tables'
  );
}
