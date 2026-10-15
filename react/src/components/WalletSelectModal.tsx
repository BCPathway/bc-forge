// SPDX-License-Identifier: MIT
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useWallet } from '../hooks';
import type { WalletName } from '../context';
import {
  ALBEDO_EXTENSION_URL,
  FREIGHTER_INSTALL_URL,
  isBrowser,
  // Aliased: the wallet context exposes a `detectWallets` action of its own,
  // and this standalone probe is only the fallback for an unpopulated provider.
  detectWallets as probeWallets,
  type WalletAvailability,
} from '../wallets/detection';
import { theme } from '../theme';
import { Alert } from './Alert';
import { Badge } from './Badge';

export interface WalletSelectModalProps {
  /** Whether the dialog is visible. Nothing is rendered while `false`. */
  open: boolean;
  /**
   * Called by Escape, by a click on the backdrop, and by the close button.
   *
   * The host is expected to flip `open` to `false`; the dialog never closes
   * itself, so a router or a test can drive it.
   */
  onClose: () => void;
  /** Heading text, also the dialog's accessible name. @default 'Connect a wallet' */
  title?: string;
  /**
   * Explanatory line under the heading. Pass `null` to hide it.
   * @default 'Choose how you would like to connect.'
   */
  description?: React.ReactNode;
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Visible descendants that can hold focus, in document order. */
function getFocusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => element.getAttribute('aria-hidden') !== 'true',
  );
}

/**
 * Reads the `data-focus-key` of the focused control, or of its nearest ancestor
 * carrying one. React focus events bubble, so one pair of handlers on the dialog
 * tracks every control inside it — inline styles cannot express `:focus-visible`.
 */
function focusKeyOf(target: EventTarget | null): string | null {
  if (!(target instanceof HTMLElement)) return null;
  return target.closest<HTMLElement>('[data-focus-key]')?.dataset.focusKey ?? null;
}

/** Ring drawn around a wallet row while it holds focus. */
const FOCUS_RING_STYLE: React.CSSProperties = {
  outline: 'none',
  borderColor: theme.primary,
  boxShadow: `0 0 0 2px ${theme.primaryFocusRing}`,
};

/** Lighter ring for the small inline links. */
const LINK_FOCUS_RING_STYLE: React.CSSProperties = {
  outline: 'none',
  borderRadius: 4,
  boxShadow: `0 0 0 2px ${theme.focusRing}`,
};

const BACKDROP_STYLE: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 1000,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
  backgroundColor: 'rgba(17, 24, 39, 0.55)',
};

const DIALOG_STYLE: React.CSSProperties = {
  width: '100%',
  maxWidth: 420,
  maxHeight: 'calc(100vh - 32px)',
  overflowY: 'auto',
  boxSizing: 'border-box',
  padding: 20,
  borderRadius: 12,
  border: `1px solid ${theme.border}`,
  backgroundColor: theme.surface,
  color: theme.text,
  boxShadow: `0 20px 45px ${theme.shadow}`,
};

const TITLE_STYLE: React.CSSProperties = {
  margin: 0,
  fontSize: 17,
  fontWeight: 700,
  lineHeight: 1.3,
};

const DESCRIPTION_STYLE: React.CSSProperties = {
  margin: '4px 0 0',
  fontSize: 13,
  lineHeight: 1.5,
  color: theme.neutralText,
};

const CLOSE_BUTTON_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 30,
  height: 30,
  flexShrink: 0,
  padding: 0,
  border: '1px solid transparent',
  borderRadius: 6,
  backgroundColor: 'transparent',
  color: theme.neutralText,
  fontSize: 18,
  lineHeight: 1,
  cursor: 'pointer',
};

const CLOSE_FOCUS_STYLE: React.CSSProperties = {
  borderColor: theme.focus,
  boxShadow: `0 0 0 2px ${theme.focusRing}`,
};

const LIST_STYLE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  margin: 0,
  padding: 0,
  listStyle: 'none',
};

