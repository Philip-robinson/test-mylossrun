import { render, screen, fireEvent } from '@testing-library/react';
import ColumnNameCombo from 'components/pdfTableViewer/ColumnNameCombo';

describe('ColumnNameCombo', () => {
  it('renders a "Column name" labelled input', () => {
    render(
      <ColumnNameCombo value={null} options={[]} onChange={jest.fn()} />
    );
    expect(screen.getByLabelText('Column name')).toBeInTheDocument();
  });

  it('is disabled when the disabled prop is set', () => {
    render(
      <ColumnNameCombo disabled value={null} options={[]} onChange={jest.fn()} />
    );
    expect(screen.getByLabelText('Column name')).toBeDisabled();
  });

  it('writes a typed value to onChange', () => {
    const onChange = jest.fn();
    render(
      <ColumnNameCombo value={null} options={['Premium']} onChange={onChange} />
    );
    const input = screen.getByLabelText('Column name');
    fireEvent.change(input, { target: { value: 'NewColumn' } });
    expect(onChange).toHaveBeenCalledWith('NewColumn');
  });

  it('offers the provided options and writes a picked value to onChange', async () => {
    const onChange = jest.fn();
    render(
      <ColumnNameCombo
        value={null}
        options={['Premium', 'Claims']}
        onChange={onChange}
      />
    );
    const input = screen.getByLabelText('Column name');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Pre' } });
    const option = await screen.findByText('Premium');
    fireEvent.click(option);
    expect(onChange).toHaveBeenCalledWith('Premium');
  });

  it('reflects the bound value', () => {
    render(
      <ColumnNameCombo
        value={'Claims'}
        options={['Premium', 'Claims']}
        onChange={jest.fn()}
      />
    );
    expect(screen.getByLabelText('Column name')).toHaveValue('Claims');
  });
});
