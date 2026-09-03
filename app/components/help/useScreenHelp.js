'use client';

// How a component tells the help overlay which screen the user is on.
//
// The token is minted once per component instance, so two instances standing for the
// same screen hold separate registrations and neither one's unmount takes the other's
// with it. Registration and de-registration are separate effects on purpose: the
// registration's place in the order belongs to the component instance, and a change of
// screen id should update what that instance reports without moving it behind a screen
// that registered later.

import { useContext, useEffect, useId } from 'react';
import { HelpContext } from 'components/help/HelpProvider';

export default function useScreenHelp(screenId) {
  const token = useId();
  const help = useContext(HelpContext);
  const registerScreen = help ? help.registerScreen : null;
  const unregisterScreen = help ? help.unregisterScreen : null;

  useEffect(() => {
    if (!registerScreen || !unregisterScreen) {
      return;
    }

    if (screenId) {
      registerScreen(token, screenId);
    } else {
      unregisterScreen(token);
    }
  }, [token, screenId, registerScreen, unregisterScreen]);

  useEffect(() => {
    if (!unregisterScreen) {
      return undefined;
    }

    return () => unregisterScreen(token);
  }, [token, unregisterScreen]);
}