const OPTION_BASE_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  width: '100%',
  boxSizing: 'border-box',
  padding: '12px 14px',
  borderRadius: 10,
  fontFamily: 'inherit',
  fontSize: 14,
  textAlign: 'left',
  cursor: 'pointer',
  transition: 'border-color 0.15s, box-shadow 0.15s',
};

const OPTION_DISABLED_STYLE: React.CSSProperties = {
  opacity: 0.55,
  cursor: 'not-allowed',
};

const FOOTER_STYLE: React.CSSProperties = {
  margin: '14px 0 0',
  fontSize: 12,
  lineHeight: 1.5,
  color: theme.neutralText,
};

/** Mirrors the pending spinner in `TransactionToast`. */
const SPINNER_STYLE: React.CSSProperties = {
  width: 14,
  height: 14,
  flexShrink: 0,
  borderRadius: '50%',
  border: `2px solid ${theme.primary}`,
  borderTopColor: 'transparent',
};

/** Icon for Freighter: a wallet body with its clasp. */
function FreighterIcon(): React.ReactElement {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="3" y="6" width="18" height="13" rx="2.5" />
      <path d="M3 10.5h18" />
      <path d="M16 14.75h.01" />
    </svg>
  );
}

/** Icon for Albedo: the radiating spark. */
function AlbedoIcon(): React.ReactElement {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="2.6" />
      <path d="M12 2.75v3.2M12 18.05v3.2M2.75 12h3.2M18.05 12h3.2" />
      <path d="M5.4 5.4 7.7 7.7M16.3 16.3l2.3 2.3M18.6 5.4l-2.3 2.3M7.7 16.3l-2.3 2.3" />
    </svg>
  );
}

const WALLET_ICONS: Readonly<Record<WalletName, React.FC>> = {
  freighter: FreighterIcon,
  albedo: AlbedoIcon,
};

/**
 * Installation state of a wallet row, as text. Exported so a host app can reuse
 * the exact wording instead of re-wording the badge.
 */
export const WALLET_INSTALL_LABELS = {
  installed: 'Installed',
  missing: 'Not installed',
  loadFailed: 'Could not load',
} as const;

/** Where the "Get it" affordance for a missing wallet points. */
function extensionUrlFor(wallet: WalletAvailability): string {
  return wallet.name === 'freighter' ? (wallet.installUrl ?? FREIGHTER_INSTALL_URL) : ALBEDO_EXTENSION_URL;
}

/** Second line of a wallet row: what happens next, and what it needs. */
function optionHint(wallet: WalletAvailability, connecting: boolean): string {
  if (connecting) return 'Waiting for the wallet to approve…';
  if (wallet.loadFailed) return 'The Albedo script could not be loaded from its CDN.';
  if (wallet.installed) return 'Detected in this browser.';
  return `Not installed. Open ${wallet.label} in a new tab, or use a Stellar browser extension.`;
}

interface WalletOptionProps {
  wallet: WalletAvailability;
  /** `true` while this wallet is the one being connected to. */
  connecting: boolean;
  /** `true` while any wallet is connecting; blocks a second prompt. */
  busy: boolean;
  /** Receives focus when the dialog opens; set on the first usable wallet. */
  autoFocus: boolean;
  /** `data-focus-key` of the control that currently holds focus, if any. */
  focusedKey: string | null;
  onSelect: (wallet: WalletName) => void;
}

/**
 * A single wallet row: a real `<button>` with a stable accessible name
 * ("Connect with Freighter") and a description carrying the installation state.
 * The state is never signalled by colour alone — the badge spells it out in text
 * and `aria-describedby` repeats it for assistive technology.
 *
 * A missing wallet stays clickable: Albedo only needs its script fetched
 * (#1170) and Freighter reports a readable error (#1169), so the install link
 * is an offer rather than a gate.
 */
