import { helpCardGapPx, helpViewportMarginPx } from 'config';
import {
  firstKnownHelpId,
  holeRect,
  isMeasurable,
  tipPlacement,
} from 'components/help/helpTargetUtils';

const GAP = helpCardGapPx();
const MARGIN = helpViewportMarginPx();

const VIEWPORT = { width: 1000, height: 800 };
const CARD = { width: 380, height: 200 };

const rect = (top, left, width, height) => ({ top, left, width, height });

describe('firstKnownHelpId', () => {
  it('answers the innermost annotated element of a chain', () => {
    const chains = [['unannotated-child', 'inner', 'outer']];

    expect(firstKnownHelpId(chains, ['outer', 'inner'])).toBe('inner');
  });

  it('answers the topmost hit even when a lower hit is annotated more closely', () => {
    const chains = [['scrim', 'under-the-pointer'], ['behind-it']];

    expect(firstKnownHelpId(chains, ['under-the-pointer', 'behind-it'])).toBe(
      'under-the-pointer',
    );
  });

  it('answers nothing when no chain holds a known id', () => {
    const chains = [['unknown'], ['also-unknown']];

    expect(firstKnownHelpId(chains, ['inner', 'outer'])).toBeNull();
  });

  it('answers nothing when nothing was hit', () => {
    expect(firstKnownHelpId([], ['inner'])).toBeNull();
  });
});

describe('holeRect', () => {
  it('grows the target rect by the padding on all four sides', () => {
    expect(holeRect(rect(100, 200, 50, 20), 6)).toEqual({
      top: 94,
      left: 194,
      width: 62,
      height: 32,
    });
  });

  it('leaves the rect alone when the padding is zero', () => {
    expect(holeRect(rect(100, 200, 50, 20), 0)).toEqual({
      top: 100,
      left: 200,
      width: 50,
      height: 20,
    });
  });
});

describe('isMeasurable', () => {
  it('accepts a rect standing inside the viewport', () => {
    expect(isMeasurable(rect(100, 100, 40, 20), VIEWPORT)).toBe(true);
  });

  it('accepts a rect only partly inside the viewport', () => {
    expect(isMeasurable(rect(100, -20, 40, 20), VIEWPORT)).toBe(true);
  });

  it('rejects a missing rect', () => {
    expect(isMeasurable(null, VIEWPORT)).toBe(false);
  });

  it('rejects a rect of zero width', () => {
    expect(isMeasurable(rect(100, 100, 0, 20), VIEWPORT)).toBe(false);
  });

  it('rejects a rect of zero height', () => {
    expect(isMeasurable(rect(100, 100, 40, 0), VIEWPORT)).toBe(false);
  });

  it('rejects a rect lying off the right of the viewport', () => {
    expect(isMeasurable(rect(100, 1000, 40, 20), VIEWPORT)).toBe(false);
  });

  it('rejects a rect lying off the left of the viewport', () => {
    expect(isMeasurable(rect(100, -40, 40, 20), VIEWPORT)).toBe(false);
  });

  it('rejects a rect lying below the viewport', () => {
    expect(isMeasurable(rect(800, 100, 40, 20), VIEWPORT)).toBe(false);
  });

  it('rejects a rect lying above the viewport', () => {
    expect(isMeasurable(rect(-20, 100, 40, 20), VIEWPORT)).toBe(false);
  });
});

