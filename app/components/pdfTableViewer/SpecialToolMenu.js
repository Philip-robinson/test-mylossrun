'use client';

// The Special tool's submenu, shown below the grid tool-bar in the rail while the Special
// button is armed. Its entries are radio buttons among themselves: one armed at a time,
// and clicking the armed one disarms it.
//
// Controlled and stateless. The armed background is a var(--…) colour, which jsdom drops
// from an inline style, so the armed state is also carried as a data attribute.

import { Fragment } from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import {
  layerSpecialCellsBackgroundColour,
  optionsGroupTitleVariant,
} from 'config';

// `headingBefore` puts a caption above an entry without making the list two kinds of
// thing. The caption is deliberately NOT a Button: an inert entry in the button list
// would be both clickable and counted as a tool.
const SPECIAL_TOOL_DEFS = [
  { key: 'header', label: 'Header' },
  { key: 'title', label: 'Title' },
  { key: 'hideRow', label: 'Hide Row' },
  { key: 'sectionTitle', label: 'Section' },
  { key: 'colouredRows', label: 'Rows', headingBefore: 'Colouring' },
  { key: 'colouredColumns', label: 'Columns' },
  { key: 'colouredTable', label: 'Table' },
  { key: 'colouredCell', label: 'Cell' },
  { key: 'colouredArea', label: 'Area' },
];

// The test id of the caption a `headingBefore` renders, slugged from its text so each
// heading has its own handle.
const headingTestId = (heading) =>
  `special-tool-heading-${heading.toLowerCase()}`;

export default function SpecialToolMenu({ specialTool = null, onSelectSpecialTool }) {
  return (
    <Box data-testid={'special-tool-menu'} sx={{ flexShrink: 0, p: 0.5 }}>
      <Stack spacing={0.5}>
        {SPECIAL_TOOL_DEFS.map(({ key, label, headingBefore }) => (
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
              data-active={specialTool === key ? 'true' : 'false'}
              size={'small'}
              variant={'outlined'}
              onClick={() => onSelectSpecialTool(key)}
              sx={{
                justifyContent: 'flex-start',
                whiteSpace: 'nowrap',
                backgroundColor:
                  specialTool === key
                    ? layerSpecialCellsBackgroundColour()
                    : 'transparent',
              }}
            >
              {label}
            </Button>
          </Fragment>
        ))}
      </Stack>
    </Box>
  );
}
