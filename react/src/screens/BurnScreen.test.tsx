import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BurnScreen } from './BurnScreen';

const mockUseBalance = jest.fn();
const mockBurn = jest.fn();

jest.mock('../hooks', () => ({
  useBalance: (...args: unknown[]) => mockUseBalance(...args),
  useBurn: () => ({
    burn: mockBurn,
    loading: false,
    error: null as Error | null,
  }),
}));

const ADDRESS = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGWEBUSAVCBCY42YOXT';

describe('BurnScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseBalance.mockReturnValue({ data: null, loading: false, error: null });
    mockBurn.mockResolvedValue({ success: true, hash: '0xburnhash' });
  });

  it('shows the connected balance and disables submit above it', () => {
    mockUseBalance.mockReturnValue({ data: 500n, loading: false, error: null });

    render(<BurnScreen walletAddress={ADDRESS} />);

    expect(screen.getByTestId('burn-connected-address')).toHaveTextContent(ADDRESS);
    expect(screen.getByTestId('burn-balance')).toHaveTextContent('500');

    // Valid amount is submittable.
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '100' } });
    expect(screen.getByTestId('burn-submit')).toBeEnabled();

    // Over balance: disabled and warned, and nothing was submitted.
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '501' } });
    expect(screen.getByTestId('burn-submit')).toBeDisabled();
    expect(screen.getByTestId('burn-over-balance')).toBeInTheDocument();
    expect(mockBurn).not.toHaveBeenCalled();

    // Not a positive integer: disabled.
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '0' } });
    expect(screen.getByTestId('burn-submit')).toBeDisabled();
  });

  it('submits a burn for the connected address and shows the transaction hash', async () => {
    mockUseBalance.mockReturnValue({ data: 500n, loading: false, error: null });

    render(<BurnScreen walletAddress={ADDRESS} />);

    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '100' } });
    fireEvent.click(screen.getByTestId('burn-submit'));

    await waitFor(() => {
      expect(mockBurn).toHaveBeenCalledTimes(1);
    });
    expect(mockBurn).toHaveBeenCalledWith(ADDRESS, 100n);

    await waitFor(() => {
      expect(screen.getByTestId('burn-success')).toHaveTextContent(
        'Transaction hash: 0xburnhash',
      );
    });
  });
});
