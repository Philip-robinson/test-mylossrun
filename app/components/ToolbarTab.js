'use client';

// One tab in the toolbar: the page you are on, or a page you can go to.
//
// `current` is the page you are on — primary text, underlined, and inert, because there is
// nowhere to go. Every other tab is a muted link. A tab with no handler is a page that
// cannot be reached from where you are: it stays muted and says so, rather than looking
// like a link that does nothing.

export default function ToolbarTab({
  label,
  testId,
  helpId,
  current = false,
  onClick,
}) {
  const inert = current || !onClick;

  return (
    <button
      type={'button'}
      data-testid={testId}
      data-help-id={helpId}
      className={`toolbar-tab ${current ? 'toolbar-tab-current' : 'toolbar-tab-link'}`}
      aria-current={current ? 'page' : undefined}
      aria-disabled={inert ? 'true' : undefined}
      onClick={inert ? undefined : onClick}
    >
      {label}
    </button>
  );
}