function WalletOption({
  wallet,
  connecting,
  busy,
  autoFocus,
  focusedKey,
  onSelect,
}: WalletOptionProps): React.ReactElement {
  const Icon = WALLET_ICONS[wallet.name];
  const hintId = `${wallet.name}-hint`;
  const focused = focusedKey === `option-${wallet.name}`;

  const badgeText = wallet.loadFailed
    ? WALLET_INSTALL_LABELS.loadFailed
    : wallet.installed
      ? WALLET_INSTALL_LABELS.installed
      : WALLET_INSTALL_LABELS.missing;

  return (
    <button
      type="button"
      data-testid={`wallet-option-${wallet.name}`}
      data-installed={String(wallet.installed)}
      data-focus-key={`option-${wallet.name}`}
      data-modal-autofocus={autoFocus ? 'true' : undefined}
      aria-label={`Connect with ${wallet.label}`}
      aria-describedby={hintId}
      aria-busy={connecting}
      disabled={busy}
      onClick={() => onSelect(wallet.name)}
      style={{
        ...OPTION_BASE_STYLE,
        border: `1px solid ${wallet.installed ? theme.primaryBorder : theme.border}`,
        backgroundColor: wallet.installed ? theme.primaryBackground : theme.surface,
        color: theme.text,
        ...(busy ? OPTION_DISABLED_STYLE : null),
        ...(focused ? FOCUS_RING_STYLE : null),
      }}
    >
      <span
        aria-hidden="true"
        style={{ color: wallet.installed ? theme.primary : theme.neutralText, flexShrink: 0 }}
      >
        <Icon />
      </span>

      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontWeight: 600 }}>{wallet.label}</span>
        <span id={hintId} style={{ display: 'block', fontSize: 12, color: theme.neutralText }}>
          {optionHint(wallet, connecting)}
        </span>
      </span>

      {connecting ? <span aria-hidden="true" style={SPINNER_STYLE} /> : null}

      {wallet.installed ? (
        <Badge variant="success" size="sm">
          {badgeText}
        </Badge>
      ) : (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <Badge variant="warning" size="sm">
            {badgeText}
          </Badge>
          <a
            href={extensionUrlFor(wallet)}
            target="_blank"
            rel="noopener noreferrer"
            data-testid={`wallet-install-${wallet.name}`}
            data-focus-key={`install-${wallet.name}`}
            aria-label={`Get ${wallet.label}: opens in a new tab`}
            style={{
              fontSize: 12,
              color: theme.primary,
              ...(focusedKey === `install-${wallet.name}` ? LINK_FOCUS_RING_STYLE : null),
            }}
          >
            Get it
          </a>
        </span>
      )}

      <span aria-hidden="true" style={{ fontSize: 16, color: theme.neutralText }}>
        ›
      </span>
    </button>
  );
}

/** Narrow the loose `name` from {@link useWallet} back to a known wallet. */
function isWalletLabel(value: string | null | undefined): value is WalletName {
  return value === 'freighter' || value === 'albedo';
}

/**
 * Wallet picker dialog (#1171).
 *
 * Opened by a Connect button, it lists the wallets {@link useWallet} reports —
 * populated by the provider's detection (#1169, #1170) — marks the ones that
 * are installed, and starts the handshake for whichever is chosen. Connection
 * errors, including a user closing the wallet popup, surface in an `Alert`.
 *
 * The dialog is self-contained: it renders through a `react-dom` portal, wraps
 * Tab while open, closes on Escape or a backdrop click, and restores focus to
 * whatever had it before. Closing is blocked while a wallet prompt is open so
 * the popup is not orphaned.
 *
 * It reads the wallet context itself, so it needs a `BcForgeProvider` +
 * `WalletProvider` pair to offer real rows.
 */
