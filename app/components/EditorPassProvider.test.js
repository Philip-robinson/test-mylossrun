import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EditorPassProvider, {
  useEditorPass,
} from 'components/EditorPassProvider';
import { contentsPassScreenId } from 'config';

// Reads the context out into the DOM and offers the two registrations, which is what the
// editor and the toolbar do between them.
function Probe() {
  const editorPass = useEditorPass();

  if (!editorPass) {
    return <span data-testid={'probe'}>{'no provider'}</span>;
  }

  return (
    <div>
      <span data-testid={'probe'}>{editorPass.screen || 'no screen'}</span>
      <span data-testid={'probe-actions'}>
        {editorPass.actions ? 'registered' : 'none'}
      </span>
      <button
        data-testid={'report-contents'}
        onClick={() => editorPass.setScreen(contentsPassScreenId())}
      >
        {'contents'}
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
  it('starts with no screen and no switch', () => {
    render(
      <EditorPassProvider>
        <Probe />
      </EditorPassProvider>,
    );

    expect(probe()).toHaveTextContent('no screen');
    expect(actions()).toHaveTextContent('none');
  });

  it('reports the screen it is told', async () => {
    render(
      <EditorPassProvider>
        <Probe />
      </EditorPassProvider>,
    );

    await userEvent.click(screen.getByTestId('report-contents'));

    expect(probe()).toHaveTextContent(contentsPassScreenId());
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
  // beneath it simply has no screen to show.
  it('answers nothing outside a provider', () => {
    render(<Probe />);

    expect(probe()).toHaveTextContent('no provider');
  });
});
