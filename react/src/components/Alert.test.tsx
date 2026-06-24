import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

import { Alert } from './Alert';

describe('Alert', () => {
  it('uses role="alert" for danger and warning variants', () => {
    const { rerender } = render(<Alert variant="danger">boom</Alert>);
    expect(screen.getByRole('alert')).toHaveTextContent('boom');
    rerender(<Alert variant="warning">careful</Alert>);
    expect(screen.getByRole('alert')).toHaveTextContent('careful');
  });

  it('uses role="status" for info and success variants', () => {
    render(<Alert variant="success">ok</Alert>);
    expect(screen.getByRole('status')).toHaveTextContent('ok');
  });

  it('renders the title and body', () => {
    render(<Alert title="Saved">Your changes were stored.</Alert>);
    expect(screen.getByText('Saved')).toBeInTheDocument();
    expect(screen.getByText('Your changes were stored.')).toBeInTheDocument();
  });

  it('renders a dismiss button only when onDismiss is provided', () => {
    const onDismiss = jest.fn();
    const { rerender } = render(<Alert>no button</Alert>);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();

    rerender(<Alert onDismiss={onDismiss}>with button</Alert>);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss alert' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('forwards standard div props and a ref', () => {
    const ref = React.createRef<HTMLDivElement>();
    render(
      <Alert ref={ref} data-testid="a" className="custom">
        hi
      </Alert>,
    );
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
    expect(screen.getByTestId('a')).toHaveClass('custom');
  });
});
