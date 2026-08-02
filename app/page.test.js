import { render, screen, act } from '@testing-library/react';
import Page from 'app/page';

let toolbarProps;
jest.mock('components/Toolbar', () => {
  const MockToolbar = (props) => {
    toolbarProps = props;
    return <div data-testid={'toolbar'} data-active-view={props.activeView} />;
  };
  return MockToolbar;
});

let loaderProps;
jest.mock('components/pdfLoader/pdfLoader', () => {
  const MockPDFLoader = (props) => {
    loaderProps = props;
    return <div data-testid={'pdf-loader'} />;
  };
  return MockPDFLoader;
});

jest.mock('components/pdfTableViewer/PDFEditTableStructure', () => {
  const MockEditor = ({ pdfId }) => (
    <div data-testid={'pdf-editor'} data-pdf-id={pdfId} />
  );
  return MockEditor;
});

// The selected pdf id lives in the URL (?pdf=<id>): the page reads it from
// useSearchParams and navigates with router.push. Mock next/navigation with a
// spy push and a per-test search-param value.
let pushMock;
let searchParamsMap;
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: (...args) => pushMock(...args) }),
  useSearchParams: () => ({
    get: (key) => (key in searchParamsMap ? searchParamsMap[key] : null),
  }),
}));

beforeEach(() => {
  toolbarProps = undefined;
  loaderProps = undefined;
  pushMock = jest.fn();
  searchParamsMap = {};
});

describe('Page', () => {
  it('renders the loader sub-page with activeView=loader when no pdf is in the URL', () => {
    const { container } = render(<Page />);
    expect(container.querySelector('.landing')).toBeInTheDocument();
    expect(container.querySelector('.content-row')).toBeInTheDocument();
    expect(screen.getByTestId('pdf-loader')).toBeInTheDocument();
    expect(screen.queryByTestId('pdf-editor')).not.toBeInTheDocument();
    expect(toolbarProps.activeView).toBe('loader');
  });

  it('deep-links straight into the editor when the URL contains a pdf id', () => {
    searchParamsMap = { pdf: 'pdf-123' };
    render(<Page />);
    const editor = screen.getByTestId('pdf-editor');
    expect(editor).toBeInTheDocument();
    expect(editor).toHaveAttribute('data-pdf-id', 'pdf-123');
    expect(screen.queryByTestId('pdf-loader')).not.toBeInTheDocument();
    expect(toolbarProps.activeView).toBe('editor');
  });

  it('pushes the pdf id into the URL when a pdf is selected', () => {
    render(<Page />);
    act(() => {
      loaderProps.onSelectPdf('pdf-123');
    });
    expect(pushMock).toHaveBeenCalledWith('/?pdf=pdf-123');
  });

  it('clears the pdf id from the URL when onAllFiles is invoked', () => {
    searchParamsMap = { pdf: 'pdf-123' };
    render(<Page />);
    act(() => {
      toolbarProps.onAllFiles();
    });
    expect(pushMock).toHaveBeenCalledWith('/');
  });
});
