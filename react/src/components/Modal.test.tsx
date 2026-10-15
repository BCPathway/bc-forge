// SPDX-License-Identifier: MIT
import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { Modal } from './Modal';

/** Host that owns `open` so the dialog can open, close and reopen. */
const Harness: React.FC<{
  initialOpen?: boolean;
  onClose?: () => void;
  closeOnBackdropClick?: boolean;
  closeOnEscape?: boolean;
  withInitialFocus?: boolean;
}> = ({
  initialOpen = false,
  onClose,
  closeOnBackdropClick,
  closeOnEscape,
  withInitialFocus = false,
}) => {
  const [open, setOpen] = React.useState(initialOpen);
  const primaryRef = React.useRef<HTMLButtonElement>(null);

  const close = React.useCallback(() => {
    setOpen(false);
    onClose?.();
  }, [onClose]);

  return (
    <div>
      <button
        type="button"
        data-testid="trigger"
        onClick={() => setOpen(true)}
      >
        Open dialog
      </button>
      <Modal
        open={open}
        onClose={close}
        title="Confirm deposit"
        description="Deposits are irreversible."
        closeOnBackdropClick={closeOnBackdropClick}
        closeOnEscape={closeOnEscape}
        initialFocusRef={withInitialFocus ? primaryRef : undefined}
        footer={<button type="button">Confirm</button>}
      >
        <button type="button" ref={primaryRef} data-testid="primary-action">
          Primary action
        </button>
      </Modal>
    </div>
  );
};

