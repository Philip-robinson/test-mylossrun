'use client';

// The help overlay itself: the scrim over the whole viewport, the hole it leaves
// around the one thing being described, and the card that describes it.
//
// What is being described comes from the help context. With no target it is the
// screen as a whole — the entry card, whose title is the screen's name, whose words
// are the screen's summary followed by the shared introduction, and whose hole is
// around the ? that opened it. With a target it is that screen's tip for it.
//
// The scrim covers the viewport and takes every pointer event, so nothing beneath it
// can be clicked while help is up. A click on it is a question rather than an action:
// what was under the pointer is looked up, and if the screen describes it the overlay
// moves there. A click on something the screen says nothing about leaves the highlight
// where it is, and a click on the ? resolves to an id no screen authors a tip for, which
// leaves the entry card showing.
//
// The card can be put away without leaving help, for when it covers the very thing
// the reader wants to see. The scrim and the hole stay, so what is highlighted is
// still marked, and the next click brings the card back: one that resolves to something
// with that thing's words in it, and one that resolves to nothing with the words it
// was already showing — a click on the background is how the reader says they have
// finished looking.
//
// The card is measured once the browser has laid it out, because its height is its
// content's and the words differ from tip to tip. The assumed height in config places
// it for that first paint alone; the measurement then settles it, which is what keeps
// a long tip from being clamped back over the very thing it describes.
//
// The three functions that touch the document are props with the real ones as their
// defaults, because jsdom returns an all-zero rect from getBoundingClientRect and
// implements neither elementFromPoint nor elementsFromPoint: injected seams are the
// only way this component's decisions can be tested at all.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  helpButtonHelpId,
  helpCardAssumedHeightPx,
  helpCardWidthPx,
  helpHolePaddingPx,
  helpLayerZIndex,
} from 'config';
import { helpIntroBody, helpScreens } from 'app/lib/helpContent';
import {
  helpIdChainsAt,
  measureHelpCard,
  measureHelpTarget,
} from 'components/help/helpDom';
import {
  firstKnownHelpId,
  holeRect,
  isMeasurable,
  tipPlacement,
} from 'components/help/helpTargetUtils';
import HelpHole from 'components/help/HelpHole';
import HelpTipCard from 'components/help/HelpTipCard';
import { useHelp } from 'components/help/HelpProvider';

