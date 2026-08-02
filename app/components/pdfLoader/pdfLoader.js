'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import DropBox from 'components/DropBox';
import DocumentList from 'components/DocumentList';
import { getPdfDisplayList, sleep } from 'services/pdfDisplayList';
import { awaitEntryChange } from 'services/awaitEntryChange';
import { pollIntervalMs, entryWatchTotalMs } from 'config';
import { readPdfListCache, writePdfListCache } from './pdfListCache';

const deepEqualJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// The fast per-row watch stops once the row becomes reviewable or errors; the
// normal 30s poll handles any later transitions.
const WATCH_STOP_STATUSES = ['READY_FOR_REVIEW', 'ERROR'];

export default function PDFLoader({ onSelectPdf }) {
  // Seed from the process-lifetime cache so a remount (after visiting the editor
  // and returning) restores the list and resumes polling from the last date
  // rather than showing an empty screen and refetching everything.
  const cached = readPdfListCache();
  const [pdfs, setPdfs] = useState(cached.pdfs);
  const [hasLoaded, setHasLoaded] = useState(cached.hasLoaded);
  const lastModifiedRef = useRef(cached.lastModified);
  // pdfId -> last-known Last-Modified, so a watch can send If-Modified-Since.
  const entryLastModifiedRef = useRef({});
  // pdfIds with an active fast-watch; a full-list poll re-prepends any it omits.
  const watchedIdsRef = useRef(new Set());

  // Apply a full-list poll result, but preserve any actively-watched optimistic
  // row the poll has not yet picked up (so a just-uploaded row never flickers out).
  const applyPollResult = useCallback((nextPdfs) => {
    setPdfs((prev) => {
      const presentIds = new Set(nextPdfs.map((p) => p.pdfId));
      const missingWatched = prev.filter(
        (p) => watchedIdsRef.current.has(p.pdfId) && !presentIds.has(p.pdfId),
      );
      const merged = missingWatched.length ? [...missingWatched, ...nextPdfs] : nextPdfs;
      return deepEqualJson(prev, merged) ? prev : merged;
    });
  }, []);

  // Mirror the list and its loaded flag into the cache so the next mount can be
  // seeded from them.
  useEffect(() => {
    writePdfListCache({ pdfs });
  }, [pdfs]);
  useEffect(() => {
    writePdfListCache({ hasLoaded });
  }, [hasLoaded]);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    (async () => {
      while (!cancelled) {
        try {
          const { pdfs: nextPdfs, lastModified } = await getPdfDisplayList(
            () => lastModifiedRef.current,
            controller.signal,
          );
          if (cancelled) return;
          if (lastModified) {
            lastModifiedRef.current = lastModified;
            writePdfListCache({ lastModified });
          }
          // Recovered — clear any lingering fetch-error toast.
          toast.dismiss('document-list-fetch');
          applyPollResult(nextPdfs);
          setHasLoaded(true);
        } catch (error) {
          if (cancelled || error.name === 'AbortError') return;
          // A stable id means a sustained outage refreshes one toast per poll
          // rather than stacking a new one each interval.
          toast.error(error.message, { id: 'document-list-fetch' });
          await sleep(pollIntervalMs(), controller.signal).catch(() => {});
        }
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [applyPollResult]);

  // Upsert a single row by pdfId — the row may not be the top one (a concurrent
  // 30s poll re-sorts by created), so match by id.
  const upsertRow = useCallback((entry) => {
    setPdfs((prev) => {
      const idx = prev.findIndex((p) => p.pdfId === entry.pdfId);
      if (idx === -1) return [entry, ...prev];
      const next = prev.slice();
      next[idx] = { ...next[idx], ...entry };
      return next;
    });
  }, []);

  const handleUploaded = useCallback(
    (pdfId, fileName) => {
      // Show a greyed, non-clickable ALLOCATED row at once (date/pages shown as '-').
      const optimistic = {
        pdfId,
        name: fileName,
        status: 'ALLOCATED',
        created: null,
        error: null,
        pageCount: null,
        tableCount: null,
      };
      setPdfs((prev) => (prev.some((p) => p.pdfId === pdfId) ? prev : [optimistic, ...prev]));
      setHasLoaded(true);
      watchedIdsRef.current.add(pdfId);

      // Fast-watch this row until it is reviewable/errored or the 2-minute budget
      // is spent; each awaitEntryChange call blocks up to ~1 minute.
      (async () => {
        const deadline = Date.now() + entryWatchTotalMs();
        try {
          while (Date.now() < deadline) {
            const change = await awaitEntryChange(
              () => entryLastModifiedRef.current[pdfId],
              pdfId,
            );
            if (change === null) continue; // no change within the 1-minute call; re-check deadline
            if (change.lastModified) entryLastModifiedRef.current[pdfId] = change.lastModified;
            upsertRow(change.entry);
            if (WATCH_STOP_STATUSES.includes(change.entry.status)) break;
          }
        } catch {
          // A watch failure is non-fatal: the 30s poll keeps the row fresh.
        } finally {
          watchedIdsRef.current.delete(pdfId);
          delete entryLastModifiedRef.current[pdfId];
        }
      })();
    },
    [upsertRow],
  );

  return (
    <>
      <DropBox onUploaded={handleUploaded} />
      <DocumentList pdfs={pdfs} hasLoaded={hasLoaded} onSelectPdf={onSelectPdf} />
    </>
  );
}
