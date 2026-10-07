'use client';

// A review grid cell's text with a <br /> at each line break. Renders no wrapper element.

import { Fragment } from 'react';
import { cellLineBreakPattern } from 'config';
import { cellTextLines } from 'components/pdfTableViewer/reviewUtils';

export default function ReviewCellText({ text }) {
  return cellTextLines(text, cellLineBreakPattern()).map((line, index) => (
    <Fragment key={index}>
      {index > 0 && <br />}
      {line}
    </Fragment>
  ));
}
