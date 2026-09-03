'use client';

// The help overlay's one piece of state, and the decision of when to show it unasked.
//
// Which screen the user is on is not routing here — the application is a single route
// whose screens are state — so screens report themselves. Each mounted component that
// stands for a screen registers under a token of its own, and the most recently
// registered live entry is the screen help is about. The registrations are ordered and
// keyed by token for two reasons: CellEditDialog is mounted over a live
// ReviewTablePanel, so two screens are registered at once and the innermost must win
// and then hand back when it goes; and a single slot would let one component's cleanup
// clear another's registration.
//
// Arriving at a screen consults the seen record and does one of three things — open the
// hints, flag that there is something new, or nothing — and a screen is opened unasked
// at most once per session, which the session set guarantees even when the browser
// refuses to remember anything.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { helpScreens } from 'app/lib/helpContent';
import {
  helpEntryAction,
  readSeenValue,
  writeSeenVersion,
} from 'components/help/helpSeenStorage';
import HelpOverlay from 'components/help/HelpOverlay';

export const HelpContext = createContext(null);

// The context value. Null outside a provider, which is an answer rather than an error:
// a component that reports its screen where there is no help simply reports it to
// nothing.
export function useHelp() {
  return useContext(HelpContext);
}

export default function HelpProvider({ children }) {
  const registrationsRef = useRef(new Map());
  const openedThisSessionRef = useRef(new Set());
  const [screenId, setScreenId] = useState(null);
  const [isOpen, setIsOpen] = useState(false);
  const [targetHelpId, setTargetHelpId] = useState(null);
  const [badgeScreenId, setBadgeScreenId] = useState(null);

  const syncActiveScreen = useCallback(() => {
    setScreenId(activeScreenId(registrationsRef.current));
  }, []);

  const registerScreen = useCallback(
    (token, registeredScreenId) => {
      registrationsRef.current.set(token, registeredScreenId);
      syncActiveScreen();
    },
    [syncActiveScreen],
  );

  const unregisterScreen = useCallback(
    (token) => {
      registrationsRef.current.delete(token);
      syncActiveScreen();
    },
    [syncActiveScreen],
  );

  const openHelp = useCallback(() => {
    // The active screen is read from the registrations rather than from state, so this
    // stays the same function across renders and the screens' effects are not disturbed
    // by help opening.
    const openedScreenId = activeScreenId(registrationsRef.current);

    recordSeen(openedThisSessionRef.current, openedScreenId);
    setBadgeScreenId(null);
    setTargetHelpId(null);
    setIsOpen(true);
  }, []);

  const exitHelp = useCallback(() => {
    setIsOpen(false);
    setTargetHelpId(null);
  }, []);

  useEffect(() => {
    const screen = screenId ? helpScreens()[screenId] : null;

    if (!screen) {
      return;
    }

    const action = helpEntryAction(
      readSeenValue(browserStorage(), screenId),
      screen.version,
    );

    if (action === 'flag') {
      setBadgeScreenId(screenId);

      return;
    }

    if (action !== 'open' || openedThisSessionRef.current.has(screenId)) {
      return;
    }

    recordSeen(openedThisSessionRef.current, screenId);
    setTargetHelpId(null);
    setIsOpen(true);
  }, [screenId]);

  const value = useMemo(
    () => ({
      screenId,
      isOpen,
      targetHelpId,
      showNewBadge: badgeScreenId !== null && badgeScreenId === screenId,
      openHelp,
      exitHelp,
      setTargetHelpId,
      registerScreen,
      unregisterScreen,
    }),
    [
      screenId,
      isOpen,
      targetHelpId,
      badgeScreenId,
      openHelp,
      exitHelp,
      registerScreen,
      unregisterScreen,
    ],
  );

  return (
    <HelpContext.Provider value={value}>
      {children}
      {isOpen && <HelpOverlay />}
    </HelpContext.Provider>
  );
}

// The screen of the most recently registered live entry, or null when nothing is
// registered — which is what the access gate looks like, and nothing opens there.
function activeScreenId(registrations) {
  let active = null;

  for (const registeredScreenId of registrations.values()) {
    active = registeredScreenId;
  }

  return active;
}

// Notes that a screen's hints have been shown, in the session and in the browser. The
// session note is what holds when the browser note cannot be written, so a browser that
// remembers nothing still only interrupts once.
function recordSeen(sessionSet, seenScreenId) {
  const screen = seenScreenId ? helpScreens()[seenScreenId] : null;

  if (!screen) {
    return;
  }

  sessionSet.add(seenScreenId);
  writeSeenVersion(browserStorage(), seenScreenId, screen.version);
}

// The browser's localStorage, or null when it cannot be reached at all — server
// rendering, or a browser that throws on the property itself. helpSeenStorage reads a
// null storage as "nothing stored", so help works either way.
function browserStorage() {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}
