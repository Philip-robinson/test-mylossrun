/**
 * Help overlay DOM adapters
 *
 * The only functions in the help overlay that touch the document: two measure — an
 * annotated element, and the card itself — and one lists what the pointer landed on.
 * Keeping them here leaves `helpTargetUtils.js` a set of plain functions over plain
 * objects.
 *
 * jsdom implements neither elementFromPoint nor elementsFromPoint and returns an
 * all-zero rect from getBoundingClientRect, so these are exercised against a
 * stubbed hit list and against rects stubbed onto the elements themselves.
 */

// The attribute an element carries to say the overlay may describe it. Its values
// are named in config.js; the attribute name itself is written literally here and
// in the JSX of the elements that carry it.
const HELP_ID_ATTRIBUTE = 'data-help-id';

// The attribute the overlay puts on its own scrim, so a hit-test can tell the
// overlay's elements from the application's underneath it.
const HELP_LAYER_ATTRIBUTE = 'data-help-layer';

// The rect of the element carrying `helpId`, or null when no element does. A
// screen may name an element that is not mounted, so absence is an answer rather
// than an error.
export function measureHelpTarget(helpId) {
  if (!helpId) {
    return null;
  }

  const element = document.querySelector(`[${HELP_ID_ATTRIBUTE}="${helpId}"]`);

  return element ? element.getBoundingClientRect() : null;
}

// The size of the help card as the browser laid it out, or null where there is no
// card or it has not been laid out yet. Placement uses the assumed height from
// config until this answers, because the card's height is its content's.
export function measureHelpCard(element) {
  if (!element) {
    return null;
  }

  const rect = element.getBoundingClientRect();

  return rect.height > 0 ? { width: rect.width, height: rect.height } : null;
}

// The `data-help-id` chains of the elements under a viewport point, in hit order,
// each chain listing that element's own id first and its ancestors' after. The
// overlay's own elements are discarded, because the scrim covers the viewport and
// would otherwise be the only hit; a chain holding no id at all is dropped.
//
// The inert annotated elements over the point come first, ahead of the hit list —
// see `inertTargetsAt`.
//
// An empty answer where the document cannot hit-test degrades to "no target"
// rather than throwing, which is also what this project's jsdom does.
export function helpIdChainsAt(x, y) {
  if (typeof document.elementsFromPoint !== 'function') {
    return [];
  }

  const hits = document
    .elementsFromPoint(x, y)
    .filter((element) => !insideHelpLayer(element));

  return [...inertTargetsAt(x, y), ...hits]
    .map(helpIdChain)
    .filter((chain) => chain.length > 0);
}

// The annotated elements the hit test cannot see: an element that takes no pointer
// events is absent from elementsFromPoint, so a label drawn over the page — a
// table's name and size above its corner, say — would be invisible to help even
// though it is the thing under the pointer. Those whose rect holds the point are
// found by hand and put ahead of the hit list, because such an element paints over
// whatever the hit test did find there. The smallest comes first, which is the
// innermost where they nest.
function inertTargetsAt(x, y) {
  const annotated = Array.from(
    document.querySelectorAll(`[${HELP_ID_ATTRIBUTE}]`),
  );

  return annotated
    .filter((element) => !insideHelpLayer(element))
    .filter(takesNoPointerEvents)
    .map((element) => ({ element, rect: element.getBoundingClientRect() }))
    .filter(({ rect }) => holdsPoint(rect, x, y))
    .sort((first, second) => area(first.rect) - area(second.rect))
    .map(({ element }) => element);
}

function takesNoPointerEvents(element) {
  return window.getComputedStyle(element).pointerEvents === 'none';
}

// Whether the point is inside the rect. A collapsed rect holds nothing, so an
// element that is not laid out is never a target.
function holdsPoint(rect, x, y) {
  if (rect.width <= 0 || rect.height <= 0) {
    return false;
  }

  return (
    x >= rect.left &&
    x <= rect.left + rect.width &&
    y >= rect.top &&
    y <= rect.top + rect.height
  );
}

function area(rect) {
  return rect.width * rect.height;
}

function insideHelpLayer(element) {
  return Boolean(element.closest(`[${HELP_LAYER_ATTRIBUTE}]`));
}

function helpIdChain(element) {
  const chain = [];

  for (let node = element; node; node = node.parentElement) {
    const helpId = node.getAttribute(HELP_ID_ATTRIBUTE);

    if (helpId) {
      chain.push(helpId);
    }
  }

  return chain;
}
