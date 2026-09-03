'use client';

// The vertical tool-bar of the grid editor, present in gridMode only. Its three buttons
// arm the tools that edit a table's rows, its columns and its special areas; only one is
// ever armed, and none being armed is the normal resting state.
//
// A bordered, shadowed group box that hugs its buttons. It does not place itself: the rail
// that holds it decides where it sits.
//
// Controlled and stateless: it reports which button was clicked and the parent decides
// what that does to the armed tool.

import { Box, Stack, Typography } from '@mui/material';
import GridToolButton from 'components/pdfTableViewer/GridToolButton';
import {
  gridToolbarBorderColour,
  gridToolbarBorderWidthPx,
  gridToolbarCornerRadiusPx,
  gridToolbarShadow,
  gridToolColumnsHelpId,
  gridToolIconSizePx,
  gridToolLineThicknessPx,
  gridToolRowsHelpId,
  gridToolSpecialHelpId,
  gridToolSquareStrokePx,
  layerColumnsBackgroundColour,
  layerColumnsColour,
  layerRowsBackgroundColour,
  layerRowsColour,
  layerSpecialCellsBackgroundColour,
  layerSpecialCellsColour,
} from 'config';

// Each icon is drawn rather than lettered, so the button says which axis it edits at a
// glance. Colours go on `style`, not on the presentation attribute: a var(--…) value
// does not resolve as an SVG attribute.
function RowsIcon() {
  const size = gridToolIconSizePx();
  const thickness = gridToolLineThicknessPx();
  return (
    <svg width={size} height={size} data-testid={'grid-tool-rows-icon'}>
      <rect
        x={0}
        y={(size - thickness) / 2}
        width={size}
        height={thickness}
        style={{ fill: layerRowsColour() }}
      />
    </svg>
  );
}

function ColumnsIcon() {
  const size = gridToolIconSizePx();
  const thickness = gridToolLineThicknessPx();
  return (
    <svg width={size} height={size} data-testid={'grid-tool-columns-icon'}>
      <rect
        x={(size - thickness) / 2}
        y={0}
        width={thickness}
        height={size}
        style={{ fill: layerColumnsColour() }}
      />
    </svg>
  );
}

function SpecialIcon() {
  const size = gridToolIconSizePx();
  const stroke = gridToolSquareStrokePx();
  return (
    <svg width={size} height={size} data-testid={'grid-tool-special-icon'}>
      <rect
        x={stroke / 2}
        y={stroke / 2}
        width={size - stroke}
        height={size - stroke}
        fill={'none'}
        strokeWidth={stroke}
        style={{ stroke: layerSpecialCellsColour() }}
      />
    </svg>
  );
}

const TOOL_DEFS = [
  {
    key: 'rows',
    caption: 'Rows',
    testId: 'grid-tool-rows',
    helpId: gridToolRowsHelpId,
    background: layerRowsBackgroundColour,
    Icon: RowsIcon,
  },
  {
    key: 'columns',
    caption: 'Columns',
    testId: 'grid-tool-columns',
    helpId: gridToolColumnsHelpId,
    background: layerColumnsBackgroundColour,
    Icon: ColumnsIcon,
  },
  {
    key: 'special',
    caption: 'Special',
    testId: 'grid-tool-special',
    helpId: gridToolSpecialHelpId,
    background: layerSpecialCellsBackgroundColour,
    Icon: SpecialIcon,
  },
];

export default function GridToolbar({ tool = null, onSelectTool }) {
  return (
    <Box
      data-testid={'grid-toolbar'}
      sx={{
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 1,
        p: 0.5,
        border: `${gridToolbarBorderWidthPx()}px solid ${gridToolbarBorderColour()}`,
        borderRadius: `${gridToolbarCornerRadiusPx()}px`,
        boxShadow: gridToolbarShadow(),
      }}
    >
      {TOOL_DEFS.map(({ key, caption, testId, helpId, background, Icon }) => (
        <Stack key={key} alignItems={'center'} spacing={0.25}>
          <Typography variant={'caption'} sx={{ lineHeight: 1 }}>
            {caption}
          </Typography>
          <GridToolButton
            testId={testId}
            helpId={helpId()}
            ariaLabel={caption}
            active={tool === key}
            activeBackgroundColour={background()}
            onClick={() => onSelectTool(key)}
          >
            <Icon />
          </GridToolButton>
        </Stack>
      ))}
    </Box>
  );
}
