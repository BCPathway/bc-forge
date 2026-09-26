import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TransferScreen } from './TransferScreen';

const mockUseBalance = jest.fn();
const mockTransfer = jest.fn();

jest.mock('../hooks', () => ({
  useBalance: (...args: unknown[]) => mockUseBalance(...args),
  useTransfer: () => ({
    transfer: mockTransfer,
    loading: false,
    error: null as Error | null,
  }),
}));

const ADDRESS = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGWEBUSAVCBCY42YOXT';
const DESTINATION = 'GB7B4Z57YDO7PZPO4GBDJJYTYKVOPZNWADPTO7MSKNRZWWTULCA2MB2I';

describe('TransferScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseBalance.mockReturnValue({ data: null, loading: false, error: null });
    mockTransfer.mockResolvedValue({ success: true, hash: '0xtransferhash' });
  });

  it('disables submit while disconnected, when the destination is empty, and for invalid or over-balance amounts', () => {
    mockUseBalance.mockReturnValue({ data: 1_000n, loading: false, error: null });

    // Disconnected: no address at all.
    const { rerender } = render(<TransferScreen />);
    expect(screen.getByTestId('transfer-connected-address')).toHaveTextContent('Not connected');
    expect(screen.getByTestId('transfer-submit')).toBeDisabled();

    // Connected but destination empty and amount empty.
    rerender(<TransferScreen walletAddress={ADDRESS} />);
    expect(screen.getByTestId('transfer-balance')).toHaveTextContent('1000');
    expect(screen.getByTestId('transfer-submit')).toBeDisabled();

    // Non-integer / zero amount.
    fireEvent.change(screen.getByLabelText('Destination address'), {
      target: { value: DESTINATION },
    });
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '0' } });
    expect(screen.getByTestId('transfer-submit')).toBeDisabled();

    // Amount above the displayed balance.
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '1001' } });
    expect(screen.getByTestId('transfer-submit')).toBeDisabled();
    expect(screen.getByTestId('transfer-over-balance')).toBeInTheDocument();
    expect(mockTransfer).not.toHaveBeenCalled();
  });

  it('submits a transfer from the connected address and shows the transaction hash', async () => {
    mockUseBalance.mockReturnValue({ data: 1_000n, loading: false, error: null });

    render(<TransferScreen walletAddress={ADDRESS} />);

    fireEvent.change(screen.getByLabelText('Destination address'), {
      target: { value: DESTINATION },
    });
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '250' } });
    fireEvent.click(screen.getByTestId('transfer-submit'));

    await waitFor(() => {
      expect(mockTransfer).toHaveBeenCalledTimes(1);
    });
    expect(mockTransfer).toHaveBeenCalledWith(ADDRESS, DESTINATION, 250n);

    await waitFor(() => {
      expect(screen.getByTestId('transfer-success')).toHaveTextContent(
        'Transaction hash: 0xtransferhash',
      );
    });
  });
});
