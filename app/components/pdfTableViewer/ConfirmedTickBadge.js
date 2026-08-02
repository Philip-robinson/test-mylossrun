'use client';

import { Box } from '@mui/material';
import Check from '@mui/icons-material/Check';
import {
  confirmedTickBadgeColour,
  confirmedTickBadgeSizePx,
  confirmedTickColour,
} from 'config';

// Presentational: the small square badge marking a FULLY CONFIRMED table on a page
// thumbnail — a white tick in a green box, sized from config. Absolutely positioned by
// the caller: `left`/`top` are CSS lengths (the thumbnails pass percentages of the
// image's natural size) naming the table's top-right corner, and the badge is translated
// up and back so it sits just ABOVE that corner rather than over the table. It is an HTML
// sibling of the overlay SVG (which uses preserveAspectRatio="none" and would distort a
// fixed-size shape), hence the percentage positioning rather than SVG coordinates.
export default function ConfirmedTickBadge({ left, top }) {
  const size = confirmedTickBadgeSizePx();
  return (
    <Box
      data-testid={'confirmed-tick'}
      style={{
        position: 'absolute',
        left,
        top,
        width: `${size}px`,
        height: `${size}px`,
        transform: 'translate(-100%, -100%)',
        backgroundColor: confirmedTickBadgeColour(),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
      }}
    >
      {/* The glyph is inset by 2px so the green box reads as a box around the tick. */}
      <Check
        style={{ fontSize: `${size - 2}px`, color: confirmedTickColour() }}
      />
    </Box>
  );
}
