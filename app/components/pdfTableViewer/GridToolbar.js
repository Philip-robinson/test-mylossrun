'use client';

// The vertical tool-bar of the grid editor, present in gridMode only: one bordered,
// shadowed column of Rows with its Split and Join, Columns with its Split and Join, and
// the Special section. Every button in it belongs to one radio group: at most one is
// armed, and none being armed is the normal resting state. It centres itself in the
// height it is given and scrolls when that height is too short.
//
// Controlled and stateless: it reports which button was clicked and the parent decides
// what that does to the armed tool.

import { Box, Stack, Typography } from '@mui/material';
import GridToolButton from 'components/pdfTableViewer/GridToolButton';
import SpecialToolMenu from 'components/pdfTableViewer/SpecialToolMenu';
import TextToolButton from 'components/pdfTableViewer/TextToolButton';
import {
  gridToolbarBorderColour,
  gridToolbarBorderWidthPx,
  gridToolbarCornerRadiusPx,
  gridToolbarGapSpacing,
  gridToolbarPaddingSpacing,
  gridToolbarShadow,
  gridToolCaptionLineHeight,
  gridToolCaptionSpacing,
  gridToolColumnJoinHelpId,
  gridToolColumnSplitHelpId,
  gridToolColumnsHelpId,
  gridToolIconSizePx,
  gridToolJoinLabel,
  gridToolLineThicknessPx,
  gridToolRailHelpId,
  gridToolRowJoinHelpId,
  gridToolRowSplitHelpId,
  gridToolRowsHelpId,
  gridToolSpecialSectionLabel,
  gridToolSpecialSectionLineHeight,
  gridToolSplitLabel,
  layerColumnsBackgroundColour,
  layerColumnsColour,
  layerRowsBackgroundColour,
  layerRowsColour,
  optionsGroupTitleVariant,
} from 'config';

// Each icon sits to the right of its caption, and is drawn rather than lettered, so the button says which axis it edits at a
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

// The line tools in column order. An entry with an `Icon` is a captioned icon button;
// any other is a text button labelled by `label`.
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
    key: 'rowSplit',
    label: gridToolSplitLabel,
    testId: 'grid-tool-row-split',
    helpId: gridToolRowSplitHelpId,
    background: layerRowsBackgroundColour,
  },
  {
    key: 'rowJoin',
    label: gridToolJoinLabel,
    testId: 'grid-tool-row-join',
    helpId: gridToolRowJoinHelpId,
    background: layerRowsBackgroundColour,
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
    key: 'columnSplit',
    label: gridToolSplitLabel,
    testId: 'grid-tool-column-split',
    helpId: gridToolColumnSplitHelpId,
    background: layerColumnsBackgroundColour,
  },
  {
    key: 'columnJoin',
    label: gridToolJoinLabel,
    testId: 'grid-tool-column-join',
    helpId: gridToolColumnJoinHelpId,
    background: layerColumnsBackgroundColour,
  },
];

export default function GridToolbar({
  tool = null,
  onSelectTool,
  specialTool = null,
  onSelectSpecialTool,
  splitBottomRow = null,
  onToggleSplitBottomRow,
}) {
  return (
    <Box
      data-testid={'grid-toolbar'}
      data-help-id={gridToolRailHelpId()}
      sx={{
        flexShrink: 0,
        alignSelf: 'center',
        maxHeight: '100%',
        minHeight: 0,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        gap: gridToolbarGapSpacing(),
        p: gridToolbarPaddingSpacing(),
        border: `${gridToolbarBorderWidthPx()}px solid ${gridToolbarBorderColour()}`,
        borderRadius: `${gridToolbarCornerRadiusPx()}px`,
        boxShadow: gridToolbarShadow(),
      }}
    >
      {TOOL_DEFS.map(({ key, caption, label, testId, helpId, background, Icon }) =>
        Icon ? (
          <Stack
            key={key}
            direction={'row'}
            alignItems={'center'}
            justifyContent={'center'}
            spacing={gridToolCaptionSpacing()}
          >
            <Typography variant={'caption'} sx={{ lineHeight: gridToolCaptionLineHeight() }}>
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
        ) : (
          <TextToolButton
            key={key}
            testId={testId}
            helpId={helpId()}
            label={label()}
            active={tool === key}
            activeBackgroundColour={background()}
            onClick={() => onSelectTool(key)}
          />
        )
      )}
      <Typography
        data-testid={'grid-toolbar-special-title'}
        variant={optionsGroupTitleVariant()}
        sx={{ lineHeight: gridToolSpecialSectionLineHeight(), textAlign: 'center' }}
      >
        {gridToolSpecialSectionLabel()}
      </Typography>
      <SpecialToolMenu
        specialTool={specialTool}
        onSelectSpecialTool={onSelectSpecialTool}
        splitBottomRow={splitBottomRow}
        onToggleSplitBottomRow={onToggleSplitBottomRow}
      />
    </Box>
  );
}