export default function HelpOverlay({
  measureTarget = measureHelpTarget,
  chainsAt = helpIdChainsAt,
  measureCard = measureHelpCard,
}) {
  const help = useHelp();
  const screenId = help ? help.screenId : null;
  const targetHelpId = help ? help.targetHelpId : null;
  const setTargetHelpId = help ? help.setTargetHelpId : null;
  const exitHelp = help ? help.exitHelp : null;

  // The seams are held in refs so re-measuring depends on the target alone. A caller
  // that passes a fresh function on every render — which a test does — would
  // otherwise re-measure on every render, and each measurement causes a render.
  const seams = useRef({ measureTarget, chainsAt, measureCard });
  seams.current = { measureTarget, chainsAt, measureCard };

  const shown = shownHelp(screenId, targetHelpId);
  const shownTargetId = shown ? shown.targetHelpId : null;

  const [geometry, setGeometry] = useState(initialGeometry);
  const [isCardHidden, setCardHidden] = useState(false);
  const cardRef = useRef(null);
  const [cardHeight, setCardHeight] = useState(null);

  // Before paint, so a re-placed card never appears at the assumed height first. What
  // the card says is the screen, the thing being described and whether it is hidden at
  // all, so those are what can change its height. The overlay is mounted only once
  // help is open, never on the server, so a layout effect is safe here.
  useLayoutEffect(() => {
    const measured = seams.current.measureCard(cardRef.current);

    setCardHeight(measured ? measured.height : null);
  }, [screenId, shownTargetId, isCardHidden]);

  useEffect(() => {
    // Nothing but a resize can move a target while the scrim is up: the application
    // beneath receives no pointer events, so it cannot scroll or relayout.
    const measure = () =>
      setGeometry({
        rect: seams.current.measureTarget(shownTargetId),
        viewport: currentViewport(),
      });

    measure();
    window.addEventListener('resize', measure);

    return () => window.removeEventListener('resize', measure);
  }, [shownTargetId]);

  useEffect(() => {
    if (!exitHelp) {
      return undefined;
    }

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        exitHelp();
      }
    };

    window.addEventListener('keydown', onKeyDown);

    return () => window.removeEventListener('keydown', onKeyDown);
  }, [exitHelp]);

  if (!shown) {
    return null;
  }

  const hole = isMeasurable(geometry.rect, geometry.viewport)
    ? holeRect(geometry.rect, shown.padding)
    : null;
  const card = cardSize(cardHeight);
  const placement = hole
    ? tipPlacement({
        hole,
        card,
        viewport: geometry.viewport,
        side: shown.side,
      })
    : centredPlacement(geometry.viewport, card);

  const onScrimClick = (event) => {
    const helpId = firstKnownHelpId(
      seams.current.chainsAt(event.clientX, event.clientY),
      describedIds(screenId),
    );

    // Any click brings the card back, including one on the thing already being described:
    // the reader asked about it, so answer. A click on the background asks for nothing in
    // particular, so it brings back what the card was already saying.
    setCardHidden(false);

    if (!helpId) {
      return;
    }

    if (setTargetHelpId) {
      setTargetHelpId(helpId);
    }
  };

  return (
    <div
      data-testid={'help-scrim'}
      data-help-layer={'true'}
      onClick={onScrimClick}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: helpLayerZIndex(),
        pointerEvents: 'auto',
      }}
    >
      <HelpHole rect={hole} helpId={shown.targetHelpId} />
      {!isCardHidden && (
        <HelpTipCard
          cardRef={cardRef}
          title={shown.title}
          body={shown.body}
          side={placement.side}
          position={placement}
          onExit={exitHelp}
          onHide={() => setCardHidden(true)}
        />
      )}
    </div>
  );
}

// What the overlay is describing, or null where there is no help for the screen at
// all. A target with no tip behind it — the ? itself, or an id whose tip has since
// been withdrawn — falls back to the entry card rather than showing nothing.
function shownHelp(screenId, targetHelpId) {
  const screen = screenId ? helpScreens()[screenId] : null;

  if (!screen) {
    return null;
  }

  const tip = (screen.tips || []).find(
    (candidate) => candidate.helpId === targetHelpId,
  );

  if (!tip) {
    return {
      title: screen.name,
      body: [...(screen.summary || []), ...helpIntroBody()],
      targetHelpId: helpButtonHelpId(),
      side: undefined,
      padding: helpHolePaddingPx(),
    };
  }

  return {
    title: tip.title,
    body: tip.body,
    targetHelpId: tip.helpId,
    side: tip.side,
    padding: typeof tip.padding === 'number' ? tip.padding : helpHolePaddingPx(),
  };
}

// The ids a click on this screen may resolve to: the screen's own tips, plus the ?
// that opened help. The ? has no authored tip anywhere, so resolving to it is what
// takes the user back to the entry card.
function describedIds(screenId) {
  const screen = screenId ? helpScreens()[screenId] : null;
  const tipIds = screen ? (screen.tips || []).map((tip) => tip.helpId) : [];

  return [helpButtonHelpId(), ...tipIds];
}

// The card's size for placement: its measured height once there is one, and the
// assumed height from config until then. The width is fixed by config, so only the
// height is ever in doubt.
function cardSize(measuredHeight) {
  return {
    width: helpCardWidthPx(),
    height: measuredHeight || helpCardAssumedHeightPx(),
  };
}


// The card in the middle of the viewport, pointing at nothing. This is what a screen
// naming an element that is not mounted, or one that has been scrolled out of sight,
// falls back to: the words are still worth showing.
function centredPlacement(viewport, card) {
  return {
    top: Math.max(0, (viewport.height - card.height) / 2),
    left: Math.max(0, (viewport.width - card.width) / 2),
    side: null,
  };
}

function initialGeometry() {
  return { rect: null, viewport: currentViewport() };
}

function currentViewport() {
  if (typeof window === 'undefined') {
    return { width: 0, height: 0 };
  }

  return { width: window.innerWidth, height: window.innerHeight };
}
