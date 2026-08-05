'use client';

import { Box } from '@mui/material';
import LinkIcon from '@mui/icons-material/Link';
import {
  confirmedTickBadgeColour,
  confirmedTickBadgeSizePx,
  confirmedTickColour,
  mergeLinkRootBadgeColour,
} from 'config';
import { MERGE_ROLE_JOINED } from 'components/pdfTableViewer/tableSupportUtils';

// Presentational: the small square badge marking a table's part in a merge on a page
// thumbnail — a link glyph, white on green for a table joined INTO a merge and green on
// white for the merge's root. Positioned exactly as ConfirmedTickBadge: `left`/`top` are
// CSS lengths (the thumbnails pass percentages of the image's natural size) naming the
// table's top-right corner, and the badge is translated up and back. The translate is
// -200% rather than the tick's -100% so it lands in a FIXED slot one badge width to the
// tick's left, present or not — which is only correct while both badges share
// confirmedTickBadgeSizePx(), hence the reuse rather than a size constant of its own.
export default function MergeLinkBadge({ left, top, role }) {
  const size = confirmedTickBadgeSizePx();
  const joined = role === MERGE_ROLE_JOINED;
  return (
    <Box
      data-testid={'merge-link'}
      data-merge-role={role}
      style={{
        position: 'absolute',
        left,
        top,
        width: `${size}px`,
        height: `${size}px`,
        transform: 'translate(-200%, -100%)',
        backgroundColor: joined
          ? confirmedTickBadgeColour()
          : mergeLinkRootBadgeColour(),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
      }}
    >
      {/* Inset by 2px, as the tick's glyph is, so the two badges read as a pair. */}
      <LinkIcon
        style={{
          fontSize: `${size - 2}px`,
          color: joined ? confirmedTickColour() : confirmedTickBadgeColour(),
        }}
      />
    </Box>
  );
}
