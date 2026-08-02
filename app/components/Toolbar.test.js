import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Toolbar from './Toolbar';

const mockToast = jest.fn();
jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: (...args) => mockToast(...args),
}));

beforeEach(() => {
  mockToast.mockClear();
});

describe('Toolbar', () => {
  test('renders the Cactus logo pointing at /cactuslogo.png', () => {
    render(<Toolbar activeView={'loader'} />);
    const cactus = screen.getByAltText('Cactus');
    expect(cactus).toBeInTheDocument();
    expect(cactus.getAttribute('src')).toMatch(/\/cactuslogo\.png$/);
  });

  test('renders the MyLossRun logo pointing at /MyLossRun.png', () => {
    render(<Toolbar activeView={'loader'} />);
    const myLossRun = screen.getByAltText('MyLossRun');
    expect(myLossRun).toBeInTheDocument();
    expect(myLossRun.getAttribute('src')).toMatch(/\/MyLossRun\.png$/);
  });

  test('renders the empty toolbar-data slot', () => {
    const { container } = render(<Toolbar activeView={'loader'} />);
    expect(container.querySelector('.toolbar-data')).toBeInTheDocument();
  });

  test('renders no tab buttons in the loader view', () => {
    const { container } = render(<Toolbar activeView={'loader'} />);
    const tabs = container.querySelector('.toolbar-tabs');
    expect(tabs).toBeInTheDocument();
    expect(tabs.querySelectorAll('button')).toHaveLength(0);
  });

  test('defaults to the loader view (no tab buttons) when activeView is omitted', () => {
    const { container } = render(<Toolbar />);
    const tabs = container.querySelector('.toolbar-tabs');
    expect(tabs.querySelectorAll('button')).toHaveLength(0);
  });

  test('renders the three editor tabs with the expected labels', () => {
    render(<Toolbar activeView={'editor'} />);
    expect(
      screen.getByRole('button', { name: '← All Files' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Validate' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument();
  });

  test('clicking "← All Files" calls onAllFiles', async () => {
    const onAllFiles = jest.fn();
    render(<Toolbar activeView={'editor'} onAllFiles={onAllFiles} />);
    await userEvent.click(screen.getByRole('button', { name: '← All Files' }));
    expect(onAllFiles).toHaveBeenCalledTimes(1);
  });

  test('clicking "Export" pops the "Export not yet supported" toast', async () => {
    render(<Toolbar activeView={'editor'} />);
    await userEvent.click(screen.getByRole('button', { name: 'Export' }));
    expect(mockToast).toHaveBeenCalledWith('Export not yet supported');
  });

  test('"Validate" has no click handler (no onAllFiles, no toast)', async () => {
    const onAllFiles = jest.fn();
    render(<Toolbar activeView={'editor'} onAllFiles={onAllFiles} />);
    await userEvent.click(screen.getByRole('button', { name: 'Validate' }));
    expect(onAllFiles).not.toHaveBeenCalled();
    expect(mockToast).not.toHaveBeenCalled();
  });
});
