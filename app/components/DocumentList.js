'use client';

import { useCallback } from 'react';
import {
  Box,
  Chip,
  CircularProgress,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import PictureAsPdf from '@mui/icons-material/PictureAsPdf';
import {
  documentListCountsHelpId,
  documentListStatusHelpId,
  documentListTableHelpId,
  nameTruncateLength,
} from 'config';

const INACTIVE_STATUSES = ['ALLOCATED', 'INITIALISED', 'LOADED', 'ERROR'];

const INACTIVE_TEXT_COLOR = '#79847a';

// Status-column display: a foreground-coloured dot + a pale-background chip. The
// three Processing statuses additionally carry a `progress` percentage for the bar.
// Colours are CSS custom properties defined in globals.css.
const STATUS_DISPLAY = {
  COMPLETED: { label: 'Complete', pale: 'var(--completed-pale)', strong: 'var(--completed-strong)' },
  EXTRACTION_IN_PROGRESS: { label: 'In Progress', pale: 'var(--in-progress-pale)', strong: 'var(--in-progress-strong)' },
  READY_FOR_REVIEW: { label: 'Ready', pale: 'var(--ready-pale)', strong: 'var(--ready-strong)' },
  VALIDATING: { label: 'Validating', pale: 'var(--in-progress-pale)', strong: 'var(--in-progress-strong)' },
  ALLOCATED: { label: 'Processing', pale: 'var(--processing-pale)', strong: 'var(--processing-strong)', progress: 10 },
  INITIALISED: { label: 'Processing', pale: 'var(--processing-pale)', strong: 'var(--processing-strong)', progress: 30 },
  LOADED: { label: 'Processing', pale: 'var(--processing-pale)', strong: 'var(--processing-strong)', progress: 60 },
  ERROR: { label: 'Error', pale: 'var(--error-pale)', strong: 'var(--error-strong)' },
};

// Unknown/unmapped status: a neutral chip whose label is the raw status string.
function statusDisplay(status) {
  return (
    STATUS_DISPLAY[status] || {
      label: status,
      pale: 'var(--neutral-label-background)',
      strong: INACTIVE_TEXT_COLOR,
    }
  );
}

// A chip on the pale background whose label is preceded by a small dot (both in
// the strong colour), so the pale background encompasses the dot.
// Processing statuses add a thin 100px × 4px progress bar underneath: a neutral
// track overwritten with a processing-strong fill sized to the status's progress.
function StatusCell({ status }) {
  const { label, pale, strong, progress } = statusDisplay(status);
  return (
    <Box sx={{ display: 'inline-flex', flexDirection: 'column', gap: 0.5 }}>
      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
        <Chip
          size={"small"}
          icon={
            <Box
              data-testid={"status-dot"}
              sx={{
                width: 5,
                height: 5,
                borderRadius: '50%',
                backgroundColor: strong,
                flexShrink: 0,
                position: 'relative',
                top: '-1px',
              }}
            />
          }
          label={label}
          sx={{
            backgroundColor: pale,
            color: strong,
            // Override MUI's default .MuiChip-icon margin so the gap to the
            // label widens by 5px (small-chip default marginRight is -4px).
            '& .MuiChip-icon': { marginRight: '1px' },
          }}
        />
      </Box>
      {progress != null && (
        <Box
          sx={{
            width: 100,
            height: 4,
            borderRadius: 2,
            backgroundColor: 'var(--neutral-label-background)',
            overflow: 'hidden',
          }}
        >
          {/* width via inline style: a plain percentage jsdom keeps, so it is unit-testable */}
          <Box
            data-testid={"status-progress-fill"}
            style={{ width: `${progress}%` }}
            sx={{ height: '100%', backgroundColor: 'var(--processing-strong)' }}
          />
        </Box>
      )}
    </Box>
  );
}

// Statuses grouped under the "Processing" bucket for the header count. Their
// per-status progress percentages live in STATUS_DISPLAY.
const PROCESSING_STATUSES = ['ALLOCATED', 'INITIALISED', 'LOADED'];

// The header status summary: a label + a grey count chip, in display order.
const STATUS_SUMMARY = [
  { key: 'all', label: 'All' },
  { key: 'complete', label: 'Complete' },
  { key: 'inProgress', label: 'In Progress' },
  { key: 'ready', label: 'Ready' },
  { key: 'processing', label: 'Processing' },
];

// Tally the five header counts in a single pass. "All" is the total (ERROR
// included); ERROR has no dedicated header chip.
function summariseCounts(pdfs) {
  const counts = { all: pdfs.length, complete: 0, inProgress: 0, ready: 0, processing: 0 };
  for (const { status } of pdfs) {
    if (status === 'COMPLETED') counts.complete += 1;
    else if (status === 'EXTRACTION_IN_PROGRESS') counts.inProgress += 1;
    else if (status === 'READY_FOR_REVIEW') counts.ready += 1;
    else if (PROCESSING_STATUSES.includes(status)) counts.processing += 1;
  }
  return counts;
}

function truncateName(name) {
  if (typeof name !== 'string') return name;
  const limit = nameTruncateLength();
  return name.length > limit ? name.slice(0, limit) + '…' : name;
}

// Human-readable byte size. Larger units drop to whole numbers; the boundary
// bands (1-9.99 MB, 1-9.99 KB) keep one decimal place. '-' when size is absent.
function formatSize(size) {
  if (size == null) return '-';
  if (size > 10_000_000) return `${(size / 1_000_000).toFixed(0)} MB`;
  if (size > 999_999) return `${(size / 1_000_000).toFixed(1)} MB`;
  if (size > 10_000) return `${(size / 1_000).toFixed(0)} KB`;
  if (size > 999) return `${(size / 1_000).toFixed(1)} KB`;
  return `${size} B`;
}

function formatUploaded(created) {
  if (!created) return '-';
  const date = new Date(created);
  if (Number.isNaN(date.getTime())) return created;
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// Presentational: the pdf list, loading flag, and polling are owned by the parent
// (pdfLoader), which also drives the fast per-row watch after an upload.
export default function DocumentList({ pdfs = [], hasLoaded = false, onSelectPdf }) {
  const handleRowClick = useCallback(
    (pdf) => {
      onSelectPdf(pdf.pdfId);
    },
    [onSelectPdf],
  );

  const counts = summariseCounts(pdfs);

  return (
    <div className={'document-list'}>
      <Paper
        elevation={0}
        sx={{
          backgroundColor: '#ffffff',
          borderRadius: 2,
          p: 3,
          display: 'flex',
          flexDirection: 'column',
          flex: '1 1 auto',
          minHeight: 0,
        }}
      >
        <Box
          data-testid={"status-summary"}
          data-help-id={documentListCountsHelpId()}
          sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1.5, mb: 1 }}
        >
          {STATUS_SUMMARY.map(({ key, label }) => (
            <Box key={key} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Typography
                component={"span"}
                sx={{ fontWeight: 700, fontSize: '0.9625rem', fontFamily: 'inherit' }}
              >
                {label}
              </Typography>
              <Chip
                size={"small"}
                label={counts[key]}
                data-testid={`count-${key}`}
                sx={{ backgroundColor: 'var(--neutral-label-background)' }}
              />
            </Box>
          ))}
        </Box>
        <TableContainer
          data-help-id={documentListTableHelpId()}
          sx={{
            flex: '1 1 auto',
            minHeight: 0,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <Table size={"small"} stickyHeader sx={{ flexShrink: 0 }}>
            <TableHead>
              <TableRow
                sx={{ '& .MuiTableCell-root': { backgroundColor: 'var(--background-green)' } }}
              >
                <TableCell>{"Name"}</TableCell>
                <TableCell>{"Uploaded"}</TableCell>
                <TableCell>{"Size"}</TableCell>
                <TableCell>{"Status"}</TableCell>
                <TableCell>{"Pages"}</TableCell>
              </TableRow>
            </TableHead>
            {hasLoaded && pdfs.length > 0 && (
              <TableBody>
                {pdfs.map((pdf) => {
                const isInactive = INACTIVE_STATUSES.includes(pdf.status);
                return (
                  <TableRow
                    key={pdf.pdfId}
                    hover={!isInactive}
                    onClick={isInactive ? undefined : () => handleRowClick(pdf)}
                    sx={
                      isInactive
                        ? { '& .MuiTableCell-root': { color: INACTIVE_TEXT_COLOR } }
                        : { cursor: 'pointer' }
                    }
                  >
                    <TableCell>
                      <Tooltip title={pdf.name}>
                        <Typography
                          component={"span"}
                          variant={"body2"}
                          sx={{ color: isInactive ? INACTIVE_TEXT_COLOR : 'primary.main' }}
                        >
                          {truncateName(pdf.name)}
                        </Typography>
                      </Tooltip>
                    </TableCell>
                    <TableCell>{formatUploaded(pdf.created)}</TableCell>
                    <TableCell>{formatSize(pdf.size)}</TableCell>
                    <TableCell data-help-id={documentListStatusHelpId()}>
                      {pdf.status === 'ERROR' ? (
                        <Tooltip title={pdf.error}>
                          <Box component={"span"} sx={{ display: 'inline-flex' }}>
                            <StatusCell status={pdf.status} />
                          </Box>
                        </Tooltip>
                      ) : (
                        <StatusCell status={pdf.status} />
                      )}
                    </TableCell>
                    <TableCell>{pdf.pageCount ?? '-'}</TableCell>
                  </TableRow>
                );
                })}
              </TableBody>
            )}
          </Table>

          {!hasLoaded && (
            <Box
              sx={{
                flex: '1 1 auto',
                minHeight: 0,
                backgroundColor: '#f5f5f5',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <CircularProgress />
            </Box>
          )}

          {hasLoaded && pdfs.length === 0 && (
            <Box
              sx={{
                flex: '1 1 auto',
                minHeight: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Box
                sx={{
                  maxWidth: '50%',
                  minWidth: '300px',
                  textAlign: 'center',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 2,
                }}
              >
                <Box
                  sx={{
                    width: 70,
                    height: 70,
                    borderRadius: 2,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: 'var(--background-green)',
                  }}
                >
                  <PictureAsPdf sx={{ fontSize: 40, color: 'var(--secondary-text)' }} />
                </Box>
                <Typography
                  sx={{
                    fontSize: '25px',
                    fontWeight: 'bold',
                    color: 'var(--primary-text)',
                    fontFamily: 'inherit',
                  }}
                >
                  {"No documents yet"}
                </Typography>
                <Typography sx={{ fontSize: '15px', color: 'var(--secondary-text)' }}>
                  {"Upload a loss run PDF using the panel to the left - your processed documents will appear here, ready to review."}
                </Typography>
                <Typography sx={{ fontSize: '15px', color: 'var(--foreground-green)' }}>
                  {"← Start with the upload panel"}
                </Typography>
              </Box>
            </Box>
          )}
        </TableContainer>
      </Paper>
    </div>
  );
}
