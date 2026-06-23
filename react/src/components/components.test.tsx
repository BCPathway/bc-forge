import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

import { Badge } from './Badge';
import { Alert } from './Alert';
import { Pagination, getPaginationRange } from './Pagination';
import { Modal } from './Modal';

describe('Badge', () => {
  it('renders its children', () => {
    render(<Badge>Verified</Badge>);
    expect(screen.getByText('Verified')).toBeInTheDocument();
  });

  it('forwards standard HTML props (className, aria-label)', () => {
    render(
      <Badge className="custom" aria-label="three failed checks">
        3
      </Badge>,
    );
    const badge = screen.getByLabelText('three failed checks');
    expect(badge).toHaveClass('custom');
  });

  it('forwards a ref to the span element', () => {
    const ref = React.createRef<HTMLSpanElement>();
    render(<Badge ref={ref}>x</Badge>);
    expect(ref.current).toBeInstanceOf(HTMLSpanElement);
  });
});

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
    render(
      <Alert title="Saved">Your changes were stored.</Alert>,
    );
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
});

describe('getPaginationRange', () => {
  it('lists every page when the total fits without collapsing', () => {
    expect(getPaginationRange(1, 5, 1)).toEqual([1, 2, 3, 4, 5]);
  });

  it('collapses the right side near the start', () => {
    expect(getPaginationRange(1, 10, 1)).toEqual([1, 2, 3, 4, 5, 'dots', 10]);
  });

  it('collapses the left side near the end', () => {
    expect(getPaginationRange(10, 10, 1)).toEqual([1, 'dots', 6, 7, 8, 9, 10]);
  });

  it('collapses both sides in the middle', () => {
    expect(getPaginationRange(5, 10, 1)).toEqual([1, 'dots', 4, 5, 6, 'dots', 10]);
  });
});

describe('Pagination', () => {
  it('renders nothing for a single page', () => {
    const { container } = render(
      <Pagination currentPage={1} totalPages={1} onPageChange={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('marks the current page with aria-current and disables Previous on page 1', () => {
    render(<Pagination currentPage={1} totalPages={5} onPageChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Go to page 1' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('button', { name: 'Go to previous page' })).toBeDisabled();
  });

  it('calls onPageChange when a page button is activated', () => {
    const onPageChange = jest.fn();
    render(<Pagination currentPage={1} totalPages={5} onPageChange={onPageChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Go to page 3' }));
    expect(onPageChange).toHaveBeenCalledWith(3);
  });

  it('does not fire onPageChange for the already-active page', () => {
    const onPageChange = jest.fn();
    render(<Pagination currentPage={2} totalPages={5} onPageChange={onPageChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Go to page 2' }));
    expect(onPageChange).not.toHaveBeenCalled();
  });
});

describe('Modal', () => {
  it('renders nothing when closed', () => {
    render(
      <Modal open={false} onClose={() => {}} title="Hidden">
        body
      </Modal>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('exposes a labelled modal dialog when open', () => {
    render(
      <Modal open onClose={() => {}} title="Confirm action">
        Are you sure?
      </Modal>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Confirm action');
  });

  it('moves focus inside the dialog on open', () => {
    render(
      <Modal open onClose={() => {}} title="Focus test">
        <button type="button">Inner action</button>
      </Modal>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('calls onClose on Escape and on the close button', () => {
    const onClose = jest.fn();
    render(
      <Modal open onClose={onClose} title="Closable">
        body
      </Modal>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
