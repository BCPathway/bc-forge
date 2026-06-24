import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

import { Badge } from './Badge';

describe('Badge', () => {
  it('renders children', () => {
    render(<Badge>New</Badge>);
    expect(screen.getByText('New')).toBeInTheDocument();
  });

  it('renders with all variants', () => {
    const variants = ['default', 'primary', 'success', 'warning', 'danger', 'info'] as const;
    for (const variant of variants) {
      const { unmount } = render(<Badge variant={variant}>{variant}</Badge>);
      expect(screen.getByText(variant)).toBeInTheDocument();
      unmount();
    }
  });

  it('renders with all sizes', () => {
    const sizes = ['sm', 'md', 'lg'] as const;
    for (const size of sizes) {
      const { unmount } = render(<Badge size={size}>{size}</Badge>);
      expect(screen.getByText(size)).toBeInTheDocument();
      unmount();
    }
  });

  it('is not interactive by default', () => {
    render(<Badge data-testid="badge">static</Badge>);
    const badge = screen.getByTestId('badge');
    expect(badge).not.toHaveAttribute('role');
    expect(badge).not.toHaveAttribute('tabindex');
  });

  it('is interactive when onClick is provided', () => {
    const onClick = jest.fn();
    render(<Badge onClick={onClick}>clickable</Badge>);
    const badge = screen.getByRole('button');
    expect(badge).toHaveAttribute('tabindex', '0');
    fireEvent.click(badge);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('handles keyboard activation with Enter and Space', () => {
    const onClick = jest.fn();
    render(<Badge onClick={onClick}>keyboard</Badge>);
    const badge = screen.getByRole('button');

    fireEvent.keyDown(badge, { key: 'Enter' });
    expect(onClick).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(badge, { key: ' ' });
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('calls both onKeyDown and onClick for keyboard activation', () => {
    const onClick = jest.fn();
    const onKeyDown = jest.fn();
    render(
      <Badge onClick={onClick} onKeyDown={onKeyDown}>
        key
      </Badge>,
    );
    const badge = screen.getByRole('button');
    fireEvent.keyDown(badge, { key: 'Enter' });
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });

  it('forwards standard span props and a ref', () => {
    const ref = React.createRef<HTMLSpanElement>();
    render(
      <Badge ref={ref} data-testid="badge" className="custom">
        forwarded
      </Badge>,
    );
    expect(ref.current).toBeInstanceOf(HTMLSpanElement);
    expect(screen.getByTestId('badge')).toHaveClass('custom');
  });

  it('allows overriding interactive props explicitly', () => {
    render(
      <Badge onClick={() => {}} role="tab" tabIndex={-1}>
        override
      </Badge>,
    );
    const badge = screen.getByRole('tab');
    expect(badge).toHaveAttribute('tabindex', '-1');
  });

  it('does not prevent default for non-activation keys', () => {
    const onClick = jest.fn();
    render(<Badge onClick={onClick}>key</Badge>);
    const badge = screen.getByRole('button');
    fireEvent.keyDown(badge, { key: 'Escape' });
    expect(onClick).not.toHaveBeenCalled();
  });
});
