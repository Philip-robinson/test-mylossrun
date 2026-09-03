/**
 * Help copy segments
 *
 * A summary or a tip body is a segment array — plain strings, `{ bold: '…' }`
 * objects and `{ list: [...] }` objects in reading order — and this is the one
 * place that turns one into React nodes. The entry card's summary and a tip's body
 * both come through here.
 *
 * A list's items are themselves segments: a string, or a segment array, which is how
 * an item carries bold words or a nested list of its own.
 *
 * The copy is authored as data in `app/lib/helpContent.js` rather than as markup, so
 * nothing in the overlay needs dangerouslySetInnerHTML.
 */

// The segments as React nodes, in reading order. A string becomes text, `{ bold }`
// becomes a <strong> and `{ list }` becomes a <ul>; a segment of any other shape is
// dropped, so a mistyped one shows up as missing words rather than as a crash.
export function helpSegmentNodes(segments) {
  return (segments || [])
    .map((segment, index) => segmentNode(segment, index))
    .filter((node) => node !== null);
}

function segmentNode(segment, index) {
  if (typeof segment === 'string') {
    return segment;
  }

  if (segment && typeof segment.bold === 'string') {
    return <strong key={index}>{segment.bold}</strong>;
  }

  if (segment && Array.isArray(segment.list)) {
    return listNode(segment.list, index);
  }

  return null;
}

// The bullets. Tight margins and a modest indent, because the card is narrow and a
// browser's own list spacing would cost it width it has not got.
//
// A nested list is an item whose segments hold another list, so this needs no notion
// of depth of its own.
function listNode(items, index) {
  return (
    <ul key={index} style={{ margin: '0.25em 0 0 0', paddingLeft: '1.2em' }}>
      {items.map((item, itemIndex) => (
        <li key={itemIndex} style={{ marginTop: '0.15em' }}>
          {helpSegmentNodes(itemSegments(item))}
        </li>
      ))}
    </ul>
  );
}

// One list item as a segment array. A bare string is the common case and is lifted
// into one; anything that is neither a string nor already an array contributes
// nothing, on the same principle as a mistyped segment.
function itemSegments(item) {
  if (typeof item === 'string') {
    return [item];
  }

  return Array.isArray(item) ? item : [];
}
