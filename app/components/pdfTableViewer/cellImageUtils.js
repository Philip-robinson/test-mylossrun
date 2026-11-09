// Pure geometry for the Review panel's cell image: the cell rectangle enlarged by a pixel
// margin on every side, so the image shows the cell's surroundings at the cell's own scale.

import {
  cellImageDefaultPageAspect,
  cellImageMarginFraction,
  cellImageMarginMaxPx,
  cellImageMarginMinPx,
} from 'config';
import { clampToUnitPage } from 'components/pdfTableViewer/tableSupportUtils';

const clampMarginPx = (px) =>
  Math.min(cellImageMarginMaxPx(), Math.max(cellImageMarginMinPx(), px));

const validAspect = (aspect) =>
  typeof aspect === 'number' && Number.isFinite(aspect) && aspect > 0
    ? aspect
    : cellImageDefaultPageAspect();

// The cell bounds grown by a clamped margin per side, trimmed to the page, and the pixel
// width that shows them at the scale `displayWidth` shows the cell.
// A cell or display with no width has no scale to enlarge by, so it is requested as it is.
export function enlargedCellImageBounds(bounds, displayWidth, pageAspect) {
  if (!(bounds.width > 0) || !(displayWidth > 0)) return { bounds, width: displayWidth };
  const sx = displayWidth / bounds.width;
  const sy = sx * validAspect(pageAspect);
  const dx = clampMarginPx(cellImageMarginFraction() * displayWidth) / sx;
  const dy = clampMarginPx(cellImageMarginFraction() * bounds.height * sy) / sy;
  const enlarged = clampToUnitPage({
    left: bounds.left - dx,
    top: bounds.top - dy,
    width: bounds.width + 2 * dx,
    height: bounds.height + 2 * dy,
  });
  return { bounds: enlarged, width: Math.round(enlarged.width * sx) };
}

// The SVG path tracing a rectangle clockwise from its top-left corner.
export const rectanglePath = ({ left, top, width, height }) =>
  `M${left} ${top}H${left + width}V${top + height}H${left}Z`;

// A divider polyline point, [along, position], as page [x, y] for the divider's axis.
export const dividerPointToXY = (axisKey, [along, position]) =>
  axisKey === 'columnWidths' ? [position, along] : [along, position];
