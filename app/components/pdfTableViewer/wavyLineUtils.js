// Pure SVG path builders for wavy table edges. No React, no DOM.

const EPSILON = 1e-9;

// One elliptic half-arc ending at (x, y); sweep 1 bulges above, 0 below.
function halfArc(rx, ry, sweep, x, y) {
  return `A ${rx} ${ry} 0 0 ${sweep} ${x} ${y}`;
}

// Path from x1 to x2 along baseline y as alternating half-arcs, first above.
export function wavySegmentPath(x1, x2, y, heightPx, pitchPx) {
  if (x2 <= x1) return `M ${x1} ${y} L ${x2} ${y}`;
  const half = pitchPx / 2;
  const ry = heightPx / 2;
  const parts = [`M ${x1} ${y}`];
  let k = 0;
  let x = x1;
  while (x2 - x > EPSILON) {
    const sweep = k % 2 === 0 ? 1 : 0;
    const remaining = x2 - x;
    if (remaining + EPSILON >= half) {
      x = x1 + (k + 1) * half;
      if (Math.abs(x2 - x) <= EPSILON) x = x2;
      parts.push(halfArc(pitchPx / 4, ry, sweep, x, y));
    } else {
      x = x2;
      parts.push(halfArc(remaining / 2, ry, sweep, x, y));
    }
    k += 1;
  }
  return parts.join(' ');
}

// One full wave cycle in tile coordinates, baseline at heightPx / 2.
export function waveCyclePath(heightPx, pitchPx) {
  const y = heightPx / 2;
  const rx = pitchPx / 4;
  return [
    `M 0 ${y}`,
    halfArc(rx, y, 1, pitchPx / 2, y),
    halfArc(rx, y, 0, pitchPx, y),
  ].join(' ');
}

// Horizontal edge from x1 to x2 at y, wavy or straight.
function horizontalEdge(x1, x2, y, wavy, heightPx, pitchPx) {
  return wavy
    ? wavySegmentPath(x1, x2, y, heightPx, pitchPx)
    : `M ${x1} ${y} L ${x2} ${y}`;
}

// Table outline as four sub-paths: top, right, bottom, left.
export function tableOutlinePath(
  left,
  top,
  width,
  height,
  wavyTop,
  wavyBottom,
  heightPx,
  pitchPx,
) {
  const right = left + width;
  const bottom = top + height;
  return [
    horizontalEdge(left, right, top, wavyTop, heightPx, pitchPx),
    `M ${right} ${top} L ${right} ${bottom}`,
    horizontalEdge(left, right, bottom, wavyBottom, heightPx, pitchPx),
    `M ${left} ${bottom} L ${left} ${top}`,
  ].join(' ');
}
