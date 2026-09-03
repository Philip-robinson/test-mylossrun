/**
 * Help overlay hit-test and placement
 *
 * The geometry the overlay needs, held apart from it as plain functions over plain
 * objects: which annotated element a pointer landed on, the hole the scrim leaves
 * around it, whether that hole can be drawn at all, and where the card goes beside
 * it.
 *
 * jsdom returns an all-zero rect from getBoundingClientRect and implements neither
 * elementFromPoint nor elementsFromPoint, so none of this can be exercised through
 * the DOM in this project's tests — hence rects and viewports arrive as arguments.
 */

import { helpCardGapPx, helpViewportMarginPx } from 'config';

// The id of the element the user meant, given the `data-help-id` chains of the
// elements under the pointer in hit order — each chain listing that element's own
// id first and its ancestors' after. Chains are walked in order and each chain
// from its own end outward, so the innermost annotated element of the topmost hit
// wins. An id no screen knows is skipped rather than answered, which is what makes
// a mistyped attribute show up as help that does nothing.
export function firstKnownHelpId(idChains, knownIds) {
  const known = knownIds instanceof Set ? knownIds : new Set(knownIds || []);

  for (const chain of idChains || []) {
    for (const id of chain || []) {
      if (known.has(id)) {
        return id;
      }
    }
  }

  return null;
}

// The described element's rect grown by the padding on all four sides, as plain
// numbers.
export function holeRect(targetRect, paddingPx) {
  return {
    top: targetRect.top - paddingPx,
    left: targetRect.left - paddingPx,
    width: targetRect.width + paddingPx * 2,
    height: targetRect.height + paddingPx * 2,
  };
}

// Whether a rect is worth drawing a hole around: it must exist, have some size, and
// have some part of itself inside the viewport. A collapsed or scrolled-away element
// has a rect, so the overlay asks this before pointing at anything.
export function isMeasurable(rect, viewport) {
  if (!rect) {
    return false;
  }

  if (rect.width <= 0 || rect.height <= 0) {
    return false;
  }

  return (
    rect.left < viewport.width &&
    rect.top < viewport.height &&
    rect.left + rect.width > 0 &&
    rect.top + rect.height > 0
  );
}

// Where a card of size `card` goes beside `hole`, and the side it settled on so the
// caller can point the caret at the hole. The card stands a gap out from that edge of
// the hole and is centred on the hole across the other axis, then every edge is
// clamped a margin clear of the viewport.
//
// The named side is a preference, not an instruction. A side is only taken when the
// band between the hole and the viewport margin is deep enough to stand the card in,
// which is what keeps the card off the very thing it describes: the named side is
// tried first, then its opposite, then the other axis's two sides, roomier one first.
//
// Where no side is deep enough — a card taller than the space above and below a hole,
// and wider than the space either side — it goes in the roomiest band pressed hard
// against the viewport edge, which leaves as little of the hole covered as the
// viewport allows.
export function tipPlacement({ hole, card, viewport, side = 'bottom' }) {
  const gap = helpCardGapPx();
  const bands = { hole, card, viewport, gap };
  const fitting = preferredSides(bands, side).find((candidate) =>
    fitsBeside(bands, candidate),
  );
  const settledSide = fitting || roomiestSide(bands);
  const position = fitting
    ? unclampedPosition({ hole, card, side: settledSide, gap })
    : flushPosition({ hole, card, viewport, side: settledSide });

  return {
    top: clamped(position.top, card.height, viewport.height),
    left: clamped(position.left, card.width, viewport.width),
    side: settledSide,
  };
}

// The sides to try, in order: the named one, its opposite, then the two on the other
// axis with the roomier first.
function preferredSides(bands, side) {
  const across =
    side === 'top' || side === 'bottom' ? ['left', 'right'] : ['top', 'bottom'];

  return [
    side,
    oppositeSide(side),
    ...across.sort((first, second) => room(bands, second) - room(bands, first)),
  ];
}

// The depth of the band between that edge of the hole and the viewport's margin: how
// much of the card's own depth the side can take.
function room({ hole, viewport, gap }, side) {
  const margin = helpViewportMarginPx();

  switch (side) {
    case 'top':
      return hole.top - gap - margin;
    case 'left':
      return hole.left - gap - margin;
    case 'right':
      return viewport.width - margin - (hole.left + hole.width + gap);
    default:
      return viewport.height - margin - (hole.top + hole.height + gap);
  }
}

// Whether the card stands in that band without any part of it reaching back over the
// hole. Only the depth is asked about: across the band the card is centred on the hole
// and clamped, which slides it along the hole's edge but never over it.
function fitsBeside(bands, side) {
  const depth =
    side === 'left' || side === 'right' ? bands.card.width : bands.card.height;

  return room(bands, side) >= depth;
}

// The side with the deepest band, which is where a card that fits nowhere does least
// harm.
function roomiestSide(bands) {
  return ['bottom', 'top', 'right', 'left'].reduce((best, side) =>
    room(bands, side) > room(bands, best) ? side : best,
  );
}

function oppositeSide(side) {
  return { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }[side];
}

// The card's position on one side of the hole before any clamping: a gap from that
// edge, centred on the hole across the other axis.
function unclampedPosition({ hole, card, side, gap }) {
  const centredTop = hole.top + hole.height / 2 - card.height / 2;
  const centredLeft = hole.left + hole.width / 2 - card.width / 2;

  switch (side) {
    case 'top':
      return { top: hole.top - gap - card.height, left: centredLeft };
    case 'left':
      return { top: centredTop, left: hole.left - gap - card.width };
    case 'right':
      return { top: centredTop, left: hole.left + hole.width + gap };
    default:
      return { top: hole.top + hole.height + gap, left: centredLeft };
  }
}

// The card pressed against the viewport edge on that side, centred on the hole across
// the other axis. This is for a card that fits in no band at all: standing it off the
// far edge puts as much of it as possible beyond the hole rather than over it.
function flushPosition({ hole, card, viewport, side }) {
  const margin = helpViewportMarginPx();
  const centred = unclampedPosition({ hole, card, side, gap: 0 });

  switch (side) {
    case 'top':
      return { top: margin, left: centred.left };
    case 'left':
      return { top: centred.top, left: margin };
    case 'right':
      return { top: centred.top, left: viewport.width - margin - card.width };
    default:
      return { top: viewport.height - margin - card.height, left: centred.left };
  }
}

// One axis brought inside the viewport's margins. The margin wins over the far edge
// when the card is too big for the viewport to hold with its margins, which puts the
// overflow at the far edge rather than at the near one.
function clamped(value, size, extent) {
  const margin = helpViewportMarginPx();

  return Math.max(margin, Math.min(value, extent - margin - size));
}
