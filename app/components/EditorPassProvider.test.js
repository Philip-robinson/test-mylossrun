import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EditorPassProvider, {
  useEditorPass,
} from 'components/EditorPassProvider';

// Reads the context out into the DOM and offers the two registrations, which is what the
// editor and the toolbar do between them.
function Probe() {
  const editorPass = useEditorPass();

  if (!editorPass) {
    return <span data-testid={'probe'}>{'no provider'}</span>;
  }

  return (
    <div>
      <span data-testid={'probe'}>{editorPass.pass || 'no pass'}</span>
      <span data-testid={'probe-actions'}>
        {editorPass.actions ? 'registered' : 'none'}
      </span>
      <button
        data-testid={'report-grid'}
        onClick={() => editorPass.setPass('grid')}
      >
        {'grid'}
      </button>
      <button
        data-testid={'register'}
        onClick={() => editorPass.setPassActions({ validateTables: () => {} })}
      >
        {'register'}
      </button>
      <button
        data-testid={'clear'}
        onClick={() => editorPass.setPassActions(null)}
      >
        {'clear'}
      </button>
    </div>
  );
}

const probe = () => screen.getByTestId('probe');
const actions = () => screen.getByTestId('probe-actions');

describe('EditorPassProvider', () => {
  it('starts with no pass and no switch', () => {
    render(
      <EditorPassProvider>
        <Probe />
      </EditorPassProvider>,
    );

    expect(probe()).toHaveTextContent('no pass');
    expect(actions()).toHaveTextContent('none');
  });

  it('reports the pass it is told', async () => {
    render(
      <EditorPassProvider>
        <Probe />
      </EditorPassProvider>,
    );

    await userEvent.click(screen.getByTestId('report-grid'));

    expect(probe()).toHaveTextContent('grid');
  });

  it('holds the switch until it is taken back', async () => {
    render(
      <EditorPassProvider>
        <Probe />
      </EditorPassProvider>,
    );

    await userEvent.click(screen.getByTestId('register'));
    expect(actions()).toHaveTextContent('registered');

    await userEvent.click(screen.getByTestId('clear'));
    expect(actions()).toHaveTextContent('none');
  });

  // Null outside a provider is an answer rather than an error: a toolbar with no editor
  // beneath it simply has no pass to show.
  it('answers nothing outside a provider', () => {
    render(<Probe />);

    expect(probe()).toHaveTextContent('no provider');
  });
});
