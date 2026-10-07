'use client';

// The actions button at the end of a document list row, and the menu it opens.
//
// Clicks are stopped from reaching the row, whose own click opens the document; the menu
// needs this too, because React synthetic events bubble through its portal to the row.

import { useState } from 'react';
import { CircularProgress, IconButton, Menu, MenuItem } from '@mui/material';
import MoreVert from '@mui/icons-material/MoreVert';

import {
  documentListActionsHelpId,
  documentRowMenuSpinnerSizePx,
  downloadOriginalLabel,
  exportableStatuses,
  exportDocumentLabel,
  originalDownloadableStatuses,
} from 'config';
import { canDownloadOriginal, canExportDocument } from 'components/documentRowMenuUtils';

export default function DocumentRowMenu({ pdf, onDownloadOriginal, onExport }) {
  const [anchorEl, setAnchorEl] = useState(null);
  const [busy, setBusy] = useState(false);

  const run = async (handler) => {
    setAnchorEl(null);
    setBusy(true);
    try {
      await handler(pdf);
    } catch {
      // the handler reports its own errors
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <IconButton
        aria-label={'Document actions'}
        data-testid={'document-row-menu-button'}
        data-help-id={documentListActionsHelpId()}
        data-busy={busy ? 'true' : 'false'}
        size={'small'}
        disabled={busy}
        onClick={(event) => {
          event.stopPropagation();
          setAnchorEl(event.currentTarget);
        }}
      >
        {busy ? (
          <CircularProgress size={documentRowMenuSpinnerSizePx()} />
        ) : (
          <MoreVert fontSize={'small'} />
        )}
      </IconButton>
      <Menu
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        onClick={(event) => event.stopPropagation()}
      >
        <MenuItem
          data-testid={'document-row-download-original'}
          disabled={!canDownloadOriginal(pdf, originalDownloadableStatuses())}
          onClick={() => run(onDownloadOriginal)}
        >
          {downloadOriginalLabel()}
        </MenuItem>
        <MenuItem
          data-testid={'document-row-export'}
          disabled={!canExportDocument(pdf, exportableStatuses())}
          onClick={() => run(onExport)}
        >
          {exportDocumentLabel()}
        </MenuItem>
      </Menu>
    </>
  );
}
