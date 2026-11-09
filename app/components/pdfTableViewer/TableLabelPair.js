'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import TableNameSizeLabel from 'components/pdfTableViewer/TableNameSizeLabel';
import TableLinkLabel from 'components/pdfTableViewer/TableLinkLabel';
import {
  tableLabelTops,
  tableLabelsOverlap,
} from 'components/pdfTableViewer/tableLabelUtils';

// A table's name label above its top-left corner and Link label above its top-right. When
// the table is too narrow for both side by side, the Link label is lifted above the name
// label.
export default function TableLabelPair({ name, link, left, right, top }) {
  const nameRef = useRef(null);
  const linkRef = useRef(null);
  const [linkHeight, setLinkHeight] = useState(0);
  const [stacked, setStacked] = useState(false);
  const nameText = `${name.table.name} ${(name.table.columnWidths ?? []).length} ${
    (name.table.rowHeights ?? []).length
  }`;
  const linkText = link.text;

  useLayoutEffect(() => {
    const nameBox = nameRef.current;
    const linkBox = linkRef.current;
    if (!nameBox || !linkBox) return;
    const overlap = tableLabelsOverlap(
      left,
      right,
      nameBox.offsetWidth,
      linkBox.offsetWidth
    );
    if (overlap !== stacked) setStacked(overlap);
    if (linkBox.offsetHeight !== linkHeight) setLinkHeight(linkBox.offsetHeight);
  }, [left, right, stacked, linkHeight, nameText, linkText]);

  const { nameTop, linkTop } = tableLabelTops(top, linkHeight, stacked);
  return (
    <>
      <TableNameSizeLabel {...name} left={left} top={nameTop} labelRef={nameRef} />
      <TableLinkLabel {...link} left={right} top={linkTop} labelRef={linkRef} />
    </>
  );
}