describe('tipPlacement', () => {
  it('places the card below the hole, centred on it', () => {
    const hole = rect(100, 300, 100, 40);

    expect(
      tipPlacement({ hole, card: CARD, viewport: VIEWPORT, side: 'bottom' }),
    ).toEqual({
      top: 100 + 40 + GAP,
      left: 350 - 190,
      side: 'bottom',
    });
  });

  it('places the card below the hole when no side is named', () => {
    const hole = rect(100, 300, 100, 40);

    expect(tipPlacement({ hole, card: CARD, viewport: VIEWPORT })).toEqual({
      top: 100 + 40 + GAP,
      left: 350 - 190,
      side: 'bottom',
    });
  });

  it('flips a bottom placement above the hole at the foot of the viewport', () => {
    const hole = rect(700, 300, 100, 40);

    expect(
      tipPlacement({ hole, card: CARD, viewport: VIEWPORT, side: 'bottom' }),
    ).toEqual({
      top: 700 - GAP - 200,
      left: 350 - 190,
      side: 'top',
    });
  });

  it('flips a top placement below the hole at the head of the viewport', () => {
    const hole = rect(40, 300, 100, 40);

    expect(
      tipPlacement({ hole, card: CARD, viewport: VIEWPORT, side: 'top' }),
    ).toEqual({
      top: 40 + 40 + GAP,
      left: 350 - 190,
      side: 'bottom',
    });
  });

  it('flips a right placement to the left of the hole at the right of the viewport', () => {
    const hole = rect(300, 800, 100, 40);

    expect(
      tipPlacement({ hole, card: CARD, viewport: VIEWPORT, side: 'right' }),
    ).toEqual({
      top: 320 - 100,
      left: 800 - GAP - 380,
      side: 'left',
    });
  });

  it('flips a left placement to the right of the hole at the left of the viewport', () => {
    const hole = rect(300, 40, 100, 40);

    expect(
      tipPlacement({ hole, card: CARD, viewport: VIEWPORT, side: 'left' }),
    ).toEqual({
      top: 320 - 100,
      left: 140 + GAP,
      side: 'right',
    });
  });

  it('clamps the card off the left edge of the viewport', () => {
    const hole = rect(100, 0, 40, 40);

    expect(
      tipPlacement({ hole, card: CARD, viewport: VIEWPORT, side: 'bottom' }),
    ).toEqual({
      top: 100 + 40 + GAP,
      left: MARGIN,
      side: 'bottom',
    });
  });

  it('clamps the card off the right edge of the viewport', () => {
    const hole = rect(100, 980, 20, 40);

    expect(
      tipPlacement({ hole, card: CARD, viewport: VIEWPORT, side: 'bottom' }),
    ).toEqual({
      top: 100 + 40 + GAP,
      left: 1000 - MARGIN - 380,
      side: 'bottom',
    });
  });

  it('clamps the card off the head of the viewport on a side placement', () => {
    const hole = rect(0, 300, 100, 40);

    expect(
      tipPlacement({ hole, card: CARD, viewport: VIEWPORT, side: 'right' }),
    ).toEqual({
      top: MARGIN,
      left: 400 + GAP,
      side: 'right',
    });
  });

  it('clamps the card off the foot of the viewport on a side placement', () => {
    const hole = rect(780, 300, 100, 40);

    expect(
      tipPlacement({ hole, card: CARD, viewport: VIEWPORT, side: 'right' }),
    ).toEqual({
      top: 800 - MARGIN - 200,
      left: 400 + GAP,
      side: 'right',
    });
  });
});

// A tall card beside a tall hole fits above and below neither, and the point of the
// placement is that it then goes to one side rather than over the hole.
describe('tipPlacement where neither the named side nor its opposite is deep enough', () => {
  const covers = (placement, hole, card) =>
    placement.left < hole.left + hole.width &&
    placement.left + card.width > hole.left &&
    placement.top < hole.top + hole.height &&
    placement.top + card.height > hole.top;

  it('takes a side across the hole instead', () => {
    const hole = rect(220, 100, 100, 400);

    const placement = tipPlacement({
      hole,
      card: CARD,
      viewport: VIEWPORT,
      side: 'bottom',
    });

    expect(placement).toEqual({
      top: 420 - 100,
      left: 200 + GAP,
      side: 'right',
    });
    expect(covers(placement, hole, CARD)).toBe(false);
  });

  it('takes the roomier of the two sides across', () => {
    const hole = rect(220, 480, 100, 400);

    expect(
      tipPlacement({ hole, card: CARD, viewport: VIEWPORT, side: 'bottom' }),
    ).toEqual({
      top: 420 - 100,
      left: 480 - GAP - 380,
      side: 'left',
    });
  });

  it('presses the card against the viewport edge when no side is deep enough', () => {
    const hole = rect(220, 300, 400, 400);

    expect(
      tipPlacement({ hole, card: CARD, viewport: VIEWPORT, side: 'bottom' }),
    ).toEqual({
      top: 420 - 100,
      left: 1000 - MARGIN - 380,
      side: 'right',
    });
  });

  it('keeps a card taller than the viewport at the head of it', () => {
    const hole = rect(300, 300, 100, 40);
    const tall = { width: 380, height: 900 };

    expect(
      tipPlacement({ hole, card: tall, viewport: VIEWPORT, side: 'bottom' }),
    ).toEqual({
      top: MARGIN,
      left: 400 + GAP,
      side: 'right',
    });
  });
});
