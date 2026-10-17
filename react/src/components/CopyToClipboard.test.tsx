// SPDX-License-Identifier: MIT
import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { CopyToClipboard } from './CopyToClipboard';

describe('CopyToClipboard', () => {
  const originalClipboard = navigator.clipboard;
  const mockWriteText = jest.fn();

  beforeEach(() => {
    mockWriteText.mockReset();
    mockWriteText.mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: mockWriteText,
      },
    });
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    Object.assign(navigator, { clipboard: originalClipboard });
  });

  it('renders default button and icon with accessible attributes', () => {
    render(<CopyToClipboard text="GBBD…WXYZ" />);

    const button = screen.getByTestId('copy-to-clipboard-button');
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveAttribute('aria-label', 'Copy to clipboard');
    expect(screen.getByTestId('copy-default-icon')).toBeInTheDocument();
    expect(screen.getByText('Copy to clipboard')).toBeInTheDocument();
  });

  it('writes text to clipboard and displays transient success state for 2 seconds', async () => {
    const onCopy = jest.fn();
    render(
      <CopyToClipboard
        text="GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
        onCopy={onCopy}
      />,
    );

    const button = screen.getByTestId('copy-to-clipboard-button');

    await act(async () => {
      fireEvent.click(button);
    });

    expect(mockWriteText).toHaveBeenCalledWith(
      'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    );
    expect(onCopy).toHaveBeenCalledWith(
      'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    );

    // Shows success state
    expect(screen.getByTestId('copy-success-icon')).toBeInTheDocument();
    expect(screen.getByTestId('copied-tooltip')).toHaveTextContent('Copied!');
    expect(button).toHaveAttribute('aria-label', 'Copied!');

    // Advance 1999ms: still copied
    act(() => {
      jest.advanceTimersByTime(1999);
    });
    expect(screen.getByTestId('copied-tooltip')).toBeInTheDocument();

    // Advance 1ms (reaching 2000ms): resets to default
    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(screen.queryByTestId('copied-tooltip')).not.toBeInTheDocument();
    expect(screen.getByTestId('copy-default-icon')).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-label', 'Copy to clipboard');
  });

  it('supports custom label and successMessage', async () => {
    render(
      <CopyToClipboard
        text="tx-hash-12345"
        label="Copy Tx Hash"
        successMessage="Hash Copied!"
        timeout={1000}
      />,
    );

    const button = screen.getByTestId('copy-to-clipboard-button');
    expect(screen.getByText('Copy Tx Hash')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(button);
    });

    expect(screen.getByTestId('copied-tooltip')).toHaveTextContent('Hash Copied!');
    expect(screen.getAllByText('Hash Copied!').length).toBeGreaterThanOrEqual(1);

    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(screen.queryByTestId('copied-tooltip')).not.toBeInTheDocument();
    expect(screen.getByText('Copy Tx Hash')).toBeInTheDocument();
  });

  it('gracefully captures clipboard rejection without unhandled exceptions', async () => {
    const onError = jest.fn();
    mockWriteText.mockRejectedValue(new Error('Clipboard permission denied'));

    render(<CopyToClipboard text="secret-or-key" onError={onError} />);

    const button = screen.getByTestId('copy-to-clipboard-button');

    await act(async () => {
      fireEvent.click(button);
    });

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(screen.getByTestId('copy-error')).toHaveTextContent('Clipboard permission denied');
  });

  it('renders custom children when provided', () => {
    render(
      <CopyToClipboard text="custom-render">
        <span>Click to Copy Hash</span>
      </CopyToClipboard>,
    );

    expect(screen.getByText('Click to Copy Hash')).toBeInTheDocument();
  });
});
