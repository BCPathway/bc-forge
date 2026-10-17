// SPDX-License-Identifier: MIT
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { theme } from '../theme';

export interface CopyToClipboardProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onCopy' | 'onError'> {
  /** The text value to copy to clipboard (e.g. Stellar public key or transaction hash). */
  text: string;
  /** Accessible label or text label for the button. Defaults to 'Copy to clipboard'. */
  label?: string;
  /** Transient confirmation message shown when copy succeeds. @default 'Copied!' */
  successMessage?: string;
  /** Duration in milliseconds to show the transient success feedback. @default 2000 */
  timeout?: number;
  /** Callback invoked when copying successfully writes to clipboard. */
  onCopy?: (text: string) => void;
  /** Callback invoked when copying fails or is rejected. */
  onError?: (error: Error) => void;
  /** Optional custom content. If omitted, standard copy/check icons and label are rendered. */
  children?: React.ReactNode;
  /** Optional container style */
  style?: React.CSSProperties;
  /** Optional container class name */
  className?: string;
}

/**
 * Interactive button component for copying Stellar public keys, contract addresses,
 * and transaction hashes with an animated transient 'Copied!' tooltip confirmation (#1159).
 *
 * Implements full WAI-ARIA accessibility compliance, keyboard navigation, and
 * adheres to bc-forge design tokens.
 */
export const CopyToClipboard: React.FC<CopyToClipboardProps> = ({
  text,
  label = 'Copy to clipboard',
  successMessage = 'Copied!',
  timeout = 2000,
  onCopy,
  onError,
  children,
  style,
  className,
  ...buttonProps
}) => {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleCopy = useCallback(async () => {
    setCopyError(null);
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else if (typeof document !== 'undefined') {
        // Fallback for environments lacking Clipboard API
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);
        if (!successful) throw new Error('Clipboard copy command was unsuccessful');
      } else {
        throw new Error('Clipboard is unavailable in this environment');
      }

      setCopied(true);
      onCopy?.(text);

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setCopied(false);
      }, timeout);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setCopyError(error.message);
      onError?.(error);
    }
  }, [text, timeout, onCopy, onError]);

  return (
    <div
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
      }}
    >
      <button
        type="button"
        data-testid="copy-to-clipboard-button"
        aria-label={copied ? successMessage : label}
        title={copied ? successMessage : label}
        onClick={() => void handleCopy()}
        className={className}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '6px',
          padding: '6px 10px',
          fontSize: '13px',
          fontWeight: 500,
          color: copied ? theme.successText : theme.text,
          backgroundColor: copied ? theme.successBackground : theme.surface,
          border: `1px solid ${copied ? theme.successBorder : theme.border}`,
          borderRadius: '6px',
          cursor: 'pointer',
          transition: 'all 0.15s ease-in-out',
          outline: 'none',
          ...style,
        }}
        {...buttonProps}
      >
        {children ?? (
          <>
            {copied ? (
              <svg
                aria-hidden="true"
                width="14"
                height="14"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                data-testid="copy-success-icon"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg
                aria-hidden="true"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                data-testid="copy-default-icon"
              >
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            )}
            <span>{copied ? successMessage : label}</span>
          </>
        )}
      </button>

      {/* Animated Transient Tooltip Feedback */}
      {copied && (
        <span
          role="status"
          aria-live="polite"
          data-testid="copied-tooltip"
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 6px)',
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '3px 8px',
            fontSize: '11px',
            fontWeight: 600,
            color: '#ffffff',
            backgroundColor: '#1f2937',
            borderRadius: '4px',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            zIndex: 10,
            animation: 'fadeInOut 0.2s ease-in-out',
          }}
        >
          {successMessage}
        </span>
      )}

      {copyError && (
        <span
          role="alert"
          aria-live="assertive"
          data-testid="copy-error"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            fontSize: '11px',
            color: theme.dangerText,
            whiteSpace: 'nowrap',
          }}
        >
          {copyError}
        </span>
      )}
    </div>
  );
};
