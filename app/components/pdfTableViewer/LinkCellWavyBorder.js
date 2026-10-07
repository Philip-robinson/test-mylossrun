'use client';

// A wavy line along the bottom border of a grid editor table cell, marking a table whose
// end row is joined to the next. Absolutely positioned, so its cell must be `position: relative`.

import { useId } from 'react';
import { waveCyclePath } from 'components/pdfTableViewer/wavyLineUtils';
import {
  linkCellBorderColour,
  linkCellBorderWidthPx,
  linkCellWaveHeightPx,
  linkCellWavePitchPx,
} from 'config';

export default function LinkCellWavyBorder() {
  // Colons from useId are stripped so the id is a plain url() fragment.
  const patternId = `link-cell-wave-${useId().replace(/:/g, '')}`;
  const waveHeight = linkCellWaveHeightPx();
  const pitch = linkCellWavePitchPx();
  const strokeWidth = linkCellBorderWidthPx();
  const borderWidth = linkCellBorderWidthPx();
  const height = waveHeight + strokeWidth;
  return (
    <svg
      data-testid={'link-cell-wavy-border'}
      aria-hidden={true}
      width={'100%'}
      height={height}
      style={{
        position: 'absolute',
        left: 0,
        // Centred on the hidden bottom border, which sits below the padding box.
        bottom: -(height / 2) - (borderWidth / 2),
        width: '100%',
        height,
        pointerEvents: 'none',
        overflow: 'visible',
      }}
    >
      <defs>
        <pattern
          id={patternId}
          patternUnits={'userSpaceOnUse'}
          width={pitch}
          height={height}
        >
          <path
            d={waveCyclePath(waveHeight, pitch)}
            transform={`translate(0 ${strokeWidth / 2})`}
            fill={'none'}
            stroke={linkCellBorderColour()}
            strokeWidth={strokeWidth}
          />
        </pattern>
      </defs>
      <rect width={'100%'} height={height} fill={`url(#${patternId})`} />
    </svg>
  );
}
