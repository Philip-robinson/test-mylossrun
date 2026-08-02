// A process-lifetime cache of the PDF display list. PDFLoader is unmounted when
// the user opens a pdf in the editor and remounted on return, which would
// otherwise reset it to an empty list and a null If-Modified-Since date (forcing
// a full refetch). Seeding a remount from this cache lets the list appear at once
// and lets polling resume from the last-known Last-Modified rather than restart.
let cache = { pdfs: [], lastModified: null, hasLoaded: false };

// Snapshot used to seed a freshly-mounted PDFLoader.
export function readPdfListCache() {
  return cache;
}

// Merge a partial update into the cache; unspecified fields are preserved.
export function writePdfListCache(patch) {
  cache = { ...cache, ...patch };
}

// Clear the cache back to its empty initial state (used by tests so cases do
// not leak the list into one another).
export function resetPdfListCache() {
  cache = { pdfs: [], lastModified: null, hasLoaded: false };
}
