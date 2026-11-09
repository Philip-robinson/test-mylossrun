// Placement of a table's name label (above its top-left) and Link label (above its
// top-right).

// Whether the two labels, each `nameWidth` / `linkWidth` wide, would overlap above a table
// spanning `left` to `right`.
export function tableLabelsOverlap(left, right, nameWidth, linkWidth) {
  return nameWidth + linkWidth > right - left;
}

// The tops of the two labels: side by side both sit at `top`; stacked, the Link label sits
// one label height above the name label, the pair kept on the page.
export function tableLabelTops(top, linkHeight, stacked) {
  if (!stacked) return { nameTop: top, linkTop: top };
  const linkTop = Math.max(0, top - linkHeight);
  return { nameTop: linkTop + linkHeight, linkTop };
}
