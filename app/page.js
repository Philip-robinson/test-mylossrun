'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Toolbar from 'components/Toolbar';
import PDFLoader from 'components/pdfLoader/pdfLoader';
import PDFEditTableStructure from 'components/pdfTableViewer/PDFEditTableStructure';

// The selected pdf lives in the URL (?pdf=<id>) so a link can be reused to jump
// straight back into the editor for that pdf. The URL is the single source of
// truth: selecting a pdf pushes it, "All files" clears it, and reload/deep-link
// pick it up from useSearchParams.
function PageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedPdfId = searchParams.get('pdf'); // null when absent

  const selectPdf = (id) => router.push(`/?pdf=${encodeURIComponent(id)}`);
  const backToLoader = () => router.push('/');

  return (
    <div className={'landing'}>
      <Toolbar
        activeView={selectedPdfId === null ? 'loader' : 'editor'}
        onAllFiles={backToLoader}
      />
      <div className={'content-row'}>
        {selectedPdfId === null ? (
          <PDFLoader onSelectPdf={selectPdf} />
        ) : (
          <PDFEditTableStructure pdfId={selectedPdfId} onAllFiles={backToLoader} />
        )}
      </div>
    </div>
  );
}

export default function Page() {
  // useSearchParams requires a Suspense boundary in the App Router, otherwise the
  // production build errors.
  return (
    <Suspense fallback={null}>
      <PageContent />
    </Suspense>
  );
}
