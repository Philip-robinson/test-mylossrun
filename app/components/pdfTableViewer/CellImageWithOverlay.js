// The Review panel's cell image with an SVG overlay in page-fraction coordinates: everything
// outside the cell's squares dimmed, and every grid line of the source table drawn over it.

import {
  cellImageDimColour,
  cellImageGridLineStrokeWidth,
  layerColumnsColour,
  layerRowsColour,
} from 'config';
import {
  dividerPointToXY,
  rectanglePath,
} from 'components/pdfTableViewer/cellImageUtils';
import { dividerPolyline } from 'components/pdfTableViewer/gridLineSegmentUtils';

const AXES = [
  { axisKey: 'columnWidths', testId: 'cell-edit-image-column-line', colour: layerColumnsColour },
  { axisKey: 'rowHeights', testId: 'cell-edit-image-row-line', colour: layerRowsColour },
];

function dividerElements(table, { axisKey, testId, colour }) {
  const count = (table?.[axisKey] ?? []).length;
  const elements = [];
  for (let k = 0; k <= count; k += 1) {
    const points = dividerPolyline(table, axisKey, k).map((p) => dividerPointToXY(axisKey, p));
    const key = `${axisKey}-${k}`;
    const common = {
      'data-testid': testId,
      stroke: colour(),
      strokeWidth: cellImageGridLineStrokeWidth(),
      vectorEffect: 'non-scaling-stroke',
    };
    elements.push(
      points.length === 2 ? (
        <line
          key={key}
          {...common}
          x1={points[0][0]}
          y1={points[0][1]}
          x2={points[1][0]}
          y2={points[1][1]}
        />
      ) : (
        <polyline
          key={key}
          {...common}
          fill={'none'}
          points={points.map((p) => p.join(',')).join(' ')}
        />
      )
    );
  }
  return elements;
}

export default function CellImageWithOverlay({ image, bounds, table, squares }) {
  const dim = [bounds, ...(squares ?? [])].map(rectanglePath).join('');
  return (
    <div
      style={{
        position: 'relative',
        display: 'block',
        width: 'fit-content',
        maxWidth: '100%',
        margin: '0 auto',
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        data-testid={'cell-edit-image'}
        src={`data:image/png;base64,${image}`}
        alt={''}
        style={{ display: 'block', margin: '0 auto', maxWidth: '100%', height: 'auto' }}
      />
      <svg
        data-testid={'cell-edit-image-overlay'}
        viewBox={`${bounds.left} ${bounds.top} ${bounds.width} ${bounds.height}`}
        preserveAspectRatio={'none'}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
        }}
      >
        <path
          data-testid={'cell-edit-image-dim'}
          fillRule={'evenodd'}
          fill={cellImageDimColour()}
          d={dim}
        />
        {AXES.flatMap((axis) => dividerElements(table, axis))}
      </svg>
    </div>
  );
}
