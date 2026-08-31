'use client';

import { Box } from '@mui/material';
import {
  linkedEmphasisColour,
  linkedGroupOutlineGapPx,
  linkedGroupOutlineWidthPx,
} from 'config';

// Presentational: the ring marking a table that is a member of a linked group on a page
// thumbnail. Positioned exactly as ConfirmedTickBadge and MergeLinkBadge are — `left`, `top`,
// `width` and `height` are CSS lengths (the thumbnails pass percentages of the image's
// natural size) naming the table's rectangle.
//
// The ring is an `outline` with an `outline-offset` rather than a border: both are given in
// screen pixels and neither takes part in layout, so the ring sits a fixed gap outside the
// table's own border whatever the image is scaled to. An SVG rect could not do this — its
// stroke would be screen pixels but its offset would be viewbox units, which the overlay's
// preserveAspectRatio="none" scales by an amount this component never measures.
//
// The colour is a var(--…) value jsdom drops from an inline style, so membership is also
// carried as a data attribute.
export default function LinkedGroupOutline({ left, top, width, height }) {
  return (
    <Box
      data-testid={'linked-group-outline'}
      data-linked={'true'}
      style={{
        position: 'absolute',
        left,
        top,
        width,
        height,
        outline: `${linkedGroupOutlineWidthPx()}px solid ${linkedEmphasisColour()}`,
        outlineOffset: `${linkedGroupOutlineGapPx()}px`,
        pointerEvents: 'none',
      }}
    />
  );
}
