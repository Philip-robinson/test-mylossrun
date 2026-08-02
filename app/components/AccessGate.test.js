import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AccessGate from './AccessGate';
import { validate } from 'services/validate';
import toast from 'react-hot-toast';

jest.mock('services/validate', () => ({
  validate: jest.fn(),
}));

// Validation errors are surfaced via a react-hot-toast toast (the <Toaster/> lives in
// the app layout, not this component), so assert on the mocked toast.error call.
jest.mock('react-hot-toast', () => {
  const toast = jest.fn();
  toast.error = jest.fn();
  toast.dismiss = jest.fn();
  return { __esModule: true, default: toast };
});

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
});

describe('AccessGate', () => {
  test('(a) stored valid code shows children', async () => {
    localStorage.setItem('access_code', 'CODE');
    validate.mockResolvedValue({ success: true, valid: true });

    render(
      <AccessGate>
        <div>{'child'}</div>
      </AccessGate>,
    );

    expect(await screen.findByText('child')).toBeInTheDocument();
    expect(validate).toHaveBeenCalledWith('CODE');
  });

  test('(b) absent code shows the login form and not children', async () => {
    render(
      <AccessGate>
        <div>{'child'}</div>
      </AccessGate>,
    );

    expect(await screen.findByText('Access Required')).toBeInTheDocument();
    expect(screen.queryByText('child')).not.toBeInTheDocument();
    expect(validate).not.toHaveBeenCalled();
  });

  test('(b2) stored invalid code shows the login form and not children', async () => {
    localStorage.setItem('access_code', 'BAD');
    validate.mockResolvedValue({ success: true, valid: false });

    render(
      <AccessGate>
        <div>{'child'}</div>
      </AccessGate>,
    );

    expect(await screen.findByText('Access Required')).toBeInTheDocument();
    expect(screen.queryByText('child')).not.toBeInTheDocument();
    expect(localStorage.getItem('access_code')).toBeNull();
  });

  test('(c) submitting calls validate and on success renders children', async () => {
    validate.mockResolvedValue({ success: true, valid: true });

    render(
      <AccessGate>
        <div>{'child'}</div>
      </AccessGate>,
    );

    await screen.findByText('Access Required');

    fireEvent.change(screen.getByLabelText(/Email/i), {
      target: { value: 'user@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/Access Code/i), {
      target: { value: 'MYCODE' },
    });

    fireEvent.submit(screen.getByText('Continue').closest('form'));

    expect(await screen.findByText('child')).toBeInTheDocument();
    await waitFor(() =>
      expect(validate).toHaveBeenCalledWith('MYCODE', 'user@example.com'),
    );
  });

  test('(d) submitting an invalid code surfaces a toast and keeps the form', async () => {
    validate.mockResolvedValue({ success: true, valid: false });

    render(
      <AccessGate>
        <div>{'child'}</div>
      </AccessGate>,
    );

    await screen.findByText('Access Required');
    fireEvent.change(screen.getByLabelText(/Access Code/i), {
      target: { value: 'BAD' },
    });
    fireEvent.submit(screen.getByText('Continue').closest('form'));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Invalid access code. Please check and try again.',
      ),
    );
    // Still on the login form; children are not rendered.
    expect(screen.getByText('Access Required')).toBeInTheDocument();
    expect(screen.queryByText('child')).not.toBeInTheDocument();
  });
});