export const WalletSelectModal: React.FC<WalletSelectModalProps> = ({
  open,
  onClose,
  title = 'Connect a wallet',
  description = 'Choose how you would like to connect.',
}) => {
  const { availableWallets, connectWallet, detectWallets, status, error, name } = useWallet();

  const dialogRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [focusedKey, setFocusedKey] = useState<string | null>(null);

  // The provider owns detection so every consumer shares one probe; fall back
  // to a one-off snapshot when this renders without a populated provider.
  const fallbackWallets = useMemo(() => probeWallets().wallets, []);
  const wallets = availableWallets.length > 0 ? availableWallets : fallbackWallets;

  const connecting = status === 'connecting';
  const connectingWallet = connecting && isWalletLabel(name) ? name : null;
  // Closing mid-handshake would orphan the wallet popup the user is looking at.
  const closeBlocked = connecting;

  const requestClose = useCallback(() => {
    if (closeBlocked) return;
    onClose();
  }, [closeBlocked, onClose]);

  // Remember what had focus before opening, move focus in, and put it back.
  useEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    restoreFocusRef.current = active instanceof HTMLElement ? active : null;

    const dialog = dialogRef.current;
    const target =
      dialog?.querySelector<HTMLElement>('[data-modal-autofocus="true"]') ??
      dialog?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ??
      dialog;
    target?.focus();

    return () => {
      restoreFocusRef.current?.focus();
      restoreFocusRef.current = null;
      setFocusedKey(null);
    };
  }, [open]);

  // Escape closes; Tab wraps so focus cannot leak to the page behind the dialog.
  // Both are document-level because focus may sit anywhere inside.
  useEffect(() => {
    if (!open || !isBrowser()) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        // Swallow Escape while a prompt is open rather than letting it reach an
        // ancestor dialog that would close over the wallet popup.
        if (closeBlocked) {
          event.stopPropagation();
          return;
        }
        event.preventDefault();
        requestClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = getFocusableElements(dialog);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [closeBlocked, open, requestClose]);

  // Keep the badges honest if an extension was installed in another tab (#1169).
  useEffect(() => {
    if (open) detectWallets();
  }, [detectWallets, open]);

  const handleSelect = useCallback(
    (wallet: WalletName) => {
      if (closeBlocked) return;
      void connectWallet(wallet);
    },
    [closeBlocked, connectWallet],
  );

  if (!open || !isBrowser()) return null;

  // Focus lands on the first detected wallet; the close button is the fallback.
  const autofocusName = wallets.find((wallet) => wallet.installed)?.name ?? null;
  const errorTitle =
    status === 'wrong-network' ? 'Wallet is on another network' : 'Could not connect';

  return createPortal(
    <div
      data-testid="wallet-select-backdrop"
      style={BACKDROP_STYLE}
      onMouseDown={(event) => {
        // Only a press on the backdrop itself closes; a drag that started inside
        // the dialog and ended on the backdrop must not.
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        data-testid="wallet-select-modal"
        onFocus={(event) => setFocusedKey(focusKeyOf(event.target))}
        onBlur={(event) => {
          if (event.currentTarget.contains(event.relatedTarget)) return;
          setFocusedKey(null);
        }}
        style={DIALOG_STYLE}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 id={titleId} style={TITLE_STYLE}>
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} style={DESCRIPTION_STYLE}>
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            data-testid="wallet-select-close"
            data-focus-key="close"
            aria-label="Close wallet picker"
            disabled={closeBlocked}
            onClick={requestClose}
            style={{
              ...CLOSE_BUTTON_STYLE,
              ...(closeBlocked ? OPTION_DISABLED_STYLE : null),
              ...(focusedKey === 'close' ? CLOSE_FOCUS_STYLE : null),
            }}
          >
            <span aria-hidden="true">&times;</span>
          </button>
        </div>

        {error ? (
          <div style={{ marginTop: 14 }}>
            <Alert variant="danger" title={errorTitle}>
              {error.message}
            </Alert>
          </div>
        ) : null}

        <ul style={{ ...LIST_STYLE, marginTop: error ? 12 : 16 }}>
          {wallets.map((wallet) => (
            <li key={wallet.name}>
              <WalletOption
                wallet={wallet}
                connecting={connectingWallet === wallet.name}
                busy={connecting}
                autoFocus={wallet.name === autofocusName}
                focusedKey={focusedKey}
                onSelect={handleSelect}
              />
            </li>
          ))}
        </ul>

        <p style={FOOTER_STYLE}>
          {connecting
            ? 'Finish the request in your wallet window. This dialog stays open until it settles.'
            : 'Your connection is remembered on this device, so the next visit reconnects automatically.'}
        </p>
      </div>
    </div>,
    document.body,
  );
};
