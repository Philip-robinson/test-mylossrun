'use client';

import { Box } from '@mui/material';
import { LINK_LABEL_JOINED } from 'components/pdfTableViewer/tableSupportUtils';

// Presentational: a table's part in a linked group, lifted just above its top-RIGHT corner
// in the same style as TableNameSizeLabel sits above its top-left. `left` and `top` are CSS
// lengths naming that corner; the label is translated back by its own width so it ends
// inside the table's right edge rather than starting at it.
//
// A joined table's label is inert: no table may be a member of two groups, so a member can
// never become the root of one. So is every label while `interactive` is false, which is how
// the contents pass switches linking off — forming a group is boundary-pass work, done from
// the Pages list, which that pass does not show.
//
// Inert means unclickable, not hidden: the label still states the table's part in a group.
//
// The colour and the state are var(--…) values / internal strings jsdom cannot read back
// from a style, so both are carried as data attributes.
export default function TableLinkLabel({
  table,
  left,
  top,
  colour,
  colourName,
  state,
  text,
  onClick,
  interactive = true,
}) {
  const inert = !interactive || state === LINK_LABEL_JOINED;
  return (
    <Box
      data-testid={'link-label'}
      data-tableid={table.tableId}
      data-colour={colourName}
      data-state={state}
      onClick={inert ? undefined : () => onClick(table)}
      style={{
        position: 'absolute',
        left,
        top,
        transform: 'translateX(-100%)',
        backgroundColor: colour,
        color: 'white',
        fontFamily: 'sans-serif',
        fontSize: 12,
        lineHeight: '12px',
        padding: 2,
        whiteSpace: 'nowrap',
        cursor: inert ? 'default' : 'pointer',
      }}
    >
      {text}
    </Box>
  );
}
