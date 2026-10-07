'use client';

// Which editor screen is up, and the toolbar's tab actions.
//
// The toolbar is not inside the editor: it is the page's own header, a sibling of the
// editor two levels up. So both reach it through a context, the way help reaches the
// toolbar's ? button, rather than down a prop chain through components that have no use
// for either.
//
// PDFEditTableStructure reports the screen, one of the editor's four screen ids. The
// actions are registered once as the editor mounts and cleared as it goes.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';

export const EditorPassContext = createContext(null);

// The context value. Null outside a provider, which is an answer rather than an error: a
// toolbar rendered with no editor beneath it simply has no screen to show.
export function useEditorPass() {
  return useContext(EditorPassContext);
}

export default function EditorPassProvider({ children }) {
  const [screen, setScreen] = useState(null);
  const [actions, setActions] = useState(null);

  // Registered once as the editor mounts and cleared as it goes, so the handlers behind it
  // are free to be rebuilt on every edit without this state — and every consumer of it —
  // being touched. The registrant holds them in a ref for exactly that reason.
  const setPassActions = useCallback((registered) => {
    setActions(registered ?? null);
  }, []);

  const value = useMemo(
    () => ({ screen, setScreen, actions, setPassActions }),
    [screen, setScreen, actions, setPassActions],
  );

  return (
    <EditorPassContext.Provider value={value}>
      {children}
    </EditorPassContext.Provider>
  );
}
