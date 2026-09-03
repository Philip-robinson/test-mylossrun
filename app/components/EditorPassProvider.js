'use client';

// Which of the editor's two passes is on screen, and how to switch to the other.
//
// The toolbar's two Validate tabs need both, and the toolbar is not inside the editor: it
// is the page's own header, a sibling of the editor two levels up. So the pass and the
// switch reach it through a context, the way help reaches the toolbar's ? button, rather
// than down a prop chain that would pass through two components that have no use for
// either.
//
// Two sides register, because two sides know different things. PDFEditTableStructure
// knows the pass, and knows it even while a full panel — the grid editor, a table review,
// a cell edit — stands over the editor. PageTableEditor owns the switch itself: ending a
// pass settles what it owes, saves the document and resets what belonged to it, so the
// tabs must call ITS handlers rather than a second copy of them. That component is
// unmounted while a full panel is up, which is why the actions can be absent while the
// pass is still known: a tab with nowhere to go says so instead of lying.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';

export const EditorPassContext = createContext(null);

// The context value. Null outside a provider, which is an answer rather than an error: a
// toolbar rendered with no editor beneath it simply has no pass to show.
export function useEditorPass() {
  return useContext(EditorPassContext);
}

export default function EditorPassProvider({ children }) {
  const [pass, setPass] = useState(null);
  const [actions, setActions] = useState(null);

  // Registered once as the editor mounts and cleared as it goes, so the handlers behind it
  // are free to be rebuilt on every edit without this state — and every consumer of it —
  // being touched. The registrant holds them in a ref for exactly that reason.
  const setPassActions = useCallback((registered) => {
    setActions(registered ?? null);
  }, []);

  const value = useMemo(
    () => ({ pass, setPass, actions, setPassActions }),
    [pass, setPass, actions, setPassActions],
  );

  return (
    <EditorPassContext.Provider value={value}>
      {children}
    </EditorPassContext.Provider>
  );
}
