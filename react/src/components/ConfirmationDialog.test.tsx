// SPDX-License-Identifier: MIT
import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import {
  ConfirmationDialog,
  DEFAULT_CONFIRMATION_KEYWORD,
  type ConfirmationDialogProps,
} from './ConfirmationDialog';
import { theme } from '../theme';

const renderDialog = (props: Partial<ConfirmationDialogProps> = {}) => {
  const onClose = props.onClose ?? jest.fn();
  const onConfirm = props.onConfirm ?? jest.fn();
  const utils = render(
    <ConfirmationDialog
      open
      title="Burn 1,000 BCC?"
      description="This supply is removed forever and cannot be undone."
      onClose={onClose}
      onConfirm={onConfirm}
      {...props}
    />,
  );
  return { ...utils, onClose, onConfirm };
};

describe('ConfirmationDialog', () => {
  it('renders nothing while closed', () => {
    const { container } = renderDialog({ open: false });

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders into a portal outside the caller subtree', () => {
    const { container } = renderDialog();

    expect(container).toBeEmptyDOMElement();
    expect(screen.getByTestId('confirmation-dialog-backdrop')).toBeInTheDocument();
    expect(document.body.querySelector('[data-testid="confirmation-dialog"]')).not.toBeNull();
  });

  it('exposes the dialog role, modality and accessible name', () => {
    renderDialog();

    const dialog = screen.getByRole('dialog', { name: 'Burn 1,000 BCC?' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby');
    expect(dialog).toHaveAttribute('aria-describedby');

    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).not.toBeNull();
    expect(document.getElementById(labelledBy ?? '')).toHaveTextContent('Burn 1,000 BCC?');

    const describedBy = dialog.getAttribute('aria-describedby');
    expect(describedBy).not.toBeNull();
    expect(document.getElementById(describedBy ?? '')).toHaveTextContent(
      'This supply is removed forever and cannot be undone.',
    );
  });

  it('uses children as the accessible description when no description is given', () => {
    renderDialog({ description: undefined, children: <p>Revoking the admin role.</p> });

    const dialog = screen.getByRole('dialog');
    const describedBy = dialog.getAttribute('aria-describedby');
    expect(describedBy).not.toBeNull();
    expect(document.getElementById(describedBy ?? '')).toHaveTextContent(
      'Revoking the admin role.',
    );
  });

  it('renders extra children inside the dialog', () => {
    renderDialog({ children: <p data-testid="extra">Amount: 1,000 BCC</p> });

    expect(screen.getByTestId('extra')).toBeInTheDocument();
  });

  it('renders nothing but the controls when there is no body at all', () => {
    renderDialog({ description: undefined });

    const dialog = screen.getByRole('dialog');
    expect(dialog).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByTestId('confirmation-dialog-body')).not.toBeInTheDocument();
  });

  it('keeps confirm disabled until the checkbox is ticked', () => {
    const { onConfirm } = renderDialog({ confirmationMode: 'checkbox' });

    const confirm = screen.getByTestId('confirmation-dialog-confirm');
    expect(confirm).toBeDisabled();

    fireEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();

    const checkbox = screen.getByTestId('confirmation-dialog-checkbox');
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);

    expect(checkbox).toBeChecked();
    expect(confirm).not.toBeDisabled();

    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('re-locks confirm when the checkbox is unticked', () => {
    renderDialog({ confirmationMode: 'checkbox' });

    const checkbox = screen.getByTestId('confirmation-dialog-checkbox');
    fireEvent.click(checkbox);
    expect(screen.getByTestId('confirmation-dialog-confirm')).not.toBeDisabled();

    fireEvent.click(checkbox);
    expect(screen.getByTestId('confirmation-dialog-confirm')).toBeDisabled();
  });

  it('exposes the checkbox as a focusable form control', () => {
    const { onConfirm } = renderDialog({ confirmationMode: 'checkbox' });

    const checkbox = screen.getByTestId('confirmation-dialog-checkbox');
    checkbox.focus();
    expect(document.activeElement).toBe(checkbox);

    fireEvent.click(checkbox);
    expect(screen.getByTestId('confirmation-dialog-confirm')).not.toBeDisabled();

    fireEvent.click(screen.getByTestId('confirmation-dialog-confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('is the checkbox mode by default', () => {
    renderDialog();

    expect(screen.getByTestId('confirmation-dialog-checkbox')).toBeInTheDocument();
    expect(screen.queryByTestId('confirmation-dialog-keyword-input')).not.toBeInTheDocument();
  });

  it('keeps confirm disabled until the keyword is typed', () => {
    const { onConfirm } = renderDialog({
      confirmationMode: 'keyword',
      confirmationKeyword: 'BURN',
    });

    const input = screen.getByTestId('confirmation-dialog-keyword-input');
    const confirm = screen.getByTestId('confirmation-dialog-confirm');
    expect(confirm).toBeDisabled();

    fireEvent.change(input, { target: { value: 'burn' } });
    expect(confirm).not.toBeDisabled();

    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('does not unlock on a partial or wrong keyword', () => {
    renderDialog({ confirmationMode: 'keyword', confirmationKeyword: 'REVOKE' });

    const input = screen.getByTestId('confirmation-dialog-keyword-input');
    const confirm = screen.getByTestId('confirmation-dialog-confirm');

    fireEvent.change(input, { target: { value: 'rev' } });
    expect(confirm).toBeDisabled();

    fireEvent.change(input, { target: { value: 'revoked' } });
    expect(confirm).toBeDisabled();

    fireEvent.change(input, { target: { value: '  REVOKE  ' } });
    expect(confirm).not.toBeDisabled();
  });

  it('falls back to the default keyword in keyword mode', () => {
    renderDialog({ confirmationMode: 'keyword' });

    expect(
      screen.getByText(`Type ${DEFAULT_CONFIRMATION_KEYWORD} to confirm this action.`),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('confirmation-dialog-keyword-input'), {
      target: { value: DEFAULT_CONFIRMATION_KEYWORD },
    });
    expect(screen.getByTestId('confirmation-dialog-confirm')).not.toBeDisabled();
  });

  it('accepts a custom keyword prompt', () => {
    renderDialog({ confirmationMode: 'keyword', keywordLabel: 'Type the token symbol' });

    expect(screen.getByLabelText('Type the token symbol')).toBe(
      screen.getByTestId('confirmation-dialog-keyword-input'),
    );
  });

  it('needs no gate at all in none mode', () => {
    const { onConfirm } = renderDialog({ confirmationMode: 'none' });

    expect(screen.queryByTestId('confirmation-dialog-checkbox')).not.toBeInTheDocument();
    expect(screen.queryByTestId('confirmation-dialog-keyword-input')).not.toBeInTheDocument();
    expect(screen.getByTestId('confirmation-dialog-confirm')).not.toBeDisabled();

    fireEvent.click(screen.getByTestId('confirmation-dialog-confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('uses custom confirm and cancel labels', () => {
    const { onClose } = renderDialog({ confirmLabel: 'Burn it', cancelLabel: 'Keep supply' });

    expect(screen.getByRole('button', { name: 'Burn it' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Keep supply' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('uses a custom checkbox label', () => {
    renderDialog({ confirmationLabel: 'I accept the loss of supply.' });

    expect(screen.getByText('I accept the loss of supply.')).toBeInTheDocument();
  });

  it('locks both buttons and shows the busy label while busy', () => {
    renderDialog({ confirmationMode: 'none', busy: true, busyLabel: 'Submitting…' });

    expect(screen.getByTestId('confirmation-dialog-confirm')).toBeDisabled();
    expect(screen.getByTestId('confirmation-dialog-confirm')).toHaveTextContent('Submitting…');
    expect(screen.getByTestId('confirmation-dialog-cancel')).toBeDisabled();
  });

  it('does not close on Escape while busy', () => {
    const { onClose } = renderDialog({ confirmationMode: 'none', busy: true });

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on Escape when not busy', () => {
    const { onClose } = renderDialog();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close on Escape when closeOnEscape is off', () => {
    const { onClose } = renderDialog({ closeOnEscape: false });

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('ignores other keys', () => {
    const { onClose } = renderDialog();

    fireEvent.keyDown(document, { key: 'Enter' });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on a backdrop click but not on a click inside the panel', () => {
    const { onClose } = renderDialog();

    fireEvent.click(screen.getByTestId('confirmation-dialog-title'));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('confirmation-dialog-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close on a backdrop click when closeOnBackdropClick is off', () => {
    const { onClose } = renderDialog({ closeOnBackdropClick: false });

    fireEvent.click(screen.getByTestId('confirmation-dialog-backdrop'));

    expect(onClose).not.toHaveBeenCalled();
  });

  it('moves focus onto the panel when it opens', () => {
    renderDialog();

    expect(document.activeElement).toBe(screen.getByTestId('confirmation-dialog'));
  });

  it('restores focus to the previously focused element when it closes', async () => {
    const trigger = document.createElement('button');
    trigger.type = 'button';
    document.body.appendChild(trigger);
    trigger.focus();

    const { rerender } = render(
      <ConfirmationDialog
        open
        title="Burn?"
        description="Gone forever."
        onClose={jest.fn()}
        onConfirm={jest.fn()}
      />,
    );
    expect(document.activeElement).toBe(screen.getByTestId('confirmation-dialog'));

    rerender(
      <ConfirmationDialog
        open={false}
        title="Burn?"
        description="Gone forever."
        onClose={jest.fn()}
        onConfirm={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });

    trigger.remove();
  });

  it('traps Tab inside the panel', () => {
    const { onConfirm } = renderDialog();

    const dialog = screen.getByTestId('confirmation-dialog');
    const checkbox = screen.getByTestId('confirmation-dialog-checkbox');
    const cancel = screen.getByTestId('confirmation-dialog-cancel');
    const confirm = screen.getByTestId('confirmation-dialog-confirm');

    // Satisfy the gate so Confirm is focusable; the focus order is then
    // checkbox -> cancel -> confirm.
    fireEvent.click(checkbox);
    expect(confirm).not.toBeDisabled();

    // Tab from the last control wraps back to the first.
    confirm.focus();
    expect(document.activeElement).toBe(confirm);
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(checkbox);

    // Tab in the middle of the order is left to the browser.
    cancel.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(cancel);

    // Shift+Tab from the first control wraps forward to the last.
    checkbox.focus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(confirm);

    // Shift+Tab from the panel itself also wraps forward.
    dialog.focus();
    expect(document.activeElement).toBe(dialog);
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(confirm);

    // Non-Tab keys never move focus.
    dialog.focus();
    fireEvent.keyDown(dialog, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(dialog);

    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('locks background scrolling while open and restores it on close', () => {
    const { rerender } = render(
      <ConfirmationDialog
        open
        title="Burn?"
        description="Gone forever."
        onClose={jest.fn()}
        onConfirm={jest.fn()}
      />,
    );
    expect(document.body.style.overflow).toBe('hidden');

    rerender(
      <ConfirmationDialog
        open={false}
        title="Burn?"
        description="Gone forever."
        onClose={jest.fn()}
        onConfirm={jest.fn()}
      />,
    );
    expect(document.body.style.overflow).not.toBe('hidden');
  });

  it('resets the confirmation gate when reopened', () => {
    const base: Omit<ConfirmationDialogProps, 'open'> = {
      title: 'Burn?',
      description: 'Gone forever.',
      onClose: jest.fn(),
      onConfirm: jest.fn(),
    };
    const { rerender } = render(<ConfirmationDialog {...base} open />);

    fireEvent.click(screen.getByTestId('confirmation-dialog-checkbox'));
    expect(screen.getByTestId('confirmation-dialog-confirm')).not.toBeDisabled();

    rerender(<ConfirmationDialog {...base} open={false} />);
    rerender(<ConfirmationDialog {...base} open />);

    expect(screen.getByTestId('confirmation-dialog-checkbox')).not.toBeChecked();
    expect(screen.getByTestId('confirmation-dialog-confirm')).toBeDisabled();
  });

  it('resets the typed keyword when reopened', () => {
    const base: Omit<ConfirmationDialogProps, 'open'> = {
      title: 'Burn?',
      description: 'Gone forever.',
      confirmationMode: 'keyword',
      confirmationKeyword: 'BURN',
      onClose: jest.fn(),
      onConfirm: jest.fn(),
    };
    const { rerender } = render(<ConfirmationDialog {...base} open />);

    fireEvent.change(screen.getByTestId('confirmation-dialog-keyword-input'), {
      target: { value: 'BURN' },
    });
    expect(screen.getByTestId('confirmation-dialog-confirm')).not.toBeDisabled();

    rerender(<ConfirmationDialog {...base} open={false} />);
    rerender(<ConfirmationDialog {...base} open />);

    expect(screen.getByTestId('confirmation-dialog-keyword-input')).toHaveValue('');
    expect(screen.getByTestId('confirmation-dialog-confirm')).toBeDisabled();
  });

  it('renders into a custom portal container', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    renderDialog({ portalContainer: host });

    expect(host.querySelector('[data-testid="confirmation-dialog"]')).not.toBeNull();

    host.remove();
  });

  it('themes the warning variant and lets a consumer style win', () => {
    renderDialog({ variant: 'warning', style: { padding: '4px' } });

    expect(screen.getByTestId('confirmation-dialog')).toHaveStyle({
      borderColor: theme.warningBorder,
      padding: '4px',
    });
    expect(screen.getByTestId('confirmation-dialog-confirm')).toHaveStyle({
      backgroundColor: theme.warningText,
    });
  });

  it('themes the danger variant by default', () => {
    renderDialog();

    expect(screen.getByTestId('confirmation-dialog')).toHaveStyle({
      borderColor: theme.dangerBorder,
    });
    expect(screen.getByTestId('confirmation-dialog-confirm')).toHaveStyle({
      backgroundColor: theme.danger,
    });
  });
});