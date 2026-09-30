// SPDX-License-Identifier: MIT
import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { TransactionToast } from './TransactionToast';

const HASH = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';

describe('TransactionToast', () => {
  describe('pending', () => {
    it('renders a polite status and no hash', () => {
      render(<TransactionToast status="pending" label="Mint" />);

      const toast = screen.getByTestId('transaction-toast');
      expect(toast).toHaveAttribute('data-status', 'pending');
      expect(toast).toHaveAttribute('role', 'status');
      expect(toast).toHaveAttribute('aria-live', 'polite');
      expect(screen.getByTestId('transaction-toast-message')).toHaveTextContent(
        'Submitting transaction…',
      );
      expect(screen.getByText('Mint')).toBeInTheDocument();
      expect(screen.queryByTestId('transaction-toast-hash')).not.toBeInTheDocument();
    });

    it('defaults to the pending status', () => {
      render(<TransactionToast />);

      expect(screen.getByTestId('transaction-toast')).toHaveAttribute('data-status', 'pending');
    });
  });

  describe('success', () => {
    it('shows the transaction hash', () => {
      render(<TransactionToast status="success" hash={HASH} label="Deposit" />);

      const toast = screen.getByTestId('transaction-toast');
      expect(toast).toHaveAttribute('data-status', 'success');
      expect(toast).toHaveAttribute('role', 'status');
      expect(screen.getByTestId('transaction-toast-message')).toHaveTextContent(
        'Transaction confirmed.',
      );
      expect(screen.getByTestId('transaction-toast-hash')).toHaveTextContent(HASH);
    });

    it('ignores a supplied error on the success status', () => {
      const { rerender } = render(<TransactionToast status="success" error="ignored" />);

      expect(screen.getByTestId('transaction-toast-message')).toHaveTextContent(
        'Transaction confirmed.',
      );

      rerender(<TransactionToast status="pending" error="also ignored" />);
      expect(screen.getByTestId('transaction-toast-message')).toHaveTextContent(
        'Submitting transaction…',
      );
    });

    it('links the hash to a block explorer when explorerUrl is given', () => {
      render(
        <TransactionToast
          status="success"
          hash={HASH}
          explorerUrl="https://stellar.expert/explorer/testnet/tx/"
        />,
      );

      const link = screen.getByRole('link');
      expect(link).toHaveAttribute('href', `https://stellar.expert/explorer/testnet/tx/${HASH}`);
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    });
  });

  describe('error', () => {
    it('renders an assertive alert with the error message', () => {
      render(<TransactionToast status="error" error="Mint was rejected" />);

      const toast = screen.getByTestId('transaction-toast');
      expect(toast).toHaveAttribute('data-status', 'error');
      expect(toast).toHaveAttribute('role', 'alert');
      expect(toast).toHaveAttribute('aria-live', 'assertive');
      expect(screen.getByTestId('transaction-toast-message')).toHaveTextContent(
        'Mint was rejected',
      );
    });

    it('unwraps an Error instance', () => {
      render(<TransactionToast status="error" error={new Error('simulation failed')} />);

      expect(screen.getByTestId('transaction-toast-message')).toHaveTextContent(
        'simulation failed',
      );
    });

    it('falls back to a generic message when no error is supplied', () => {
      render(<TransactionToast status="error" />);

      expect(screen.getByTestId('transaction-toast-message')).toHaveTextContent(
        'The transaction failed.',
      );
    });

    it('shows the hash of a submitted-but-failed transaction', () => {
      render(<TransactionToast status="error" hash={HASH} error="reverted" />);

      expect(screen.getByTestId('transaction-toast-hash')).toHaveTextContent(HASH);
    });
  });

  describe('dismissal', () => {
    it('renders a dismiss button only when onDismiss is provided', () => {
      const onDismiss = jest.fn();
      const { rerender } = render(<TransactionToast status="pending" />);
      expect(screen.queryByRole('button')).not.toBeInTheDocument();

      rerender(<TransactionToast status="pending" onDismiss={onDismiss} />);
      screen.getByRole('button', { name: 'Dismiss notification' }).click();

      expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('auto-dismisses after autoDismissMs', () => {
      jest.useFakeTimers();
      try {
        const onDismiss = jest.fn();
        render(<TransactionToast status="success" onDismiss={onDismiss} autoDismissMs={4000} />);

        act(() => {
          jest.advanceTimersByTime(3999);
        });
        expect(onDismiss).not.toHaveBeenCalled();

        act(() => {
          jest.advanceTimersByTime(1);
        });
        expect(onDismiss).toHaveBeenCalledTimes(1);
      } finally {
        jest.useRealTimers();
      }
    });

    it('does not schedule a timer without onDismiss', () => {
      jest.useFakeTimers();
      try {
        render(<TransactionToast status="success" autoDismissMs={4000} />);
        expect(jest.getTimerCount()).toBe(0);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  it('forwards standard div props to the container', () => {
    render(<TransactionToast status="pending" className="custom" data-testid="forwarded" />);

    expect(screen.getByTestId('forwarded')).toHaveClass('custom');
  });
});
