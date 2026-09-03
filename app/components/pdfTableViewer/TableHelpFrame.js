'use client';

import { Box } from '@mui/material';
import { editorPageTableHelpId } from 'config';

// The selected table's bounds as an element of their own, drawn over the page but
// painting nothing. It exists for the help overlay alone: the overlay measures the hole
// it cuts in its scrim from the element carrying a tip's help id, so without this the
// tip about the table could only point at whatever element the table is drawn inside —
// the whole page.
//
// An absolutely-positioned HTML sibling of the overlay SVG rather than a rect within it,
// on the same grounds as the labels: the SVG's preserveAspectRatio="none" would distort
// anything measured out of it.
//
// `left`, `top`, `width` and `height` are the table's screen-px box. It takes no pointer
// events, so the editor's own gestures pass straight through it; the overlay finds it
// regardless, because its hit-test looks for inert annotated elements by their rect.
export default function TableHelpFrame({ table, left, top, width, height }) {
  return (
    <Box
      data-testid={'table-help-frame'}
      data-help-id={editorPageTableHelpId()}
      data-tableid={table.tableId}
      style={{
        position: 'absolute',
        left,
        top,
        width,
        height,
        pointerEvents: 'none',
      }}
    />
  );
}