describe('Modal', () => {
  afterEach(() => {
    // The dialog locks the body while open; make sure a failed assertion cannot
    // leak that lock into the next test.
    document.body.style.overflow = '';
  });

  it('renders nothing while closed', () => {
    render(<Modal open={false} onClose={() => {}} title="Hidden" />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByTestId('modal-backdrop')).not.toBeInTheDocument();
  });

  it('exposes dialog semantics with a name and description', () => {
    render(<Modal open onClose={() => {}} title="Confirm deposit" description="Irreversible." />);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');

    const title = screen.getByTestId('modal-title');
    const description = screen.getByTestId('modal-description');
    expect(dialog).toHaveAttribute('aria-labelledby', title.id);
    expect(dialog).toHaveAttribute('aria-describedby', description.id);
    expect(title).toHaveTextContent('Confirm deposit');
    expect(description).toHaveTextContent('Irreversible.');
  });

  it('falls back to an explicit accessible name when no title is given', () => {
    render(<Modal open onClose={() => {}} />);
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Dialog');
  });

  it('honours an externally supplied ariaLabel and labelledBy', () => {
    const { rerender } = render(<Modal open onClose={() => {}} ariaLabel="Session expired" />);
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Session expired');

    rerender(<Modal open onClose={() => {}} title="Inner" labelledBy="external-heading" />);
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-labelledby', 'external-heading');
    expect(screen.getByRole('dialog')).not.toHaveAttribute('aria-label');
  });

  it('renders through a portal on document.body', () => {
    const { container } = render(<Modal open onClose={() => {}} title="Portalled" />);
    const backdrop = screen.getByTestId('modal-backdrop');
    expect(backdrop.parentElement).toBe(document.body);
    expect(container.contains(backdrop)).toBe(false);
  });

  it('renders a fixed, blurred backdrop', () => {
    render(<Modal open onClose={() => {}} title="Blurred" />);
    // The blur itself is not observable from jsdom; this pins the element that
    // carries it (see `BACKDROP_STYLE` in ./Modal).
    expect(screen.getByTestId('modal-backdrop')).toHaveStyle({
      position: 'fixed',
      zIndex: '1000',
    });
  });

  it('applies each size preset', () => {
    const widths: Record<string, string> = { sm: '420px', md: '560px', lg: '760px' };
    for (const [size, maxWidth] of Object.entries(widths)) {
      const { unmount } = render(
        <Modal open onClose={() => {}} size={size as 'sm' | 'md' | 'lg'} title="Sized" />,
      );
      expect(screen.getByTestId('modal-dialog')).toHaveStyle({ maxWidth });
      unmount();
    }
  });

  it('renders children and footer, and merges className and style', () => {
    render(
      <Modal
        open
        onClose={() => {}}
        title="Details"
        footer={<button type="button">Save</button>}
        className="custom-modal"
        style={{ maxWidth: 300 }}
      >
        <p data-testid="modal-body-copy">Body copy</p>
      </Modal>,
    );

    expect(screen.getByTestId('modal-body-copy')).toHaveTextContent('Body copy');
    expect(screen.getByTestId('modal-footer')).toBeInTheDocument();
    expect(screen.getByTestId('modal-dialog')).toHaveClass('custom-modal');
    expect(screen.getByTestId('modal-dialog')).toHaveStyle({ maxWidth: '300px' });
  });

  it('moves focus into the dialog on open and restores it on close', async () => {
    render(<Harness />);

    const trigger = screen.getByTestId('trigger');
    trigger.focus();
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);

    const close = await screen.findByTestId('modal-close');
    await waitFor(() => expect(close).toHaveFocus());

    fireEvent.click(close);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('focuses initialFocusRef when one is supplied', async () => {
    render(<Harness withInitialFocus />);

    fireEvent.click(screen.getByTestId('trigger'));

    await waitFor(() =>
      expect(screen.getByTestId('primary-action')).toHaveFocus(),
    );
  });

  it('keeps the dialog programmatically focusable as a fallback', () => {
    render(<Modal open onClose={() => {}} title="Notice" />);
    expect(screen.getByRole('dialog')).toHaveAttribute('tabindex', '-1');
  });

  it('cycles Tab and Shift+Tab inside the dialog', async () => {
    render(<Harness initialOpen />);

    const close = await screen.findByTestId('modal-close');
    const primary = screen.getByTestId('primary-action');
    const confirm = screen.getByRole('button', { name: 'Confirm' });
    await waitFor(() => expect(close).toHaveFocus());

    // jsdom does not move focus on Tab, so each step focuses the control the
    // browser would have reached and then checks the trap's wrap-around.
    // `fireEvent` returns `false` when a handler called `preventDefault()`.
    primary.focus();
    expect(fireEvent.keyDown(primary, { key: 'Tab' })).toBe(true);
    expect(primary).toHaveFocus();

    confirm.focus();
    expect(fireEvent.keyDown(confirm, { key: 'Tab' })).toBe(false);
    expect(close).toHaveFocus();

    close.focus();
    expect(fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })).toBe(false);
    expect(confirm).toHaveFocus();
  });

  it('dismisses on Escape', () => {
    const onClose = jest.fn();
    render(<Modal open onClose={onClose} title="Escapable" />);

    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores Escape when closeOnEscape is false', () => {
    const onClose = jest.fn();
    render(<Modal open onClose={onClose} title="Sticky" closeOnEscape={false} />);

    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('dismisses on a backdrop click but not on a click inside the dialog', () => {
    const onClose = jest.fn();
    render(
      <Modal open onClose={onClose} title="Backdrop">
        <button type="button" data-testid="inside">
          Inside
        </button>
      </Modal>,
    );

    fireEvent.click(screen.getByTestId('inside'));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('modal-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores backdrop clicks when closeOnBackdropClick is false', () => {
    const onClose = jest.fn();
    render(<Modal open onClose={onClose} title="Sticky" closeOnBackdropClick={false} />);

    fireEvent.click(screen.getByTestId('modal-backdrop'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('gives the close button an accessible name', () => {
    const { rerender } = render(<Modal open onClose={() => {}} title="Named" />);
    expect(screen.getByRole('button', { name: 'Close dialog' })).toBeInTheDocument();

    rerender(<Modal open onClose={() => {}} title="Named" closeLabel="Dismiss" />);
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
  });

  it('locks the page behind the dialog and restores it on close', async () => {
    document.body.style.overflow = 'scroll';

    const { rerender } = render(<Modal open onClose={() => {}} title="Locked" />);
    expect(document.body.style.overflow).toBe('hidden');

    rerender(<Modal open={false} onClose={() => {}} title="Locked" />);
    await waitFor(() => expect(document.body.style.overflow).toBe('scroll'));
  });

  it('keeps the scroll lock until the last stacked dialog closes', async () => {
    document.body.style.overflow = 'auto';

    const { rerender } = render(
      <>
        <Modal open onClose={() => {}} title="First" />
        <Modal open onClose={() => {}} title="Second" />
      </>,
    );

    expect(document.body.style.overflow).toBe('hidden');

    rerender(
      <>
        <Modal open={false} onClose={() => {}} title="First" />
        <Modal open onClose={() => {}} title="Second" />
      </>,
    );
    expect(document.body.style.overflow).toBe('hidden');

    rerender(
      <>
        <Modal open={false} onClose={() => {}} title="First" />
        <Modal open={false} onClose={() => {}} title="Second" />
      </>,
    );
    await waitFor(() => expect(document.body.style.overflow).toBe('auto'));
  });

  it('lets only the topmost stacked dialog react to Escape', () => {
    const onOuterClose = jest.fn();
    const onInnerClose = jest.fn();
    render(
      <Modal open onClose={onOuterClose} title="Outer">
        <Modal open onClose={onInnerClose} title="Inner" />
      </Modal>,
    );

    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onInnerClose).toHaveBeenCalledTimes(1);
    expect(onOuterClose).not.toHaveBeenCalled();
  });
});