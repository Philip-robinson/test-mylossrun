'use client';

// The Special tool's submenu, shown below the grid tool-bar in the rail while the Special
// button is armed. Its entries are radio buttons among themselves: one armed at a time,
// and clicking the armed one disarms it. The one exception is the action entry, which
// toggles the selected table's flag instead of arming anything.
//
// Controlled and stateless. The armed background is a var(--…) colour, which jsdom drops
// from an inline style, so the armed state is also carried as a data attribute.

import { Fragment } from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import {
  layerSpecialCellsBackgroundColour,
  optionsGroupTitleVariant,
  specialToolColouredAreaHelpId,
  specialToolColouredCellHelpId,
  specialToolColouredColumnsHelpId,
  specialToolColouredRowsHelpId,
  specialToolColouredTableHelpId,
  specialToolHeaderHelpId,
  specialToolHideRowHelpId,
  specialToolJoinedEndRowHelpId,
  specialToolMergedHelpId,
  specialToolSectionHelpId,
  specialToolTitleHelpId,
} from 'config';

// `headingBefore` puts a caption above an entry without making the list two kinds of
// thing. The caption is deliberately NOT a Button: an inert entry in the button list
// would be both clickable and counted as a tool.
const SPECIAL_TOOL_DEFS = [
  { key: 'header', label: 'Header', helpId: specialToolHeaderHelpId },
  { key: 'title', label: 'Title', helpId: specialToolTitleHelpId },
  { key: 'hideRow', label: 'Hide Row', helpId: specialToolHideRowHelpId },
  { key: 'sectionTitle', label: 'Section', helpId: specialToolSectionHelpId },
  { key: 'merged', label: 'Merged', helpId: specialToolMergedHelpId },
  {
    key: 'joinedEndRow',
    label: 'Joined end row',
    helpId: specialToolJoinedEndRowHelpId,
    action: true,
  },
  {
    key: 'colouredRows',
    label: 'Rows',
    headingBefore: 'Colouring',
    helpId: specialToolColouredRowsHelpId,
  },
  {
    key: 'colouredColumns',
    label: 'Columns',
    helpId: specialToolColouredColumnsHelpId,
  },
  { key: 'colouredTable', label: 'Table', helpId: specialToolColouredTableHelpId },
  { key: 'colouredCell', label: 'Cell', helpId: specialToolColouredCellHelpId },
  { key: 'colouredArea', label: 'Area', helpId: specialToolColouredAreaHelpId },
];

// The test id of the caption a `headingBefore` renders, slugged from its text so each
// heading has its own handle.
const headingTestId = (heading) =>
  `special-tool-heading-${heading.toLowerCase()}`;

export default function SpecialToolMenu({
  specialTool = null,
  onSelectSpecialTool,
  splitBottomRow = null,
  onToggleSplitBottomRow,
}) {
  return (
    <Box data-testid={'special-tool-menu'} sx={{ flexShrink: 0, p: 0.5 }}>
      <Stack spacing={0.5}>
        {SPECIAL_TOOL_DEFS.map(({ key, label, headingBefore, helpId, action }) => {
          // An action entry follows the table flag; any other entry the armed tool.
          const active = action ? splitBottomRow === true : specialTool === key;
          return (
            <Fragment key={key}>
              {headingBefore ? (
                <Typography
                  data-testid={headingTestId(headingBefore)}
                  variant={optionsGroupTitleVariant()}
                  color={'text.secondary'}
                  sx={{ lineHeight: 1.2 }}
                >
                  {headingBefore}
                </Typography>
              ) : null}
              <Button
                data-testid={`special-tool-${key}`}
                data-help-id={helpId()}
                data-active={active ? 'true' : 'false'}
                size={'small'}
                variant={'outlined'}
                disabled={action ? splitBottomRow == null : false}
                onClick={() =>
                  action ? onToggleSplitBottomRow() : onSelectSpecialTool(key)
                }
                sx={{
                  justifyContent: 'flex-start',
                  whiteSpace: 'nowrap',
                  backgroundColor: active
                    ? layerSpecialCellsBackgroundColour()
                    : 'transparent',
                }}
              >
                {label}
              </Button>
            </Fragment>
          );
        })}
      </Stack>
    </Box>
  );
}
